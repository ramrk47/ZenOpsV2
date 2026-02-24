from __future__ import annotations

from app.db.session import SessionLocal
from app.services.invoices import backfill_invoice_totals


def main() -> None:
    with SessionLocal() as db:
        updated = backfill_invoice_totals(db)
    print(f"Backfilled {updated} invoice(s).")


if __name__ == "__main__":
    main()
