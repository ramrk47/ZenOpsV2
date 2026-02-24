from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.core.settings import settings
from app.models.assignment import Assignment
from app.models.invoice import Invoice
from app.models.master import CompanyAccount, CompanyProfile


TWOPLACES = Decimal("0.01")


def _q(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES)


def _amount_to_words(amount: Decimal) -> str:
    try:
        from num2words import num2words

        # num2words expects a float/int; we keep this narrow and deterministic.
        words = num2words(float(amount), to="currency", lang="en_IN")
        return words.replace("euro", "rupees").replace("cents", "paise")
    except Exception:
        # Graceful fallback if num2words is unavailable.
        return f"INR {amount:.2f}"


def _safe_filename(name: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "-" for ch in name)
    return cleaned.strip("-") or "invoice"


def _company_name(profile: CompanyProfile) -> str:
    return profile.business_name or profile.legal_name or "Pinnacle Consultants"


def _draw_header(c: canvas.Canvas, profile: CompanyProfile, invoice: Invoice) -> None:
    width, height = A4
    top = height - 18 * mm

    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, top, _company_name(profile))

    c.setFont("Helvetica", 9)
    address_lines = [
        profile.tagline,
        profile.address_line1,
        profile.address_line2,
        " ".join(part for part in [profile.city, profile.state_name, profile.postal_code] if part),
        profile.country,
    ]
    address_lines = [line for line in address_lines if line]
    y = top - 6 * mm
    for line in address_lines:
        c.drawCentredString(width / 2, y, line)
        y -= 4.5 * mm

    right_x = width - 20 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(right_x, top, "Invoice Date")
    c.setFont("Helvetica", 10)
    issued = invoice.issued_date.strftime("%d %b %Y") if invoice.issued_date else "-"
    c.drawRightString(right_x, top - 5 * mm, issued)

    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(right_x, top - 11 * mm, "Invoice No.")
    c.setFont("Helvetica", 10)
    c.drawRightString(right_x, top - 16 * mm, invoice.invoice_number)


def _draw_party_block(c: canvas.Canvas, invoice: Invoice, assignment: Assignment, profile: CompanyProfile) -> float:
    width, height = A4
    left = 20 * mm
    y = height - 60 * mm

    c.setStrokeColor(colors.black)
    c.setLineWidth(0.8)

    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "INVOICE")
    y -= 6 * mm

    party_name = invoice.bill_to_name or assignment.valuer_client_name or assignment.bank_name or assignment.borrower_name or "-"

    c.setFont("Helvetica-Bold", 9)
    c.drawString(left, y, "Party:")
    c.setFont("Helvetica", 10)
    c.drawString(left + 20 * mm, y, party_name)
    y -= 5 * mm

    gstin = invoice.bill_to_gstin or profile.gstin or ""
    if gstin:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(left, y, "GSTIN:")
        c.setFont("Helvetica", 9)
        c.drawString(left + 20 * mm, y, gstin)
        y -= 5 * mm

    address = invoice.bill_to_address or assignment.address or ""
    if address:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(left, y, "Address:")
        c.setFont("Helvetica", 9)
        c.drawString(left + 20 * mm, y, address[:120])
        y -= 5 * mm

    if invoice.place_of_supply:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(left, y, "Place of Supply:")
        c.setFont("Helvetica", 9)
        c.drawString(left + 35 * mm, y, invoice.place_of_supply)
        y -= 5 * mm

    return y - 4 * mm


def _draw_items_table(c: canvas.Canvas, invoice: Invoice, start_y: float) -> float:
    width, _height = A4
    left = 20 * mm
    right = width - 20 * mm
    table_width = right - left

    col_sl = left
    col_desc = left + 18 * mm
    col_amount = right - 35 * mm

    row_h = 8 * mm
    y = start_y

    def hline(y_pos: float) -> None:
        c.line(left, y_pos, right, y_pos)

    def vline(x_pos: float, y0: float, y1: float) -> None:
        c.line(x_pos, y0, x_pos, y1)

    # Header
    c.setLineWidth(1)
    hline(y)
    hline(y - row_h)
    vline(col_desc, y, y - row_h)
    vline(col_amount, y, y - row_h)

    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString((col_sl + col_desc) / 2, y - 5.5 * mm, "Sl. No.")
    c.drawCentredString((col_desc + col_amount) / 2, y - 5.5 * mm, "Particulars")
    c.drawCentredString((col_amount + right) / 2, y - 5.5 * mm, "Amount")

    y -= row_h

    # Rows
    c.setFont("Helvetica", 9)
    for idx, item in enumerate(invoice.items, start=1):
        hline(y - row_h)
        vline(col_desc, y, y - row_h)
        vline(col_amount, y, y - row_h)

        c.drawCentredString((col_sl + col_desc) / 2, y - 5.5 * mm, str(idx))
        c.drawString(col_desc + 2 * mm, y - 5.5 * mm, item.description[:90])
        c.drawRightString(right - 2 * mm, y - 5.5 * mm, f"{_q(item.line_total):,.2f}")

        y -= row_h

    # Totals block
    totals_top = y
    totals_rows = 3
    totals_height = totals_rows * row_h
    hline(totals_top)
    hline(totals_top - totals_height)
    vline(col_amount, totals_top, totals_top - totals_height)

    labels = ["Subtotal", "GST", "Total Payable"]
    values = [invoice.subtotal or Decimal("0.00"), invoice.tax_amount or Decimal("0.00"), invoice.total_amount or Decimal("0.00")]

    c.setFont("Helvetica-Bold", 9)
    for i, (label, value) in enumerate(zip(labels, values)):
        row_y = totals_top - (i + 1) * row_h
        hline(row_y)
        c.drawRightString(col_amount - 4 * mm, row_y + 2.5 * mm, label)
        c.drawRightString(right - 2 * mm, row_y + 2.5 * mm, f"{_q(value):,.2f}")

    return totals_top - totals_height - 6 * mm


def _draw_footer(c: canvas.Canvas, invoice: Invoice, profile: CompanyProfile, account: Optional[CompanyAccount], y: float) -> None:
    width, _height = A4
    left = 20 * mm

    total = invoice.total_amount or Decimal("0.00")
    words = _amount_to_words(total)

    c.setFont("Helvetica-Bold", 9)
    c.drawString(left, y, "Amount Chargeable (in words)")
    y -= 5 * mm
    c.setFont("Helvetica", 9)
    c.drawString(left, y, words[:120])
    y -= 8 * mm

    c.setFont("Helvetica-Bold", 9)
    c.drawString(left, y, "Company Bank Details")
    y -= 5 * mm

    c.setFont("Helvetica", 9)
    if account:
        details = [
            ("Bank Name", account.bank_name),
            ("A/c No.", account.account_number),
            ("Branch & IFSC", " ".join(part for part in [account.branch_name, account.ifsc_code] if part)),
        ]
    else:
        details = [("Bank Name", "-"), ("A/c No.", "-"), ("Branch & IFSC", "-")]

    for label, value in details:
        c.drawString(left, y, f"{label}:")
        c.drawString(left + 35 * mm, y, value or "-")
        y -= 5 * mm

    signature_x = width - 70 * mm
    signature_y = y + 4 * mm
    c.setFont("Helvetica", 9)
    c.drawString(signature_x, signature_y, f"for {_company_name(profile)}")
    c.drawString(signature_x, signature_y - 6 * mm, "Authorised Signatory")

    c.setFont("Helvetica-Oblique", 8)
    c.drawCentredString(width / 2, 12 * mm, "This is a computer generated invoice")


def generate_invoice_pdf(
    *,
    invoice: Invoice,
    assignment: Assignment,
    profile: CompanyProfile,
    account: Optional[CompanyAccount],
) -> Path:
    uploads_root = settings.ensure_uploads_dir()
    invoice_dir = uploads_root / "invoices"
    invoice_dir.mkdir(parents=True, exist_ok=True)

    filename = _safe_filename(f"{invoice.invoice_number}.pdf")
    path = invoice_dir / filename

    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle(invoice.invoice_number)

    _draw_header(c, profile, invoice)
    y = _draw_party_block(c, invoice, assignment, profile)
    y = _draw_items_table(c, invoice, y)
    _draw_footer(c, invoice, profile, account, y)

    c.showPage()
    c.save()

    invoice.pdf_path = str(path)
    invoice.pdf_generated_at = datetime.now(timezone.utc)
    return path
