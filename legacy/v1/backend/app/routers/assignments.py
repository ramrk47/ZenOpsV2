from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.guards import require_destructive_allowed
from app.db.session import get_db
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.assignment_assignee import AssignmentAssignee
from app.models.enums import (
    ApprovalActionType,
    ApprovalEntityType,
    ApprovalStatus,
    AssignmentStatus,
    CaseType,
    NotificationType,
    ServiceLine,
    TaskStatus,
)
from app.models.master import Bank, Branch, Client, PropertySubtype, PropertyType
from app.models.message import AssignmentMessage
from app.models.task import AssignmentTask
from app.models.user import User
from app.schemas.approval import ApprovalRead
from app.schemas.assignment import (
    AssignmentCreate,
    AssignmentDetail,
    AssignmentRead,
    AssignmentUpdate,
    AssignmentWithDue,
    DueInfo,
    MissingDocsReminderRequest,
)
from app.schemas.audit import ActivityRead
from app.schemas.document import DocumentChecklist, DocumentRead
from app.schemas.invoice import InvoiceRead
from app.schemas.message import MessageRead
from app.schemas.task import TaskRead
from app.services.activity import log_activity
from app.services.approvals import request_approval, required_roles_for_approval
from app.services.notifications import notify_roles
from app.services.assignments import (
    apply_access_filter,
    compute_due_info,
    compute_missing_document_categories,
    ensure_assignment_access,
    generate_assignment_code,
    maybe_emit_due_soon_notifications,
    notify_assignment_assignees,
    sync_assignment_assignees,
    sync_assignment_floors,
    validate_property_subtype,
    maybe_emit_overdue_notifications,
)
from app.services.calendar import upsert_assignment_events, upsert_task_due_event
from app.services.leave import current_leave

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


CompletionFilter = Literal["ALL", "PENDING", "COMPLETED"]
SortDir = Literal["asc", "desc"]


SORT_FIELDS = {
    "assignment_code": Assignment.assignment_code,
    "created_at": Assignment.created_at,
    "updated_at": Assignment.updated_at,
    "site_visit_date": Assignment.site_visit_date,
    "report_due_date": Assignment.report_due_date,
    "status": Assignment.status,
    "fees": Assignment.fees,
}


OPEN_STATUSES = {
    AssignmentStatus.PENDING,
    AssignmentStatus.SITE_VISIT,
    AssignmentStatus.UNDER_PROCESS,
    AssignmentStatus.SUBMITTED,
}


def _base_query(db: Session):
    return db.query(Assignment).filter(Assignment.is_deleted.is_(False))


def _apply_completion_filter(query, completion: CompletionFilter):
    if completion == "PENDING":
        return query.filter(Assignment.status.in_(OPEN_STATUSES))
    if completion == "COMPLETED":
        return query.filter(Assignment.status.in_([AssignmentStatus.COMPLETED, AssignmentStatus.CANCELLED]))
    return query


def _apply_sort(query, sort_by: str, sort_dir: SortDir):
    column = SORT_FIELDS.get(sort_by, Assignment.created_at)
    if sort_dir == "asc":
        return query.order_by(column.asc())
    return query.order_by(column.desc())


def _enrich_names(db: Session, assignment: Assignment) -> None:
    if assignment.bank_id and not assignment.bank_name:
        bank = db.get(Bank, assignment.bank_id)
        if bank:
            assignment.bank_name = bank.name
    if assignment.branch_id and not assignment.branch_name:
        branch = db.get(Branch, assignment.branch_id)
        if branch:
            assignment.branch_name = branch.name
    if assignment.client_id and not assignment.valuer_client_name:
        client = db.get(Client, assignment.client_id)
        if client:
            assignment.valuer_client_name = client.name
    if assignment.property_type_id and not assignment.property_type:
        prop = db.get(PropertyType, assignment.property_type_id)
        if prop:
            assignment.property_type = prop.name


def _require_assignment_access(assignment: Assignment, current_user: User) -> None:
    try:
        ensure_assignment_access(assignment, current_user)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("", response_model=List[AssignmentRead])
def list_assignments(
    case_type: Optional[CaseType] = Query(None),
    service_line: Optional[ServiceLine] = Query(None),
    status_filter: Optional[AssignmentStatus] = Query(None, alias="status"),
    bank_id: Optional[int] = Query(None),
    branch_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    client_name: Optional[str] = Query(None, max_length=120),
    property_type_id: Optional[int] = Query(None),
    created_from: Optional[datetime] = Query(None),
    created_to: Optional[datetime] = Query(None),
    completion: CompletionFilter = Query("ALL"),
    is_paid: Optional[bool] = Query(None),
    assigned_to_user_id: Optional[int] = Query(None),
    unassigned: bool = Query(False),
    created_by_user_id: Optional[int] = Query(None),
    mine: bool = Query(False),
    sort_by: str = Query("created_at"),
    sort_dir: SortDir = Query("desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[AssignmentRead]:
    query = apply_access_filter(_base_query(db), current_user)

    if mine:
        assignee_subquery = select(AssignmentAssignee.assignment_id).where(
            AssignmentAssignee.user_id == current_user.id
        )
        query = query.filter(
            or_(
                Assignment.assigned_to_user_id == current_user.id,
                Assignment.created_by_user_id == current_user.id,
                Assignment.id.in_(assignee_subquery),
            )
        )

    if case_type:
        query = query.filter(Assignment.case_type == case_type)
    if service_line:
        query = query.filter(Assignment.service_line == service_line)
    if status_filter:
        query = query.filter(Assignment.status == status_filter)
    if bank_id:
        query = query.filter(Assignment.bank_id == bank_id)
    if branch_id:
        query = query.filter(Assignment.branch_id == branch_id)
    if client_id:
        query = query.filter(Assignment.client_id == client_id)
    if client_name:
        pattern = f"%{client_name}%"
        query = query.outerjoin(Client, Assignment.client_id == Client.id).filter(
            or_(
                Assignment.valuer_client_name.ilike(pattern),
                Client.name.ilike(pattern),
            )
        )
    if property_type_id:
        query = query.filter(Assignment.property_type_id == property_type_id)
    if created_from:
        query = query.filter(Assignment.created_at >= created_from)
    if created_to:
        query = query.filter(Assignment.created_at <= created_to)
    if is_paid is not None:
        query = query.filter(Assignment.is_paid.is_(is_paid))
    if assigned_to_user_id:
        assignee_subquery = select(AssignmentAssignee.assignment_id).where(
            AssignmentAssignee.user_id == assigned_to_user_id
        )
        query = query.filter(
            or_(
                Assignment.assigned_to_user_id == assigned_to_user_id,
                Assignment.id.in_(assignee_subquery),
            )
        )
    if unassigned:
        assignee_subquery = select(AssignmentAssignee.assignment_id)
        query = query.filter(
            Assignment.assigned_to_user_id.is_(None),
            ~Assignment.id.in_(assignee_subquery),
        )
    if created_by_user_id:
        query = query.filter(Assignment.created_by_user_id == created_by_user_id)

    query = _apply_completion_filter(query, completion)
    query = _apply_sort(query, sort_by, sort_dir)

    assignments = query.offset(skip).limit(limit).all()
    return [AssignmentRead.model_validate(a) for a in assignments]


@router.get("/with-due", response_model=List[AssignmentWithDue])
def list_assignments_with_due(
    case_type: Optional[CaseType] = Query(None),
    service_line: Optional[ServiceLine] = Query(None),
    status_filter: Optional[AssignmentStatus] = Query(None, alias="status"),
    bank_id: Optional[int] = Query(None),
    branch_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    client_name: Optional[str] = Query(None, max_length=120),
    property_type_id: Optional[int] = Query(None),
    created_from: Optional[datetime] = Query(None),
    created_to: Optional[datetime] = Query(None),
    completion: CompletionFilter = Query("ALL"),
    is_paid: Optional[bool] = Query(None),
    assigned_to_user_id: Optional[int] = Query(None),
    unassigned: bool = Query(False),
    created_by_user_id: Optional[int] = Query(None),
    mine: bool = Query(False),
    sort_by: str = Query("created_at"),
    sort_dir: SortDir = Query("desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[AssignmentWithDue]:
    assignments = list_assignments(
        case_type=case_type,
        service_line=service_line,
        status_filter=status_filter,
        bank_id=bank_id,
        branch_id=branch_id,
        client_id=client_id,
        client_name=client_name,
        property_type_id=property_type_id,
        created_from=created_from,
        created_to=created_to,
        completion=completion,
        is_paid=is_paid,
        assigned_to_user_id=assigned_to_user_id,
        unassigned=unassigned,
        created_by_user_id=created_by_user_id,
        mine=mine,
        sort_by=sort_by,
        sort_dir=sort_dir,
        skip=skip,
        limit=limit,
        db=db,
        current_user=current_user,
    )

    now = datetime.now(timezone.utc)
    response: List[AssignmentWithDue] = []
    for assignment_read in assignments:
        assignment = db.get(Assignment, assignment_read.id)
        if not assignment:
            continue
        due_info = compute_due_info(assignment, now=now)
        maybe_emit_overdue_notifications(db, assignment, due_info)
        missing_docs = compute_missing_document_categories(db, assignment)
        payload = {
            **assignment_read.model_dump(),
            **due_info.model_dump(),
            "missing_documents_count": len(missing_docs),
        }
        response.append(AssignmentWithDue(**payload))
    db.commit()
    return response


@router.get("/{assignment_id}", response_model=AssignmentRead)
def get_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentRead:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    _require_assignment_access(assignment, current_user)
    return AssignmentRead.model_validate(assignment)


@router.get("/{assignment_id}/detail", response_model=AssignmentDetail)
def get_assignment_detail(
    assignment_id: int,
    timeline_order: SortDir = Query("desc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentDetail:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    _require_assignment_access(assignment, current_user)

    due_info = compute_due_info(assignment)
    missing_docs = compute_missing_document_categories(db, assignment)

    documents = [DocumentRead.model_validate(d).model_dump() for d in assignment.documents]
    tasks = [TaskRead.model_validate(t).model_dump() for t in assignment.tasks]
    messages = [MessageRead.model_validate(m).model_dump() for m in assignment.messages]
    approvals = [ApprovalRead.model_validate(a).model_dump() for a in assignment.approvals]
    invoices = [
        InvoiceRead.model_validate(i).model_dump() | {"assignment_code": assignment.assignment_code}
        for i in assignment.invoices
    ]
    timeline = sorted(
        [ActivityRead.model_validate(a).model_dump() for a in assignment.activities],
        key=lambda row: row.get("created_at") or datetime.min,
        reverse=timeline_order == "desc",
    )

    return AssignmentDetail(
        assignment=AssignmentRead.model_validate(assignment),
        due=due_info,
        documents=documents,
        tasks=tasks,
        messages=messages,
        approvals=approvals,
        invoices=invoices,
        timeline=timeline,
        missing_documents=missing_docs,
    )


@router.get("/{assignment_id}/documents/checklist", response_model=DocumentChecklist)
def get_assignment_document_checklist(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentChecklist:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    _require_assignment_access(assignment, current_user)

    required = set(compute_missing_document_categories(db, assignment) + [d.category for d in assignment.documents if d.category])
    present = {d.category for d in assignment.documents if d.category}
    missing = sorted(required - present)

    return DocumentChecklist(
        required_categories=sorted(required),
        present_categories=sorted(present),
        missing_categories=missing,
    )


@router.post("/{assignment_id}/documents/remind", response_model=dict)
def remind_missing_documents(
    assignment_id: int,
    reminder: MissingDocsReminderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    _require_assignment_access(assignment, current_user)

    missing_docs = compute_missing_document_categories(db, assignment)
    if not missing_docs:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No missing documents to remind")

    summary = ", ".join(missing_docs[:6])
    if len(missing_docs) > 6:
        summary = f"{summary} (+{len(missing_docs) - 6} more)"
    message = reminder.message or f"Missing documents: {summary}"

    task_id = None
    if reminder.create_task:
        assignee_id = reminder.assigned_to_user_id or assignment.assigned_to_user_id
        task = AssignmentTask(
            assignment_id=assignment.id,
            title="Missing documents",
            description=message,
            status=TaskStatus.TODO,
            assigned_to_user_id=assignee_id,
            due_at=reminder.due_at,
            created_by_user_id=current_user.id,
            template_type="DOC_REQUEST",
        )
        db.add(task)
        db.flush()
        upsert_task_due_event(db, task=task, assignment=assignment, actor_user_id=current_user.id)
        task_id = task.id

    db.add(
        AssignmentMessage(
            assignment_id=assignment.id,
            sender_user_id=current_user.id,
            message=message,
            mentions=None,
            pinned=False,
        )
    )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="MISSING_DOC_REMINDER",
        assignment_id=assignment.id,
        message=message,
        payload={"missing": missing_docs, "task_id": task_id},
    )

    notify_assignment_assignees(
        db,
        assignment,
        notif_type=NotificationType.MISSING_DOC,
        message=message,
        payload={"assignment_id": assignment.id, "missing": missing_docs, "task_id": task_id},
        exclude_user_ids=[current_user.id],
    )

    db.commit()
    return {"detail": "Reminder sent", "missing_documents": missing_docs, "task_id": task_id}


@router.post("", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(
    assignment_in: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentRead:
    capabilities = rbac.get_capabilities_for_user(current_user)
    if not capabilities.get("create_assignment"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to create assignment")

    try:
        validate_property_subtype(
            db,
            property_type_id=assignment_in.property_type_id,
            property_subtype_id=assignment_in.property_subtype_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if (assignment_in.fees is not None or assignment_in.is_paid) and not rbac.can_modify_money(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to set financial fields")

    override_on_leave = bool(getattr(assignment_in, "override_on_leave", False))
    assignee_ids = list(assignment_in.assignee_user_ids or [])
    primary_assignee_id = assignment_in.assigned_to_user_id or (assignee_ids[0] if assignee_ids else None)

    if not override_on_leave:
        check_ids = {uid for uid in assignee_ids if uid} | ({primary_assignee_id} if primary_assignee_id else set())
        for user_id in check_ids:
            leave = current_leave(db, user_id=int(user_id))
            if leave:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": "Assignee is currently on approved leave",
                        "user_id": user_id,
                        "leave_request_id": leave.id,
                        "leave_start": leave.start_date.isoformat(),
                        "leave_end": (leave.end_date or leave.start_date).isoformat(),
                    },
                )

    assignment = Assignment(
        assignment_code=generate_assignment_code(db),
        case_type=assignment_in.case_type,
        service_line=assignment_in.service_line,
        bank_id=assignment_in.bank_id,
        branch_id=assignment_in.branch_id,
        client_id=assignment_in.client_id,
        property_type_id=assignment_in.property_type_id,
        property_subtype_id=assignment_in.property_subtype_id,
        bank_name=assignment_in.bank_name,
        branch_name=assignment_in.branch_name,
        valuer_client_name=assignment_in.valuer_client_name,
        property_type=assignment_in.property_type,
        borrower_name=assignment_in.borrower_name,
        phone=assignment_in.phone,
        address=assignment_in.address,
        land_area=assignment_in.land_area,
        builtup_area=assignment_in.builtup_area,
        status=assignment_in.status,
        created_by_user_id=current_user.id,
        assigned_to_user_id=primary_assignee_id,
        assigned_at=datetime.now(timezone.utc) if primary_assignee_id else None,
        site_visit_date=assignment_in.site_visit_date,
        report_due_date=assignment_in.report_due_date,
        fees=assignment_in.fees,
        is_paid=assignment_in.is_paid,
        notes=assignment_in.notes,
    )
    _enrich_names(db, assignment)

    db.add(assignment)
    db.flush()

    sync_assignment_assignees(db, assignment, assignee_ids)
    upsert_assignment_events(db, assignment=assignment, actor_user_id=current_user.id)
    if assignment_in.floors:
        total_area = sync_assignment_floors(db, assignment, assignment_in.floors)
        if total_area is not None:
            assignment.builtup_area = total_area
            db.add(assignment)
            db.flush()

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="ASSIGNMENT_CREATED",
        assignment_id=assignment.id,
        message=f"Assignment {assignment.assignment_code} created",
        payload={
            "case_type": str(assignment.case_type),
            "assignee_user_ids": assignment.assignee_user_ids,
        },
    )

    notify_assignment_assignees(
        db,
        assignment,
        notif_type=NotificationType.ASSIGNMENT_ASSIGNED,
        message=f"New assignment assigned: {assignment.assignment_code}",
        payload={"assignment_id": assignment.id},
        exclude_user_ids=[current_user.id],
    )

    db.commit()
    db.refresh(assignment)
    return AssignmentRead.model_validate(assignment)


@router.patch("/{assignment_id}", response_model=AssignmentRead)
def update_assignment(
    assignment_id: int,
    assignment_update: AssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentRead:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    _require_assignment_access(assignment, current_user)

    capabilities = rbac.get_capabilities_for_user(current_user)
    update_data = assignment_update.model_dump(exclude_unset=True)
    assignee_user_ids = update_data.pop("assignee_user_ids", None)
    override_on_leave = bool(update_data.pop("override_on_leave", False))
    floors_payload = update_data.pop("floors", None)

    property_type_id = update_data.get("property_type_id", assignment.property_type_id)
    property_subtype_id = update_data.get("property_subtype_id", assignment.property_subtype_id)
    try:
        validate_property_subtype(
            db,
            property_type_id=property_type_id,
            property_subtype_id=property_subtype_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    reassign_requested = "assigned_to_user_id" in update_data or assignee_user_ids is not None
    if reassign_requested and not capabilities.get("reassign") and assignment.assigned_to_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to reassign")

    now = datetime.now(timezone.utc)

    assigned_to_present = "assigned_to_user_id" in update_data
    assigned_to_value = update_data.pop("assigned_to_user_id", None) if assigned_to_present else None

    if not override_on_leave:
        check_ids = set()
        if assigned_to_present and assigned_to_value:
            check_ids.add(int(assigned_to_value))
        if assignee_user_ids:
            check_ids.update({int(uid) for uid in assignee_user_ids if uid})
        for user_id in check_ids:
            leave = current_leave(db, user_id=user_id)
            if leave:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": "Assignee is currently on approved leave",
                        "user_id": user_id,
                        "leave_request_id": leave.id,
                        "leave_start": leave.start_date.isoformat(),
                        "leave_end": (leave.end_date or leave.start_date).isoformat(),
                    },
                )
    if assigned_to_present:
        assignment.assigned_to_user_id = int(assigned_to_value) if assigned_to_value else None
        assignment.assigned_at = now if assignment.assigned_to_user_id else None
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="ASSIGNMENT_REASSIGNED",
            assignment_id=assignment.id,
            payload={"assigned_to_user_id": assignment.assigned_to_user_id},
        )

    for field, value in update_data.items():
        if field in {"fees", "is_paid"}:
            if not capabilities.get("modify_money"):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to modify financial fields")
            setattr(assignment, field, value)
            log_activity(
                db,
                actor_user_id=current_user.id,
                activity_type="ASSIGNMENT_FINANCE_UPDATED",
                assignment_id=assignment.id,
                payload={field: value},
            )
        else:
            setattr(assignment, field, value)

    if assignee_user_ids is not None:
        if not assignment.assigned_to_user_id and assignee_user_ids:
            assignment.assigned_to_user_id = int(assignee_user_ids[0])
            assignment.assigned_at = now
        final_assignees = sync_assignment_assignees(db, assignment, assignee_user_ids)
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="ASSIGNMENT_ASSIGNEES_UPDATED",
            assignment_id=assignment.id,
            payload={"assignee_user_ids": final_assignees},
        )

    if floors_payload is not None:
        total_area = sync_assignment_floors(db, assignment, floors_payload)
        if floors_payload:
            assignment.builtup_area = total_area
        elif "builtup_area" not in update_data:
            assignment.builtup_area = None
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="ASSIGNMENT_FLOORS_UPDATED",
            assignment_id=assignment.id,
            payload={
                "floor_count": len(floors_payload),
                "builtup_area": str(assignment.builtup_area) if assignment.builtup_area is not None else None,
            },
        )

    if assignment.status == AssignmentStatus.COMPLETED and not assignment.completed_at:
        assignment.completed_at = now
    if assignment.status == AssignmentStatus.SUBMITTED and not assignment.report_submitted_at:
        assignment.report_submitted_at = now

    _enrich_names(db, assignment)

    due_info = compute_due_info(assignment)
    maybe_emit_due_soon_notifications(db, assignment, due_info)
    maybe_emit_overdue_notifications(db, assignment, due_info)

    missing_docs = compute_missing_document_categories(db, assignment)
    if missing_docs:
        notify_assignment_assignees(
            db,
            assignment,
            notif_type=NotificationType.MISSING_DOC,
            message=f"Missing documents: {', '.join(missing_docs[:4])}",
            payload={"assignment_id": assignment.id, "missing": missing_docs},
            exclude_user_ids=[current_user.id],
        )

    if reassign_requested:
        notify_assignment_assignees(
            db,
            assignment,
            notif_type=NotificationType.ASSIGNMENT_REASSIGNED,
            message=f"Assignment reassigned: {assignment.assignment_code}",
            payload={"assignment_id": assignment.id},
            exclude_user_ids=[current_user.id],
        )

    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return AssignmentRead.model_validate(assignment)


@router.delete("/{assignment_id}", response_model=AssignmentRead | ApprovalRead, status_code=status.HTTP_202_ACCEPTED)
def delete_assignment(
    assignment_id: int,
    reason: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentRead | ApprovalRead:
    require_destructive_allowed("delete_assignment")
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    _require_assignment_access(assignment, current_user)

    capabilities = rbac.get_capabilities_for_user(current_user)
    if capabilities.get("delete_assignment_direct"):
        assignment.is_deleted = True
        assignment.deleted_at = datetime.now(timezone.utc)
        assignment.deleted_by_user_id = current_user.id
        db.add(assignment)
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="ASSIGNMENT_DELETED",
            assignment_id=assignment.id,
            message=reason or "Assignment deleted",
        )
        db.commit()
        db.refresh(assignment)
        return AssignmentRead.model_validate(assignment)

    approval = Approval(
        entity_type=ApprovalEntityType.ASSIGNMENT,
        entity_id=assignment.id,
        action_type=ApprovalActionType.DELETE_ASSIGNMENT,
        requester_user_id=current_user.id,
        approver_user_id=None,
        status=ApprovalStatus.PENDING,
        reason=reason or "Delete assignment requested",
        payload_json={"assignment_code": assignment.assignment_code},
        assignment_id=assignment.id,
    )
    allowed_roles = required_roles_for_approval(approval.entity_type, approval.action_type)
    request_approval(db, approval=approval, allowed_roles=allowed_roles, auto_assign=False)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="ASSIGNMENT_DELETE_REQUESTED",
        assignment_id=assignment.id,
        payload={"approval_id": approval.id},
    )

    notify_roles(
        db,
        roles=allowed_roles,
        notif_type=NotificationType.APPROVAL_PENDING,
        message=f"Approval requested: {approval.action_type}",
        payload={"approval_id": approval.id, "assignment_id": assignment.id},
        exclude_user_ids=[current_user.id],
    )

    db.commit()
    db.refresh(approval)
    return ApprovalRead.model_validate(approval)
