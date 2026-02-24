"""
Invoice routes.

Allows finance/admin users to create, view and update invoices.
Invoice numbers are generated from assignment codes to ensure traceability.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ..dependencies import get_db, get_current_active_user, require_capability
from ..models.invoice import Invoice, InvoiceItem, InvoiceStatus
from ..models.assignment import Assignment
from ..models.user import User
from ..schemas.invoice import InvoiceCreate, InvoiceRead, InvoiceUpdate
from ..utils import rbac
from datetime import datetime

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


def _generate_invoice_number(assignment_code: str) -> str:
    """Generate an invoice number from the assignment code.

    Example: VAL/2025/0012 -> INV/2025/0012
    """
    parts = assignment_code.split("/", 1)
    if len(parts) == 2:
        return f"INV/{parts[1]}"
    return f"INV-{assignment_code}"


@router.get("/", response_model=list[InvoiceRead])
def list_invoices(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("invoices.read")),
):
    invoices = db.query(Invoice).options(joinedload(Invoice.items)).all()
    return [InvoiceRead.from_orm(inv) for inv in invoices]


@router.post("/", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
def create_invoice(
    invoice_in: InvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("invoices.create")),
):
    assignment = db.get(Assignment, invoice_in.assignment_id)
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    if assignment.invoice:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice already exists for assignment")
    invoice_number = _generate_invoice_number(assignment.assignment_code)
    # compute totals from items
    items = []
    total = 0.0
    for item_in in invoice_in.items:
        total_price = item_in.quantity * item_in.unit_price
        total += total_price
        items.append(InvoiceItem(description=item_in.description, quantity=item_in.quantity, unit_price=item_in.unit_price, total_price=total_price))
    total_amount = invoice_in.total_amount or total
    invoice = Invoice(
        invoice_number=invoice_number,
        assignment_id=assignment.id,
        bank_id=assignment.bank_id,
        branch_id=assignment.branch_id,
        client_id=assignment.client_id,
        total_amount=total_amount,
        tax_amount=invoice_in.tax_amount,
        discount_amount=invoice_in.discount_amount,
        due_date=invoice_in.due_date,
        notes=invoice_in.notes,
        created_by_user_id=current_user.id,
    )
    invoice.items = items
    # set invoice status to ISSUED when created
    invoice.status = InvoiceStatus.ISSUED
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return InvoiceRead.from_orm(invoice)


@router.get("/{invoice_id}", response_model=InvoiceRead)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("invoices.read")),
):
    invoice = db.query(Invoice).options(joinedload(Invoice.items)).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return InvoiceRead.from_orm(invoice)


@router.patch("/{invoice_id}", response_model=InvoiceRead)
def update_invoice(
    invoice_id: int,
    invoice_update: InvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    # Determine required capability based on update fields
    if invoice_update.status == InvoiceStatus.PAID:
        # marking paid requires invoices.mark_paid capability
        if not rbac.user_has_capability(current_user, "invoices.mark_paid"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to mark invoice paid")
        invoice.status = InvoiceStatus.PAID
        # also update assignment
        assignment = invoice.assignment
        assignment.is_paid = True
    else:
        # other updates require invoices.create (to edit invoices)
        if not rbac.user_has_capability(current_user, "invoices.create"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to update invoice")
        data = invoice_update.dict(exclude_unset=True)
        for field, value in data.items():
            if field == "status":
                continue
            setattr(invoice, field, value)
    invoice.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(invoice)
    return InvoiceRead.from_orm(invoice)