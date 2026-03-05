from __future__ import annotations

import argparse
import re

from sqlalchemy import text

from app.core.security import get_password_hash
from app.db.session import SessionLocal
from app.models.enums import Role
from app.models.user import User
from app.seed import seed_master_data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reset pilot data and bootstrap admin accounts (V1 only).",
    )
    parser.add_argument(
        "--admin",
        action="append",
        required=True,
        metavar="EMAIL:PASSWORD",
        help="Admin account credential pair. Repeat the flag for multiple admins.",
    )
    parser.add_argument(
        "--skip-master-seed",
        action="store_true",
        help="Skip baseline master-data seed after reset.",
    )
    return parser.parse_args()


def parse_admin_pairs(raw_pairs: list[str]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for raw in raw_pairs:
        if ":" not in raw:
            raise ValueError(f"Invalid --admin value '{raw}'. Expected EMAIL:PASSWORD.")
        email, password = raw.split(":", 1)
        email = email.strip().lower()
        password = password.strip()
        if not email or "@" not in email:
            raise ValueError(f"Invalid admin email '{email}'.")
        if len(password) < 8:
            raise ValueError(f"Password for '{email}' must be at least 8 characters.")
        pairs.append((email, password))
    return pairs


def build_full_name(email: str) -> str:
    local = email.split("@", 1)[0]
    tokens = [part for part in re.split(r"[^a-zA-Z0-9]+", local) if part]
    if not tokens:
        return email
    return " ".join(token.capitalize() for token in tokens)


def truncate_public_tables() -> None:
    with SessionLocal() as db:
        table_names = db.execute(
            text(
                """
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
                  AND tablename <> 'alembic_version'
                ORDER BY tablename
                """
            )
        ).scalars().all()
        if not table_names:
            db.commit()
            return
        quoted = ", ".join(f'"{name}"' for name in table_names)
        db.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
        db.commit()


def bootstrap(admin_pairs: list[tuple[str, str]], *, seed_master: bool) -> None:
    with SessionLocal() as db:
        if seed_master:
            seed_master_data(db)
        for email, password in admin_pairs:
            db.add(
                User(
                    email=email,
                    hashed_password=get_password_hash(password),
                    full_name=build_full_name(email),
                    role=Role.ADMIN,
                    roles=[Role.ADMIN.value],
                    is_active=True,
                    totp_secret=None,
                    totp_enabled=False,
                    backup_codes_hash=None,
                )
            )
        db.commit()


def main() -> None:
    args = parse_args()
    admins = parse_admin_pairs(args.admin)
    truncate_public_tables()
    bootstrap(admins, seed_master=not args.skip_master_seed)
    print("Pilot reset complete.")
    for email, _password in admins:
        print(f"- admin: {email}")


if __name__ == "__main__":
    main()
