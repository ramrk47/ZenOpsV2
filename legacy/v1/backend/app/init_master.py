"""Production-safe master data initialisation.

Seeds banks, branches, clients, property types/subtypes, company profile,
accounts, calendar labels, and checklist templates — without creating any
demo users.  Safe to run multiple times (idempotent upserts).

Usage:
    python -m app.init_master          # seed master data only
    python -m app.init_master --check  # dry-run: report what would be created
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.seed import seed_master_data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed production master data (no demo users)")
    parser.add_argument("--check", action="store_true", help="Dry-run: report what would be created without committing")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    with SessionLocal() as db:
        master = seed_master_data(db)

        summary = {
            "banks": len(master.get("banks", [])),
            "branches": len(master.get("branches", [])),
            "clients": len(master.get("clients", [])),
            "property_types": len(master.get("property_types", [])),
            "property_subtypes": len(master.get("property_subtypes", [])),
        }

        if args.check:
            db.rollback()
            print("DRY RUN — no changes committed.")
        else:
            db.commit()
            print("Master data seeded successfully.")

        for k, v in summary.items():
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
