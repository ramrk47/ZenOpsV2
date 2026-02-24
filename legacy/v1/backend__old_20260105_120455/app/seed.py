"""
Data seeding script.

Run this module directly to populate the database with demo users and
sample data.  It relies on the models and database configuration
defined in the rest of the application.  The script can be safely run
multiple times; it checks for existing records before creating new
ones.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from .db import session_scope
from .models import (
    User,
    UserRole,
    Bank,
    Branch,
    Client,
    PropertyType,
    Assignment,
    AssignmentStatus,
    CaseType,
    Invoice,
    InvoiceItem,
    InvoiceStatus,
)
from .utils.security import get_password_hash


def run_seed():
    with session_scope() as db:
        # Create banks and branches
        bank = db.query(Bank).filter_by(name="Acme Bank").first()
        if not bank:
            bank = Bank(name="Acme Bank", account_name="Acme Consultants", account_number="1234567890", ifsc="ACME0001")
            db.add(bank)
            db.flush()
            branch = Branch(bank_id=bank.id, name="Main Branch", city="Metropolis", is_active=True)
            db.add(branch)

        # Clients
        client = db.query(Client).filter_by(name="John Doe").first()
        if not client:
            client = Client(name="John Doe", phone="+910000000000", email="john@example.com")
            db.add(client)

        # Property types
        ptype = db.query(PropertyType).filter_by(name="Residential").first()
        if not ptype:
            ptype = PropertyType(name="Residential")
            db.add(ptype)

        # Users
        def get_or_create_user(email: str, role: UserRole, full_name: str) -> User:
            user = db.query(User).filter_by(email=email).first()
            if not user:
                user = User(
                    email=email,
                    full_name=full_name,
                    role=role,
                    hashed_password=get_password_hash("password"),
                )
                db.add(user)
            return user

        admin = get_or_create_user("admin@zenops.local", UserRole.ADMIN, "Admin User")
        ops = get_or_create_user("ops@zenops.local", UserRole.OPS_MANAGER, "Ops Manager")
        hr = get_or_create_user("hr@zenops.local", UserRole.HR, "HR User")
        fin = get_or_create_user("finance@zenops.local", UserRole.FINANCE, "Finance User")
        assistant = get_or_create_user("assistant@zenops.local", UserRole.ASSISTANT_VALUER, "Assistant Valuer")
        field = get_or_create_user("field@zenops.local", UserRole.FIELD_VALUER, "Field Valuer")
        employee = get_or_create_user("employee@zenops.local", UserRole.EMPLOYEE, "Legacy Employee")

        db.flush()

        # Create sample assignments
        if not db.query(Assignment).count():
            for i in range(1, 11):
                code = f"VAL/{datetime.utcnow().year}/{i:04d}"
                a = Assignment(
                    assignment_code=code,
                    case_type=random.choice(list(CaseType)),
                    bank_id=bank.id,
                    branch_id=bank.branches[0].id if bank.branches else None,
                    client_id=client.id,
                    property_type_id=ptype.id,
                    borrower_name=f"Borrower {i}",
                    phone="+911234567890",
                    address=f"123 Main St, Unit {i}",
                    status=random.choice(list(AssignmentStatus)),
                    created_by_user_id=admin.id,
                    assigned_to_user_id=random.choice([ops.id, assistant.id, field.id]),
                    site_visit_date=datetime.utcnow() + timedelta(days=random.randint(1, 5)),
                    report_due_date=datetime.utcnow() + timedelta(days=random.randint(5, 10)),
                    fees=5000 + i * 100,
                    is_paid=random.choice([True, False]),
                )
                db.add(a)
                db.flush()
                # Optionally create invoices for half of assignments
                if i % 2 == 0:
                    invoice_number = f"INV/{datetime.utcnow().year}/{i:04d}"
                    inv = Invoice(
                        invoice_number=invoice_number,
                        assignment_id=a.id,
                        bank_id=a.bank_id,
                        branch_id=a.branch_id,
                        client_id=a.client_id,
                        total_amount=a.fees,
                        status=random.choice([InvoiceStatus.ISSUED, InvoiceStatus.PAID]),
                        created_by_user_id=fin.id,
                    )
                    item = InvoiceItem(
                        description="Valuation Fee",
                        quantity=1,
                        unit_price=a.fees,
                        total_price=a.fees,
                    )
                    inv.items.append(item)
                    db.add(inv)
        print("Seeding completed.")


if __name__ == "__main__":
    run_seed()