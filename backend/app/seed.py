from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Iterable

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.core.settings import settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.assignment import Assignment
from app.models.assignment_assignee import AssignmentAssignee
from app.models.assignment_floor import AssignmentFloorArea
from app.models.document import AssignmentDocument
from app.models.enums import (
    AssignmentStatus,
    CalendarEventType,
    CaseType,
    CommissionRequestStatus,
    InvoiceStatus,
    PaymentMode,
    LeaveStatus,
    LeaveType,
    Role,
    ServiceLine,
    TaskStatus,
)
from app.models.invoice import Invoice, InvoicePayment
from app.models.leave import LeaveRequest
from app.models.master import (
    Bank,
    Branch,
    CalendarEventLabel,
    Client,
    CompanyAccount,
    CompanyProfile,
    DocumentChecklistTemplate,
    PropertySubtype,
    PropertyType,
)
from app.models.message import AssignmentMessage
from app.models.partner import CommissionRequest, CommissionRequestDocument, CommissionRequestFloorArea, ExternalPartner
from app.models.task import AssignmentTask
from app.models.user import User
from app.services.activity import log_activity
from app.services.assignments import generate_assignment_code
from app.services.commissions import generate_commission_code
from app.services.calendar import upsert_task_due_event
from app.services.invoices import recompute_invoice_balance, recompute_invoice_totals, replace_invoice_items
from app.services.leave import approve_leave


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed the Zen Ops database with demo data")
    parser.add_argument("--reset", action="store_true", help="Drop and recreate all tables before seeding")
    return parser.parse_args()


def reset_db() -> None:
    if not settings.destructive_actions_enabled:
        raise RuntimeError("Destructive actions are disabled in this environment.")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def get_or_create_user(
    db: Session,
    *,
    email: str,
    password: str,
    role: Role,
    full_name: str,
    partner_id: int | None = None,
) -> User:
    user = db.query(User).filter(User.email == email).first()
    if user:
        return user
    user = User(
        email=email,
        hashed_password=get_password_hash(password),
        role=role,
        roles=[role.value],
        full_name=full_name,
        is_active=True,
        partner_id=partner_id,
    )
    db.add(user)
    db.flush()
    return user


def seed_master_data(db: Session) -> dict[str, list]:
    banks: list[Bank] = []
    for name, code in [("Axis Bank", "AXIS"), ("HDFC Bank", "HDFC"), ("ICICI Bank", "ICICI")]:
        bank = db.query(Bank).filter(Bank.name == name).first()
        if not bank:
            bank = Bank(name=name, code=code, is_active=True)
            db.add(bank)
            db.flush()
        banks.append(bank)

    branches: list[Branch] = []
    branch_specs = [
        (banks[0], "Chennai Main", "CHN-M"),
        (banks[0], "Coimbatore", "CBE"),
        (banks[1], "Bengaluru", "BLR"),
        (banks[2], "Hyderabad", "HYD"),
    ]
    for bank, name, code in branch_specs:
        branch = db.query(Branch).filter(Branch.bank_id == bank.id, Branch.name == name).first()
        if not branch:
            branch = Branch(bank_id=bank.id, name=name, code=code, city=name.split()[0], state="TN")
            db.add(branch)
            db.flush()
        branches.append(branch)

    clients: list[Client] = []
    for name in ["Pinnacle Direct", "BlueStone Developers", "Sunrise Homes"]:
        client = db.query(Client).filter(Client.name == name).first()
        if not client:
            client = Client(name=name, client_type="DIRECT", is_active=True)
            db.add(client)
            db.flush()
        clients.append(client)

    property_types: list[PropertyType] = []
    for name in ["Flat", "Independent House", "Land", "Commercial"]:
        prop = db.query(PropertyType).filter(PropertyType.name == name).first()
        if not prop:
            prop = PropertyType(name=name, description=f"{name} valuation")
            db.add(prop)
            db.flush()
        property_types.append(prop)

    property_type_by_name = {prop.name: prop for prop in property_types}

    subtype_specs: dict[str, list[str]] = {
        "Flat": ["Apartment", "Studio"],
        "Independent House": ["Villa", "Duplex"],
        "Land": ["Agricultural", "NA Plot"],
        "Commercial": ["Office", "Retail"],
    }
    property_subtypes: list[PropertySubtype] = []
    subtypes_by_type: dict[int, list[PropertySubtype]] = {}
    for type_name, subtype_names in subtype_specs.items():
        prop = property_type_by_name.get(type_name)
        if not prop:
            continue
        typed_subtypes: list[PropertySubtype] = []
        for subtype_name in subtype_names:
            subtype = (
                db.query(PropertySubtype)
                .filter(PropertySubtype.property_type_id == prop.id, PropertySubtype.name == subtype_name)
                .first()
            )
            if not subtype:
                subtype = PropertySubtype(property_type_id=prop.id, name=subtype_name, description=f"{type_name} - {subtype_name}")
                db.add(subtype)
                db.flush()
            typed_subtypes.append(subtype)
            property_subtypes.append(subtype)
        subtypes_by_type[prop.id] = typed_subtypes

    profile = db.query(CompanyProfile).order_by(CompanyProfile.id.asc()).first()
    if not profile:
        profile = CompanyProfile(
            business_name="Pinnacle Consultants",
            legal_name="Pinnacle Consultants",
            tagline="Chartered Engineers & Approved Valuers",
            address_line1="Sai Nagar near Sai Mandir",
            address_line2="Mudhol",
            city="Mudhol",
            state_name="Karnataka",
            state_code="29",
            postal_code="587313",
            country="India",
            gstin="29DERPK2070C1ZF",
            pan="DERPK2070C",
            contact_email="admin@zenops.local",
            contact_phone="+91-90000-00000",
            website="zenops.local",
            default_gst_rate=Decimal("18.00"),
        )
        db.add(profile)
        db.flush()

    primary_account = db.query(CompanyAccount).filter(CompanyAccount.is_primary.is_(True)).first()
    if not primary_account:
        primary_account = CompanyAccount(
            bank_id=banks[1].id,
            account_name="Pinnacle Consultants",
            account_number="1234567890",
            ifsc_code="HDFC0001234",
            bank_name="HDFC Bank",
            branch_name="Bengaluru",
            upi_id="pinnacle@hdfc",
            is_primary=True,
            is_active=True,
            notes="Primary settlement account",
        )
        db.add(primary_account)
        db.flush()

    bank_accounts: dict[int, CompanyAccount] = {}
    for bank in banks:
        bank_account = (
            db.query(CompanyAccount)
            .filter(CompanyAccount.bank_id == bank.id, CompanyAccount.is_active.is_(True))
            .order_by(CompanyAccount.is_primary.desc(), CompanyAccount.id.asc())
            .first()
        )
        if not bank_account:
            bank_account = CompanyAccount(
                bank_id=bank.id,
                account_name=f"{bank.name} Collections",
                account_number=f"{bank.code}000{bank.id:02d}1234",
                ifsc_code=f"{bank.code}0001234",
                bank_name=bank.name,
                branch_name="Main",
                upi_id=f"{bank.code.lower()}@upi",
                is_primary=False,
                is_active=True,
                notes="Bank-specific settlement account",
            )
            db.add(bank_account)
            db.flush()
        bank_accounts[bank.id] = bank_account

    existing_labels = db.query(CalendarEventLabel).count()
    if existing_labels == 0:
        labels = [
            CalendarEventLabel(name="Company Holiday", description="Company-wide holiday", default_event_type=CalendarEventType.LEAVE),
            CalendarEventLabel(name="Team Meeting", description="Internal meeting", default_event_type=CalendarEventType.INTERNAL_MEETING),
            CalendarEventLabel(name="Site Visit", description="Site visit schedule", default_event_type=CalendarEventType.SITE_VISIT),
            CalendarEventLabel(name="Report Due", description="Report deadline", default_event_type=CalendarEventType.REPORT_DUE),
        ]
        db.add_all(labels)
        db.flush()

    # Checklist templates
    existing_templates = db.query(DocumentChecklistTemplate).count()
    if existing_templates == 0:
        flat = property_type_by_name.get("Flat")
        land = property_type_by_name.get("Land")
        flat_subtype = subtypes_by_type.get(flat.id, [None])[0] if flat else None
        land_subtype = subtypes_by_type.get(land.id, [None])[0] if land else None
        templates = [
            DocumentChecklistTemplate(bank_id=banks[0].id, category="EC", required=True),
            DocumentChecklistTemplate(bank_id=banks[0].id, category="Sale Deed", required=True),
            DocumentChecklistTemplate(bank_id=banks[1].id, category="Application", required=True),
            DocumentChecklistTemplate(branch_id=branches[0].id, category="Photos", required=True),
            DocumentChecklistTemplate(category="Final Report", required=True),
            DocumentChecklistTemplate(
                property_type_id=flat.id if flat else None,
                property_subtype_id=flat_subtype.id if flat_subtype else None,
                category="Khata Certificate",
                required=True,
                notes="Subtype-specific requirement for flats",
            ),
            DocumentChecklistTemplate(
                property_type_id=land.id if land else None,
                property_subtype_id=land_subtype.id if land_subtype else None,
                category="RTC / Land Records",
                required=True,
                notes="Subtype-specific requirement for land valuations",
            ),
        ]
        db.add_all(templates)
        db.flush()

    return {
        "banks": banks,
        "branches": branches,
        "clients": clients,
        "property_types": property_types,
        "property_subtypes": property_subtypes,
        "property_subtypes_by_type": subtypes_by_type,
        "company_profile": profile,
        "bank_accounts": bank_accounts,
        "primary_account": primary_account,
    }


def _write_dummy_file(path: Path, name: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"Dummy document: {name}\n", encoding="utf-8")
    return path


def seed_partners(db: Session, *, users: dict[str, User], master: dict[str, list]) -> dict[str, object]:
    partner = db.query(ExternalPartner).filter(ExternalPartner.display_name == "Patil Valuations").first()
    if not partner:
        partner = ExternalPartner(
            display_name="Patil Valuations",
            legal_name="Patil Valuations Private Limited",
            contact_name="Patil",
            email="patil@partner.local",
            phone="9000000999",
            alternate_contact_name="Patil Ops",
            alternate_contact_email="ops@patil.local",
            alternate_contact_phone="9000000888",
            city="Chennai",
            gstin="22AAAAA0000A1Z5",
            billing_address="12 Mount Road",
            billing_city="Chennai",
            billing_state="Tamil Nadu",
            billing_postal_code="600002",
            service_lines=[ServiceLine.VALUATION.value, ServiceLine.DPR.value],
            multi_floor_enabled=True,
            notes="Preferred partner for South region",
            is_active=True,
        )
        db.add(partner)
        db.flush()

    partner_user = get_or_create_user(
        db,
        email="patil@partner.local",
        password="password",
        role=Role.EXTERNAL_PARTNER,
        full_name="Patil Partner",
        partner_id=partner.id,
    )

    commission = (
        db.query(CommissionRequest)
        .filter(CommissionRequest.partner_id == partner.id)
        .order_by(CommissionRequest.created_at.desc())
        .first()
    )
    if not commission:
        bank = master["banks"][0]
        branch = master["branches"][0]
        request_code = generate_commission_code(db)
        commission = CommissionRequest(
            request_code=request_code,
            partner_id=partner.id,
            status=CommissionRequestStatus.SUBMITTED,
            bank_id=bank.id,
            branch_id=branch.id,
            bank_name=bank.name,
            branch_name=branch.name,
            borrower_name="External Borrower",
            phone="9000011111",
            address="External Street 12, Chennai",
            land_area=Decimal("1500.00"),
            builtup_area=Decimal("980.00"),
            service_line=ServiceLine.VALUATION,
            notes="Seeded commission request",
            created_by_user_id=partner_user.id,
            submitted_at=datetime.now(timezone.utc),
        )
        db.add(commission)
        db.flush()

        db.add_all(
            [
                CommissionRequestFloorArea(
                    commission_request_id=commission.id,
                    floor_name="Ground Floor",
                    area=Decimal("540.00"),
                    order_index=0,
                ),
                CommissionRequestFloorArea(
                    commission_request_id=commission.id,
                    floor_name="First Floor",
                    area=Decimal("440.00"),
                    order_index=1,
                ),
            ]
        )

        upload_dir = settings.ensure_uploads_dir() / "commissions" / commission.request_code
        file_path = _write_dummy_file(upload_dir / "patil-request.txt", "Patil Request")
        doc = CommissionRequestDocument(
            commission_request_id=commission.id,
            uploaded_by_user_id=partner_user.id,
            original_name="patil-request.txt",
            storage_path=str(file_path),
            mime_type="text/plain",
            size=len(file_path.read_bytes()),
            category="Application",
        )
        db.add(doc)

    return {"partner": partner, "partner_user": partner_user, "commission": commission}


def seed_assignments(
    db: Session,
    *,
    users: dict[str, User],
    master: dict[str, list],
    partner_data: dict[str, object] | None = None,
) -> list[Assignment]:
    if db.query(Assignment).count() > 0:
        return db.query(Assignment).all()

    now = datetime.now(timezone.utc)
    banks = master["banks"]
    branches = master["branches"]
    clients = master["clients"]
    property_types = master["property_types"]
    property_subtypes_by_type = master["property_subtypes_by_type"]

    specs = [
        (CaseType.BANK, banks[0], branches[0], None, property_types[0], AssignmentStatus.PENDING, users["assistant"]),
        (CaseType.BANK, banks[0], branches[1], None, property_types[1], AssignmentStatus.SITE_VISIT, users["field"]),
        (CaseType.BANK, banks[1], branches[2], None, property_types[2], AssignmentStatus.UNDER_PROCESS, users["assistant"]),
        (CaseType.BANK, banks[2], branches[3], None, property_types[3], AssignmentStatus.SUBMITTED, users["assistant"]),
        (CaseType.DIRECT_CLIENT, None, None, clients[0], property_types[0], AssignmentStatus.PENDING, users["assistant"]),
        (CaseType.DIRECT_CLIENT, None, None, clients[1], property_types[1], AssignmentStatus.COMPLETED, users["assistant"]),
        (CaseType.EXTERNAL_VALUER, None, None, clients[2], property_types[2], AssignmentStatus.UNDER_PROCESS, users["field"]),
        (CaseType.BANK, banks[1], branches[2], None, property_types[0], AssignmentStatus.PENDING, users["assistant"]),
        (CaseType.BANK, banks[2], branches[3], None, property_types[1], AssignmentStatus.SITE_VISIT, users["field"]),
        (CaseType.DIRECT_CLIENT, None, None, clients[0], property_types[3], AssignmentStatus.UNDER_PROCESS, users["assistant"]),
    ]

    assignments: list[Assignment] = []
    for idx, (case_type, bank, branch, client, prop, status, assignee) in enumerate(specs, start=1):
        created_at = now - timedelta(hours=idx * 6)
        site_visit_date = created_at + timedelta(days=1)
        report_due_date = created_at + timedelta(days=2)
        prop_subtypes = property_subtypes_by_type.get(prop.id, []) if prop else []
        prop_subtype = prop_subtypes[idx % len(prop_subtypes)] if prop_subtypes else None
        assignment = Assignment(
            assignment_code=generate_assignment_code(db),
            case_type=case_type,
            bank_id=bank.id if bank else None,
            branch_id=branch.id if branch else None,
            client_id=client.id if client else None,
            property_type_id=prop.id if prop else None,
            property_subtype_id=prop_subtype.id if prop_subtype else None,
            bank_name=bank.name if bank else None,
            branch_name=branch.name if branch else None,
            valuer_client_name=client.name if client else None,
            property_type=prop.name if prop else None,
            borrower_name=f"Borrower {idx}",
            phone=f"9000000{idx:03d}",
            address=f"{idx} Example Street, Sample City",
            land_area=Decimal("1200.00") + Decimal(idx),
            builtup_area=Decimal("900.00") + Decimal(idx * 2),
            status=status,
            created_by_user_id=users["ops"].id,
            assigned_to_user_id=assignee.id,
            assigned_at=created_at + timedelta(hours=2),
            site_visit_date=site_visit_date,
            report_due_date=report_due_date,
            fees=Decimal("4500.00") + Decimal(idx * 100),
            is_paid=status == AssignmentStatus.COMPLETED,
            notes="Seeded assignment",
            created_at=created_at,
            updated_at=created_at,
        )
        if status == AssignmentStatus.COMPLETED:
            assignment.completed_at = created_at + timedelta(days=3)
            assignment.report_submitted_at = created_at + timedelta(days=2, hours=4)
        db.add(assignment)
        db.flush()
        assignments.append(assignment)

        # Multi-assignee links provide shared ownership of larger projects.
        additional_user_ids: list[int] = []
        if idx % 3 == 0:
            additional_user_ids.append(users["admin"].id)
        if idx % 4 == 0:
            additional_user_ids.append(users["assistant"].id)
        if idx % 5 == 0:
            additional_user_ids.append(users["field"].id)
        for user_id in additional_user_ids:
            if user_id == assignment.assigned_to_user_id:
                continue
            db.add(AssignmentAssignee(assignment_id=assignment.id, user_id=user_id))

        # Floor-wise built-up area for multi-floor properties.
        if idx % 2 == 0:
            floors = [
                ("Ground Floor", Decimal("450.00") + Decimal(idx)),
                ("First Floor", Decimal("320.00") + Decimal(idx)),
            ]
            total_area = Decimal("0.00")
            for order_index, (floor_name, area) in enumerate(floors):
                db.add(
                    AssignmentFloorArea(
                        assignment_id=assignment.id,
                        floor_name=floor_name,
                        area=area,
                        order_index=order_index,
                    )
                )
                total_area += area
            assignment.builtup_area = total_area
            db.add(assignment)

        log_activity(
            db,
            actor_user_id=users["ops"].id,
            activity_type="ASSIGNMENT_CREATED",
            assignment_id=assignment.id,
            message=f"Seeded {assignment.assignment_code}",
        )

    if partner_data:
        commission = partner_data.get("commission")
        partner = partner_data.get("partner")
        if isinstance(commission, CommissionRequest) and isinstance(partner, ExternalPartner):
            partner_assignment = Assignment(
                assignment_code=generate_assignment_code(db),
                case_type=CaseType.EXTERNAL_VALUER,
                bank_id=commission.bank_id,
                branch_id=commission.branch_id,
                bank_name=commission.bank_name,
                branch_name=commission.branch_name,
                borrower_name=commission.borrower_name,
                phone=commission.phone,
                address=commission.address,
                land_area=commission.land_area,
                builtup_area=commission.builtup_area,
                status=AssignmentStatus.UNDER_PROCESS,
                created_by_user_id=users["ops"].id,
                assigned_to_user_id=users["assistant"].id,
                assigned_at=now,
                site_visit_date=commission.site_visit_date,
                report_due_date=commission.report_due_date,
                fees=Decimal("5500.00"),
                is_paid=False,
                notes="Partner converted assignment",
                partner_id=partner.id,
                commission_request_id=commission.id,
                created_at=now - timedelta(days=1),
                updated_at=now - timedelta(days=1),
            )
            db.add(partner_assignment)
            db.flush()
            commission.status = CommissionRequestStatus.CONVERTED
            commission.converted_assignment_id = partner_assignment.id
            commission.decided_at = now
            db.add(commission)
            assignments.append(partner_assignment)

    db.flush()
    return assignments


def seed_tasks_messages_documents_invoices(
    db: Session,
    assignments: Iterable[Assignment],
    users: dict[str, User],
    master: dict[str, list],
) -> None:
    uploads_dir = settings.ensure_uploads_dir()
    now = datetime.now(timezone.utc)
    profile: CompanyProfile = master["company_profile"]
    bank_accounts: dict[int, CompanyAccount] = master["bank_accounts"]
    primary_account: CompanyAccount = master["primary_account"]

    for idx, assignment in enumerate(assignments, start=1):
        # Tasks
        task = AssignmentTask(
            assignment_id=assignment.id,
            title="Site visit",
            description="Complete the site visit and upload photos",
            status=TaskStatus.DOING if idx % 2 == 0 else TaskStatus.TODO,
            assigned_to_user_id=assignment.assigned_to_user_id,
            due_at=now + timedelta(days=idx % 4),
            created_by_user_id=users["ops"].id,
            template_type="site_visit",
        )
        db.add(task)
        db.flush()
        upsert_task_due_event(db, task=task, assignment=assignment, actor_user_id=users["ops"].id)

        log_activity(
            db,
            actor_user_id=users["ops"].id,
            activity_type="TASK_CREATED",
            assignment_id=assignment.id,
            payload={"task_id": task.id},
        )

        # Messages
        message = AssignmentMessage(
            assignment_id=assignment.id,
            sender_user_id=users["ops"].id,
            message="Please prioritize this case.",
            mentions=[assignment.assigned_to_user_id] if assignment.assigned_to_user_id else [],
            pinned=idx % 3 == 0,
        )
        db.add(message)

        # Documents
        doc_dir = uploads_dir / assignment.assignment_code
        doc_path = _write_dummy_file(doc_dir / f"doc_{idx}.txt", f"Doc {idx}")
        document = AssignmentDocument(
            assignment_id=assignment.id,
            uploaded_by_user_id=users["assistant"].id,
            original_name=f"doc_{idx}.txt",
            storage_path=str(doc_path),
            mime_type="text/plain",
            size=doc_path.stat().st_size,
            category="Photos" if idx % 2 == 0 else "EC",
            version_number=1,
            is_final=False,
        )
        db.add(document)

        log_activity(
            db,
            actor_user_id=users["assistant"].id,
            activity_type="DOCUMENT_UPLOADED",
            assignment_id=assignment.id,
            payload={"category": document.category},
        )

        # Invoices for a subset (always include partner-linked assignments)
        if idx <= 6 or assignment.partner_id:
            account = bank_accounts.get(assignment.bank_id) if assignment.bank_id else None
            if not account:
                account = primary_account
            invoice = Invoice(
                assignment_id=assignment.id,
                partner_id=assignment.partner_id,
                invoice_number=f"{assignment.assignment_code}-I01",
                issued_date=date.today() - timedelta(days=idx),
                due_date=date.today() + timedelta(days=14 - idx),
                status=InvoiceStatus.ISSUED,
                tax_rate=Decimal(profile.default_gst_rate or Decimal("18.00")),
                created_by_user_id=users["finance"].id,
                company_account_id=account.id,
                is_paid=assignment.is_paid,
                paid_at=now - timedelta(days=1) if assignment.is_paid else None,
            )
            db.add(invoice)
            db.flush()

            replace_invoice_items(
                db,
                invoice,
                [
                    {
                        "description": f"Valuation fees ({assignment.assignment_code})",
                        "quantity": Decimal("1.00"),
                        "unit_price": assignment.fees or Decimal("0.00"),
                        "order_index": 0,
                    }
                ],
            )
            recompute_invoice_totals(invoice)
            if assignment.is_paid:
                payment = InvoicePayment(
                    invoice_id=invoice.id,
                    amount=invoice.total_amount,
                    paid_at=now - timedelta(days=1),
                    mode=PaymentMode.MANUAL,
                    created_by_user_id=users["finance"].id,
                )
                db.add(payment)
                invoice.payments.append(payment)
            recompute_invoice_balance(invoice)
            db.add(invoice)

            log_activity(
                db,
                actor_user_id=users["finance"].id,
                activity_type="INVOICE_CREATED",
                assignment_id=assignment.id,
                payload={"invoice_number": invoice.invoice_number},
            )


def seed_leaves(db: Session, users: dict[str, User]) -> None:
    if db.query(LeaveRequest).count() > 0:
        return
    today = datetime.now(timezone.utc).date()

    leave1 = LeaveRequest(
        requester_user_id=users["assistant"].id,
        leave_type=LeaveType.FULL_DAY,
        start_date=today + timedelta(days=1),
        end_date=today + timedelta(days=3),
        reason="Family trip",
        status=LeaveStatus.PENDING,
    )
    db.add(leave1)
    db.flush()

    leave2 = LeaveRequest(
        requester_user_id=users["field"].id,
        leave_type=LeaveType.FULL_DAY,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=1),
        reason="Medical leave",
        status=LeaveStatus.PENDING,
    )
    db.add(leave2)
    db.flush()

    approve_leave(db, leave=leave2, approver_user_id=users["hr"].id)


def main() -> None:
    args = parse_args()
    if args.reset:
        reset_db()

    with SessionLocal() as db:
        admin_exists = db.query(User).filter(User.email == "admin@zenops.local").first()
        if admin_exists and not args.reset:
            print("Seed appears to have already run. Use --reset to reseed.")
            return

        master = seed_master_data(db)

        users = {
            "admin": get_or_create_user(db, email="admin@zenops.local", password="password", role=Role.ADMIN, full_name="Admin"),
            "ops": get_or_create_user(db, email="ops@zenops.local", password="password", role=Role.OPS_MANAGER, full_name="Ops Manager"),
            "hr": get_or_create_user(db, email="hr@zenops.local", password="password", role=Role.HR, full_name="HR Manager"),
            "finance": get_or_create_user(db, email="finance@zenops.local", password="password", role=Role.FINANCE, full_name="Finance"),
            "assistant": get_or_create_user(
                db,
                email="assistant@zenops.local",
                password="password",
                role=Role.ASSISTANT_VALUER,
                full_name="Assistant Valuer",
            ),
            "field": get_or_create_user(
                db,
                email="field@zenops.local",
                password="password",
                role=Role.FIELD_VALUER,
                full_name="Field Valuer",
            ),
        }
        partner_data = seed_partners(db, users=users, master=master)
        assignments = seed_assignments(db, users=users, master=master, partner_data=partner_data)
        seed_tasks_messages_documents_invoices(db, assignments, users, master)
        seed_leaves(db, users)

        db.commit()
        print("Seed complete.")
        print("Admin login: admin@zenops.local / password")


if __name__ == "__main__":
    main()
