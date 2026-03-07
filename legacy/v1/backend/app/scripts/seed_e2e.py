from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.core.settings import settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.assignment_assignee import AssignmentAssignee
from app.models.assignment_floor import AssignmentFloorArea
from app.models.assignment_land_survey import AssignmentLandSurvey
from app.models.document import AssignmentDocument
from app.models.enums import (
    ApprovalActionType,
    ApprovalEntityType,
    ApprovalStatus,
    ApprovalType,
    AssignmentStatus,
    CaseType,
    CommissionRequestStatus,
    DocumentReviewStatus,
    InvoiceAdjustmentType,
    InvoiceStatus,
    PartnerRequestDirection,
    PartnerRequestEntityType,
    PartnerRequestStatus,
    PartnerRequestType,
    PaymentMode,
    Role,
    ServiceLine,
    TaskStatus,
)
from app.models.invoice import Invoice, InvoiceAdjustment, InvoicePayment
from app.models.master import ServiceLineMaster, ServiceLinePolicy
from app.models.message import AssignmentMessage
from app.models.partner import CommissionRequest, ExternalPartner, PartnerRequest
from app.models.task import AssignmentTask
from app.models.user import User
from app.seed import seed_master_data
from app.services.approvals import request_approval, required_roles_for_approval
from app.services.assignments import generate_assignment_code, generate_draft_assignment_code
from app.services.commissions import generate_commission_code
from app.services.invoices import (
    generate_invoice_number,
    recompute_invoice_balance,
    recompute_invoice_totals,
    replace_invoice_items,
)


SERVICE_LINE_SPECS = [
    {
        "key": "VALUATION_LB",
        "name": "Valuation L&B",
        "sort_order": 10,
        "policy_json": {
            "requires": ["NORMAL_LAND", "BUILT_UP"],
            "optional": ["SURVEY_ROWS"],
            "uom_required": True,
            "allow_assignment_override": True,
        },
    },
    {
        "key": "VALUATION_PLOT",
        "name": "Valuation Plot",
        "sort_order": 20,
        "policy_json": {
            "requires": ["NORMAL_LAND"],
            "optional": ["BUILT_UP", "SURVEY_ROWS"],
            "uom_required": True,
            "allow_assignment_override": True,
        },
    },
    {
        "key": "VALUATION_AGRI",
        "name": "Valuation Agri",
        "sort_order": 30,
        "policy_json": {
            "requires": ["SURVEY_ROWS"],
            "optional": ["NORMAL_LAND"],
            "uom_required": True,
            "allow_assignment_override": True,
        },
    },
    {
        "key": "PROJECT_REPORT",
        "name": "Project Report",
        "sort_order": 40,
        "policy_json": {
            "requires": ["BUILT_UP"],
            "optional": ["NORMAL_LAND"],
            "uom_required": True,
            "allow_assignment_override": True,
        },
    },
    {
        "key": "OTHERS",
        "name": "Others",
        "sort_order": 50,
        "policy_json": {
            "requires": [],
            "optional": ["NORMAL_LAND"],
            "uom_required": True,
            "allow_assignment_override": True,
        },
    },
]

DEFAULT_ALLOCATION_POLICY = {
    "eligible_roles": ["OPS_MANAGER", "ASSISTANT_VALUER", "FIELD_VALUER", "EMPLOYEE"],
    "deny_roles": ["FINANCE", "HR"],
    "weights": {
        "open_assignments": 3,
        "overdue_tasks": 8,
        "due_soon": 4,
        "inactive_penalty": 6,
    },
    "max_open_assignments_soft": 12,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reset and seed deterministic Phase 8.5 E2E data")
    parser.add_argument("--reset", action="store_true", help="Drop and recreate all tables before seeding")
    return parser.parse_args()


def reset_database() -> None:
    if not settings.destructive_actions_enabled:
        raise RuntimeError("Destructive actions are disabled in this environment.")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def get_or_create_user(
    db: Session,
    *,
    email: str,
    role: Role,
    full_name: str,
    password: str,
    partner_id: int | None = None,
) -> User:
    existing = db.query(User).filter(User.email == email.lower().strip()).first()
    if existing:
        existing.role = role
        existing.roles = [role.value]
        existing.full_name = full_name
        existing.partner_id = partner_id
        existing.hashed_password = get_password_hash(password)
        existing.is_active = True
        existing.last_login_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        db.add(existing)
        db.flush()
        return existing

    user = User(
        email=email.lower().strip(),
        hashed_password=get_password_hash(password),
        role=role,
        roles=[role.value],
        full_name=full_name,
        partner_id=partner_id,
        is_active=True,
        last_login_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )
    db.add(user)
    db.flush()
    return user


def ensure_service_lines(db: Session) -> dict[str, ServiceLineMaster]:
    by_key: dict[str, ServiceLineMaster] = {}
    for spec in SERVICE_LINE_SPECS:
        service_line = db.query(ServiceLineMaster).filter(ServiceLineMaster.key == spec["key"]).first()
        if not service_line:
            service_line = ServiceLineMaster(
                key=spec["key"],
                name=spec["name"],
                sort_order=spec["sort_order"],
                is_active=True,
                allocation_policy_json=DEFAULT_ALLOCATION_POLICY,
            )
            db.add(service_line)
            db.flush()
        else:
            service_line.name = spec["name"]
            service_line.sort_order = spec["sort_order"]
            service_line.is_active = True
            service_line.allocation_policy_json = DEFAULT_ALLOCATION_POLICY
            db.add(service_line)
            db.flush()

        policy = (
            db.query(ServiceLinePolicy)
            .filter(ServiceLinePolicy.service_line_id == service_line.id)
            .first()
        )
        if not policy:
            policy = ServiceLinePolicy(
                service_line_id=service_line.id,
                policy_json=spec["policy_json"],
            )
            db.add(policy)
            db.flush()
        else:
            policy.policy_json = spec["policy_json"]
            db.add(policy)
            db.flush()

        by_key[service_line.key] = service_line

    return by_key


def _write_fixture_file(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def seed_assignment_documents(
    db: Session,
    *,
    assignment: Assignment,
    uploader: User,
    index: int,
    uploads_root: Path,
    final_pending: bool = False,
) -> list[AssignmentDocument]:
    assignment_dir = uploads_root / assignment.assignment_code

    photo_path = assignment_dir / f"site-photo-{index}.jpg"
    screenshot_path = assignment_dir / f"guideline-{index}.png"
    pdf_path = assignment_dir / f"report-{index}.pdf"

    _write_fixture_file(photo_path, b"\xff\xd8\xff\xe0FakeJPGContent")
    _write_fixture_file(screenshot_path, b"\x89PNG\r\n\x1a\nFakePNGContent")
    _write_fixture_file(
        pdf_path,
        b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n",
    )

    docs = [
        AssignmentDocument(
            assignment_id=assignment.id,
            uploaded_by_user_id=uploader.id,
            original_name=f"site-photo-{index}.jpg",
            storage_path=str(photo_path),
            mime_type="image/jpeg",
            size=photo_path.stat().st_size,
            category="SITE_PHOTOS",
            version_number=1,
            is_final=False,
            review_status=DocumentReviewStatus.RECEIVED,
        ),
        AssignmentDocument(
            assignment_id=assignment.id,
            uploaded_by_user_id=uploader.id,
            original_name=f"guideline-{index}.png",
            storage_path=str(screenshot_path),
            mime_type="image/png",
            size=screenshot_path.stat().st_size,
            category="GUIDELINE_SCREENSHOT",
            version_number=1,
            is_final=False,
            review_status=DocumentReviewStatus.RECEIVED,
        ),
        AssignmentDocument(
            assignment_id=assignment.id,
            uploaded_by_user_id=uploader.id,
            original_name=f"report-{index}.pdf",
            storage_path=str(pdf_path),
            mime_type="application/pdf",
            size=pdf_path.stat().st_size,
            category="FINAL_REPORT",
            version_number=1,
            is_final=False,
            review_status=(
                DocumentReviewStatus.FINAL_PENDING_APPROVAL
                if final_pending
                else DocumentReviewStatus.RECEIVED
            ),
        ),
    ]
    db.add_all(docs)
    db.flush()
    return docs


def add_task(
    db: Session,
    *,
    assignment: Assignment,
    title: str,
    due_at: datetime,
    assignee: User,
    creator: User,
    status: TaskStatus = TaskStatus.TODO,
) -> None:
    task = AssignmentTask(
        assignment_id=assignment.id,
        title=title,
        description=f"{title} checklist",
        status=status,
        assigned_to_user_id=assignee.id,
        created_by_user_id=creator.id,
        due_at=due_at,
        template_type="manual",
    )
    db.add(task)


def add_message(db: Session, *, assignment: Assignment, sender: User, text: str) -> None:
    message = AssignmentMessage(
        assignment_id=assignment.id,
        sender_user_id=sender.id,
        message=text,
        mentions=[],
        pinned=False,
    )
    db.add(message)


def create_assignment(
    db: Session,
    *,
    code: str,
    creator: User,
    primary_assignee: User,
    service_line_master: ServiceLineMaster,
    service_line: ServiceLine,
    borrower_name: str,
    case_type: CaseType,
    status: AssignmentStatus,
    bank_id: int | None,
    branch_id: int | None,
    client_id: int | None,
    property_type_id: int | None,
    property_subtype_id: int | None,
    land_area: Decimal | None,
    builtup_area: Decimal | None,
    uom: str,
    service_line_other_text: str | None = None,
    partner_id: int | None = None,
    commission_request_id: int | None = None,
    created_offset_hours: int = 0,
) -> Assignment:
    now = datetime.now(timezone.utc) - timedelta(hours=created_offset_hours)
    assignment = Assignment(
        assignment_code=code,
        case_type=case_type,
        service_line=service_line,
        service_line_id=service_line_master.id,
        service_line_other_text=service_line_other_text,
        uom=uom,
        bank_id=bank_id,
        branch_id=branch_id,
        client_id=client_id,
        property_type_id=property_type_id,
        property_subtype_id=property_subtype_id,
        borrower_name=borrower_name,
        phone="9000000000",
        address=f"{borrower_name} property address",
        land_area=land_area,
        builtup_area=builtup_area,
        status=status,
        created_by_user_id=creator.id,
        assigned_to_user_id=primary_assignee.id,
        assigned_at=now,
        site_visit_date=now + timedelta(days=1),
        report_due_date=now + timedelta(days=3),
        fees=Decimal("6500.00"),
        is_paid=False,
        notes=f"Seeded assignment for {borrower_name}",
        partner_id=partner_id,
        commission_request_id=commission_request_id,
        created_at=now,
        updated_at=now,
    )
    db.add(assignment)
    db.flush()
    return assignment


def create_invoice_with_item(
    db: Session,
    *,
    assignment: Assignment,
    created_by: User,
    issued_days_ago: int,
    total: Decimal,
) -> Invoice:
    issued_date = date.today() - timedelta(days=issued_days_ago)
    invoice = Invoice(
        assignment_id=assignment.id,
        partner_id=assignment.partner_id,
        invoice_number=generate_invoice_number(db, issued_date=issued_date),
        issued_date=issued_date,
        due_date=issued_date + timedelta(days=14),
        status=InvoiceStatus.ISSUED,
        tax_rate=Decimal("18.00"),
        created_by_user_id=created_by.id,
        notes="E2E seeded invoice",
    )
    db.add(invoice)
    db.flush()

    replace_invoice_items(
        db,
        invoice,
        [
            {
                "description": f"Service fees for {assignment.assignment_code}",
                "quantity": Decimal("1.00"),
                "unit_price": total,
                "order_index": 0,
            }
        ],
    )
    recompute_invoice_totals(invoice)
    recompute_invoice_balance(invoice)
    db.add(invoice)
    db.flush()
    return invoice


def create_pending_payment_approval(
    db: Session,
    *,
    invoice: Invoice,
    requester: User,
    amount: Decimal,
    mode: PaymentMode,
) -> tuple[InvoicePayment, Approval]:
    payment = InvoicePayment(
        invoice_id=invoice.id,
        amount=amount,
        paid_at=datetime.now(timezone.utc) - timedelta(minutes=15),
        mode=mode,
        reference_no=f"E2E-{invoice.id}",
        notes="Pending confirmation from approvals inbox",
        created_by_user_id=requester.id,
        confirmation_status="PENDING_CONFIRMATION",
    )
    db.add(payment)
    db.flush()

    approval = Approval(
        approval_type=ApprovalType.PAYMENT_CONFIRMATION,
        entity_type=ApprovalEntityType.PAYMENT,
        entity_id=payment.id,
        action_type=ApprovalActionType.MARK_PAID,
        requester_user_id=requester.id,
        approver_user_id=None,
        status=ApprovalStatus.PENDING,
        reason="Payment confirmation required",
        payload_json={
            "invoice_id": invoice.id,
            "payment_id": payment.id,
            "amount": str(amount),
            "mode": mode.value,
        },
        metadata_json={
            "invoice_number": invoice.invoice_number,
            "assignment_id": invoice.assignment_id,
            "reference_no": payment.reference_no,
        },
        assignment_id=invoice.assignment_id,
    )
    allowed_roles = required_roles_for_approval(approval.entity_type, approval.action_type, approval.approval_type)
    request_approval(db, approval=approval, allowed_roles=allowed_roles, auto_assign=False)

    payment.approval_id = approval.id
    db.add(payment)
    invoice.payments.append(payment)
    recompute_invoice_balance(invoice)
    db.add(invoice)
    db.flush()
    return payment, approval


def seed() -> None:
    with SessionLocal() as db:
        master = seed_master_data(db)
        service_lines = ensure_service_lines(db)

        admin = get_or_create_user(
            db,
            email="admin@maulya.local",
            role=Role.ADMIN,
            full_name="Admin",
            password="password",
        )
        ops = get_or_create_user(
            db,
            email="ops@maulya.local",
            role=Role.OPS_MANAGER,
            full_name="Ops Manager",
            password="password",
        )
        finance = get_or_create_user(
            db,
            email="finance@maulya.local",
            role=Role.FINANCE,
            full_name="Finance Manager",
            password="password",
        )
        hr = get_or_create_user(
            db,
            email="hr@maulya.local",
            role=Role.HR,
            full_name="HR Manager",
            password="password",
        )
        assistant = get_or_create_user(
            db,
            email="assistant@maulya.local",
            role=Role.ASSISTANT_VALUER,
            full_name="Assistant Valuer",
            password="password",
        )
        field = get_or_create_user(
            db,
            email="field@maulya.local",
            role=Role.FIELD_VALUER,
            full_name="Field Valuer",
            password="password",
        )

        partner = ExternalPartner(
            display_name="E2E Associate Partner",
            legal_name="E2E Associate Partner Pvt Ltd",
            contact_name="Associate User",
            email="associate@maulya.local",
            phone="9000001111",
            city="Bengaluru",
            service_lines=[ServiceLine.VALUATION.value, ServiceLine.DPR.value],
            multi_floor_enabled=True,
            is_active=True,
            notes="Deterministic partner account for Playwright",
        )
        db.add(partner)
        db.flush()

        associate = get_or_create_user(
            db,
            email="associate@maulya.local",
            role=Role.EXTERNAL_PARTNER,
            full_name="Associate User",
            password="password",
            partner_id=partner.id,
        )

        # Provide explicit user-allocation preferences for personnel toggles.
        assistant.allocation_prefs_json = {"service_lines": {"VALUATION_LB": True, "VALUATION_PLOT": True, "VALUATION_AGRI": True}}
        field.allocation_prefs_json = {"service_lines": {"VALUATION_LB": True, "VALUATION_PLOT": True, "VALUATION_AGRI": True}}
        finance.allocation_prefs_json = {"service_lines": {"VALUATION_LB": False, "VALUATION_PLOT": False, "VALUATION_AGRI": False}}
        hr.allocation_prefs_json = {"service_lines": {"VALUATION_LB": False, "VALUATION_PLOT": False, "VALUATION_AGRI": False}}
        db.add_all([assistant, field, finance, hr])

        banks = master["banks"]
        branches = master["branches"]
        clients = master["clients"]
        property_types = master["property_types"]
        subtype_map = master["property_subtypes_by_type"]

        flat = property_types[0]
        house = property_types[1]
        land = property_types[2]
        commercial = property_types[3]

        flat_sub = subtype_map.get(flat.id, [None])[0]
        house_sub = subtype_map.get(house.id, [None])[0]
        land_sub = subtype_map.get(land.id, [None])[0]
        commercial_sub = subtype_map.get(commercial.id, [None])[0]

        # 1) Plot valuation
        a_plot = create_assignment(
            db,
            code=generate_assignment_code(db),
            creator=ops,
            primary_assignee=assistant,
            service_line_master=service_lines["VALUATION_PLOT"],
            service_line=ServiceLine.VALUATION,
            borrower_name="Plot Borrower",
            case_type=CaseType.BANK,
            status=AssignmentStatus.PENDING,
            bank_id=banks[0].id,
            branch_id=branches[0].id,
            client_id=None,
            property_type_id=land.id,
            property_subtype_id=land_sub.id if land_sub else None,
            land_area=Decimal("2400.00"),
            builtup_area=None,
            uom="SQFT",
            created_offset_hours=36,
        )

        # 2) Land & building valuation
        a_lb = create_assignment(
            db,
            code=generate_assignment_code(db),
            creator=ops,
            primary_assignee=assistant,
            service_line_master=service_lines["VALUATION_LB"],
            service_line=ServiceLine.VALUATION,
            borrower_name="Land Building Borrower",
            case_type=CaseType.BANK,
            status=AssignmentStatus.UNDER_PROCESS,
            bank_id=banks[1].id,
            branch_id=branches[2].id,
            client_id=None,
            property_type_id=house.id,
            property_subtype_id=house_sub.id if house_sub else None,
            land_area=Decimal("1800.00"),
            builtup_area=Decimal("1250.00"),
            uom="SQFT",
            created_offset_hours=30,
        )

        db.add(
            AssignmentFloorArea(
                assignment_id=a_lb.id,
                floor_name="Ground Floor",
                area=Decimal("650.00"),
                order_index=0,
            )
        )
        db.add(
            AssignmentFloorArea(
                assignment_id=a_lb.id,
                floor_name="First Floor",
                area=Decimal("600.00"),
                order_index=1,
            )
        )

        # 3) Agri valuation with survey rows + kharab
        a_agri = create_assignment(
            db,
            code=generate_assignment_code(db),
            creator=ops,
            primary_assignee=field,
            service_line_master=service_lines["VALUATION_AGRI"],
            service_line=ServiceLine.VALUATION,
            borrower_name="Agri Borrower",
            case_type=CaseType.BANK,
            status=AssignmentStatus.SITE_VISIT,
            bank_id=banks[0].id,
            branch_id=branches[1].id,
            client_id=None,
            property_type_id=land.id,
            property_subtype_id=land_sub.id if land_sub else None,
            land_area=Decimal("0.00"),
            builtup_area=None,
            uom="ACRE_GUNTA_AANA",
            created_offset_hours=24,
        )
        db.add_all(
            [
                AssignmentLandSurvey(
                    assignment_id=a_agri.id,
                    serial_no=1,
                    survey_no="SR-101",
                    acre=Decimal("1"),
                    gunta=Decimal("20"),
                    aana=Decimal("0"),
                    kharab_acre=Decimal("0"),
                    kharab_gunta=Decimal("2"),
                    kharab_aana=Decimal("0"),
                ),
                AssignmentLandSurvey(
                    assignment_id=a_agri.id,
                    serial_no=2,
                    survey_no="SR-102",
                    acre=Decimal("0"),
                    gunta=Decimal("18"),
                    aana=Decimal("4"),
                    kharab_acre=Decimal("0"),
                    kharab_gunta=Decimal("1"),
                    kharab_aana=Decimal("2"),
                ),
            ]
        )

        # 4) Project report service line
        a_project = create_assignment(
            db,
            code=generate_assignment_code(db),
            creator=ops,
            primary_assignee=assistant,
            service_line_master=service_lines["PROJECT_REPORT"],
            service_line=ServiceLine.DPR,
            borrower_name="Project Report Borrower",
            case_type=CaseType.BANK,
            status=AssignmentStatus.PENDING,
            bank_id=banks[2].id,
            branch_id=branches[3].id,
            client_id=None,
            property_type_id=commercial.id,
            property_subtype_id=commercial_sub.id if commercial_sub else None,
            land_area=Decimal("3000.00"),
            builtup_area=Decimal("2100.00"),
            uom="SQFT",
            created_offset_hours=20,
        )

        # 5) Others service line with description
        a_other = create_assignment(
            db,
            code=generate_assignment_code(db),
            creator=ops,
            primary_assignee=assistant,
            service_line_master=service_lines["OTHERS"],
            service_line=ServiceLine.VALUATION,
            borrower_name="Others Service Borrower",
            case_type=CaseType.DIRECT_CLIENT,
            status=AssignmentStatus.PENDING,
            bank_id=None,
            branch_id=None,
            client_id=clients[0].id,
            property_type_id=flat.id,
            property_subtype_id=flat_sub.id if flat_sub else None,
            land_area=Decimal("1200.00"),
            builtup_area=Decimal("860.00"),
            uom="SQFT",
            service_line_other_text="Special technical due diligence",
            partner_id=partner.id,
            created_offset_hours=18,
        )

        # 6) Draft assignment pending approval (field valuer)
        draft_assignment = create_assignment(
            db,
            code=generate_draft_assignment_code(db),
            creator=field,
            primary_assignee=field,
            service_line_master=service_lines["VALUATION_PLOT"],
            service_line=ServiceLine.VALUATION,
            borrower_name="Draft Assignment Borrower",
            case_type=CaseType.BANK,
            status=AssignmentStatus.DRAFT_PENDING_APPROVAL,
            bank_id=banks[1].id,
            branch_id=branches[2].id,
            client_id=None,
            property_type_id=land.id,
            property_subtype_id=land_sub.id if land_sub else None,
            land_area=Decimal("900.00"),
            builtup_area=None,
            uom="SQFT",
            created_offset_hours=12,
        )

        # Shared assignees improve assignment list realism.
        db.add_all(
            [
                AssignmentAssignee(assignment_id=a_lb.id, user_id=field.id),
                AssignmentAssignee(assignment_id=a_project.id, user_id=assistant.id),
                AssignmentAssignee(assignment_id=a_project.id, user_id=field.id),
            ]
        )

        now = datetime.now(timezone.utc)
        add_task(
            db,
            assignment=a_plot,
            title="Collect site photos",
            due_at=now - timedelta(days=1),
            assignee=assistant,
            creator=ops,
            status=TaskStatus.TODO,
        )
        add_task(
            db,
            assignment=a_lb,
            title="Prepare valuation sheet",
            due_at=now + timedelta(hours=20),
            assignee=assistant,
            creator=ops,
            status=TaskStatus.DOING,
        )
        add_task(
            db,
            assignment=a_agri,
            title="Survey row verification",
            due_at=now + timedelta(days=2),
            assignee=field,
            creator=ops,
            status=TaskStatus.TODO,
        )
        add_task(
            db,
            assignment=a_project,
            title="Finalize project assumptions",
            due_at=now + timedelta(hours=10),
            assignee=assistant,
            creator=ops,
            status=TaskStatus.TODO,
        )
        add_task(
            db,
            assignment=a_other,
            title="Client clarification call",
            due_at=now + timedelta(days=3),
            assignee=assistant,
            creator=ops,
            status=TaskStatus.TODO,
        )

        add_message(db, assignment=a_plot, sender=ops, text="Please prioritize this valuation.")
        add_message(db, assignment=a_lb, sender=assistant, text="Field visit completed.")
        add_message(db, assignment=a_project, sender=ops, text="Awaiting latest land records.")
        add_message(db, assignment=a_other, sender=assistant, text="Received initial client packet.")

        uploads_root = settings.ensure_uploads_dir()
        docs_plot = seed_assignment_documents(db, assignment=a_plot, uploader=assistant, index=1, uploads_root=uploads_root)
        docs_lb = seed_assignment_documents(db, assignment=a_lb, uploader=assistant, index=2, uploads_root=uploads_root)
        docs_agri = seed_assignment_documents(db, assignment=a_agri, uploader=field, index=3, uploads_root=uploads_root)
        docs_project = seed_assignment_documents(
            db,
            assignment=a_project,
            uploader=assistant,
            index=4,
            uploads_root=uploads_root,
            final_pending=True,
        )
        seed_assignment_documents(db, assignment=a_other, uploader=assistant, index=5, uploads_root=uploads_root)
        seed_assignment_documents(db, assignment=draft_assignment, uploader=field, index=6, uploads_root=uploads_root)

        # Pending approval: draft assignment
        draft_approval = Approval(
            approval_type=ApprovalType.DRAFT_ASSIGNMENT,
            entity_type=ApprovalEntityType.ASSIGNMENT,
            entity_id=draft_assignment.id,
            action_type=ApprovalActionType.FINAL_REVIEW,
            requester_user_id=field.id,
            approver_user_id=None,
            status=ApprovalStatus.PENDING,
            reason="Draft assignment submitted for approval",
            payload_json={"temporary_code": draft_assignment.assignment_code},
            metadata_json={
                "assignment_code": draft_assignment.assignment_code,
                "borrower_name": draft_assignment.borrower_name,
                "service_line": draft_assignment.service_line_name,
            },
            assignment_id=draft_assignment.id,
        )
        request_approval(
            db,
            approval=draft_approval,
            allowed_roles=required_roles_for_approval(
                draft_approval.entity_type,
                draft_approval.action_type,
                draft_approval.approval_type,
            ),
            auto_assign=False,
        )

        # Pending approval: final document review
        project_final_doc = docs_project[-1]
        final_doc_approval = Approval(
            approval_type=ApprovalType.FINAL_DOC_REVIEW,
            entity_type=ApprovalEntityType.DOCUMENT,
            entity_id=project_final_doc.id,
            action_type=ApprovalActionType.FINAL_REVIEW,
            requester_user_id=assistant.id,
            approver_user_id=None,
            status=ApprovalStatus.PENDING,
            reason="Final document submitted for review approval",
            payload_json={"assignment_id": a_project.id, "document_id": project_final_doc.id},
            metadata_json={
                "assignment_code": a_project.assignment_code,
                "document_name": project_final_doc.original_name,
                "category": project_final_doc.category,
            },
            assignment_id=a_project.id,
        )
        request_approval(
            db,
            approval=final_doc_approval,
            allowed_roles=required_roles_for_approval(
                final_doc_approval.entity_type,
                final_doc_approval.action_type,
                final_doc_approval.approval_type,
            ),
            auto_assign=False,
        )

        # Invoices
        invoice_pending_confirmation = create_invoice_with_item(
            db,
            assignment=a_lb,
            created_by=finance,
            issued_days_ago=3,
            total=Decimal("10000.00"),
        )
        _, payment_approval = create_pending_payment_approval(
            db,
            invoice=invoice_pending_confirmation,
            requester=finance,
            amount=Decimal("3000.00"),
            mode=PaymentMode.UPI,
        )

        invoice_adjusted = create_invoice_with_item(
            db,
            assignment=a_agri,
            created_by=finance,
            issued_days_ago=5,
            total=Decimal("12000.00"),
        )
        confirmed_payment = InvoicePayment(
            invoice_id=invoice_adjusted.id,
            amount=Decimal("5000.00"),
            paid_at=datetime.now(timezone.utc) - timedelta(days=2),
            mode=PaymentMode.CASH,
            reference_no="E2E-CASH-01",
            notes="Seeded confirmed payment",
            created_by_user_id=finance.id,
            confirmation_status="CONFIRMED",
            confirmed_by_user_id=finance.id,
            confirmed_at=datetime.now(timezone.utc) - timedelta(days=2),
        )
        db.add(confirmed_payment)
        db.flush()
        invoice_adjusted.payments.append(confirmed_payment)

        adjustment = InvoiceAdjustment(
            invoice_id=invoice_adjusted.id,
            amount=Decimal("700.00"),
            adjustment_type=InvoiceAdjustmentType.DISCOUNT,
            reason="Pilot discount adjustment",
            issued_at=datetime.now(timezone.utc) - timedelta(days=1),
            created_by_user_id=finance.id,
        )
        db.add(adjustment)
        db.flush()
        invoice_adjusted.adjustments.append(adjustment)
        recompute_invoice_balance(invoice_adjusted)
        db.add(invoice_adjusted)

        # Partner commission + interaction seed
        commission = CommissionRequest(
            request_code=generate_commission_code(db),
            partner_id=partner.id,
            status=CommissionRequestStatus.CONVERTED,
            service_line=ServiceLine.VALUATION,
            bank_id=banks[0].id,
            branch_id=branches[0].id,
            bank_name=banks[0].name,
            branch_name=branches[0].name,
            borrower_name="Associate Commission Borrower",
            phone="9888800000",
            address="Partner site address",
            land_area=Decimal("1450.00"),
            builtup_area=Decimal("980.00"),
            created_by_user_id=associate.id,
            submitted_at=datetime.now(timezone.utc) - timedelta(days=2),
            decided_at=datetime.now(timezone.utc) - timedelta(days=1),
            converted_assignment_id=a_other.id,
        )
        db.add(commission)
        db.flush()

        a_other.commission_request_id = commission.id
        db.add(a_other)

        partner_request = PartnerRequest(
            partner_id=partner.id,
            direction=PartnerRequestDirection.INTERNAL_TO_PARTNER,
            request_type=PartnerRequestType.DOC_REQUEST,
            entity_type=PartnerRequestEntityType.ASSIGNMENT,
            entity_id=a_other.id,
            status=PartnerRequestStatus.OPEN,
            message="Please upload the missing ownership supporting document.",
            created_by_user_id=ops.id,
        )
        db.add(partner_request)

        # Explicitly persist references used by e2e assertions.
        db.flush()

        db.commit()

        print("[seed_e2e] complete")
        print("[seed_e2e] users:")
        print("  admin@maulya.local / password")
        print("  ops@maulya.local / password")
        print("  finance@maulya.local / password")
        print("  hr@maulya.local / password")
        print("  assistant@maulya.local / password")
        print("  field@maulya.local / password")
        print("  associate@maulya.local / password")
        print(f"[seed_e2e] pending approvals: draft={draft_approval.id}, final_doc={final_doc_approval.id}, payment={payment_approval.id}")
        print(f"[seed_e2e] invoices: pending_confirmation={invoice_pending_confirmation.id}, adjusted={invoice_adjusted.id}")


def main() -> None:
    args = parse_args()
    if args.reset:
        reset_database()
    seed()


if __name__ == "__main__":
    main()
