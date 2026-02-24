#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT / "backend"))

from app.db.session import SessionLocal  # noqa: E402
from app.models.assignment import Assignment  # noqa: E402
from app.models.invoice import Invoice  # noqa: E402


def _month_key(dt: datetime | None) -> str:
    if not dt:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%y%m")


def compute_assignment_codes(assignments: list[Assignment]) -> dict[int, str]:
    grouped: dict[str, list[Assignment]] = defaultdict(list)
    for assignment in assignments:
        grouped[_month_key(assignment.created_at)].append(assignment)

    mapping: dict[int, str] = {}
    for month_key, items in grouped.items():
        items.sort(key=lambda a: (a.created_at or datetime.min, a.id))
        for idx, assignment in enumerate(items, start=1):
            mapping[assignment.id] = f"Z-{month_key}-{idx:04d}"
    return mapping


def compute_invoice_numbers(
    invoices: list[Invoice],
    assignment_codes: dict[int, str],
) -> dict[int, str]:
    grouped: dict[int, list[Invoice]] = defaultdict(list)
    for invoice in invoices:
        if not invoice.assignment_id:
            continue
        grouped[invoice.assignment_id].append(invoice)

    mapping: dict[int, str] = {}
    for assignment_id, items in grouped.items():
        items.sort(key=lambda inv: (inv.created_at or datetime.min, inv.id))
        code = assignment_codes.get(assignment_id)
        if not code:
            continue
        for idx, invoice in enumerate(items, start=1):
            mapping[invoice.id] = f"{code}-I{idx:02d}"
    return mapping


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill assignment codes and invoice numbers.")
    parser.add_argument("--apply", action="store_true", help="Apply updates to the database.")
    parser.add_argument("--limit", type=int, default=12, help="Preview rows to print.")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        assignments = (
            db.query(Assignment)
            .filter(Assignment.is_deleted.is_(False))
            .order_by(Assignment.created_at.asc(), Assignment.id.asc())
            .all()
        )
        invoices = db.query(Invoice).order_by(Invoice.created_at.asc(), Invoice.id.asc()).all()

        assignment_codes = compute_assignment_codes(assignments)
        invoice_numbers = compute_invoice_numbers(invoices, assignment_codes)

        assignment_changes = [
            (a.id, a.assignment_code, assignment_codes.get(a.id))
            for a in assignments
            if assignment_codes.get(a.id) and assignment_codes.get(a.id) != a.assignment_code
        ]
        invoice_changes = [
            (inv.id, inv.invoice_number, invoice_numbers.get(inv.id))
            for inv in invoices
            if invoice_numbers.get(inv.id) and invoice_numbers.get(inv.id) != inv.invoice_number
        ]

        print(f"Assignments to update: {len(assignment_changes)}")
        for row in assignment_changes[: args.limit]:
            print(f"  assignment #{row[0]}: {row[1]} -> {row[2]}")

        print(f"Invoices to update: {len(invoice_changes)}")
        for row in invoice_changes[: args.limit]:
            print(f"  invoice #{row[0]}: {row[1]} -> {row[2]}")

        if not args.apply:
            print("Dry run only. Re-run with --apply to persist changes.")
            return 0

        for assignment_id, _, new_code in assignment_changes:
            assignment = db.get(Assignment, assignment_id)
            if assignment and new_code:
                assignment.assignment_code = new_code
                db.add(assignment)

        for invoice_id, _, new_number in invoice_changes:
            invoice = db.get(Invoice, invoice_id)
            if invoice and new_number:
                invoice.invoice_number = new_number
                db.add(invoice)

        db.commit()
        print("Backfill complete.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
