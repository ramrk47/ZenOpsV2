from __future__ import annotations

import argparse

from app.core.security import get_password_hash
from app.core.settings import settings
from app.db.session import SessionLocal
from app.models.enums import Role
from app.models.user import User


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ensure a deterministic E2E login user exists.")
    parser.add_argument("--email", default="admin@zenops.local")
    parser.add_argument("--password", default="password")
    parser.add_argument("--full-name", default="E2E Admin")
    parser.add_argument(
        "--role",
        default="ADMIN",
        choices=[role.value for role in Role],
        help="Primary role for the ensured user",
    )
    parser.add_argument(
        "--allow-production",
        action="store_true",
        help="Allow running in production (not recommended).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    env = settings.environment.lower()
    if env in {"prod", "production"} and not args.allow_production:
        raise RuntimeError("Refusing to run in production without --allow-production")

    role = Role(args.role)

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == args.email.lower()).first()
        if user:
            user.hashed_password = get_password_hash(args.password)
            user.full_name = args.full_name
            user.role = role
            user.roles = [role.value]
            user.is_active = True
            db.add(user)
            action = "updated"
        else:
            user = User(
                email=args.email.lower(),
                hashed_password=get_password_hash(args.password),
                role=role,
                roles=[role.value],
                full_name=args.full_name,
                is_active=True,
            )
            db.add(user)
            action = "created"

        db.commit()
        print(f"{action} e2e user: {user.email} ({role.value})")


if __name__ == "__main__":
    main()
