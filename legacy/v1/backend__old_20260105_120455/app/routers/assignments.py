"""
Assignment routes.

Exposes CRUD operations for assignments as well as endpoints to list
assignments with due‑time information and view a detailed command
center for a single assignment.
"""

from __future__ import annotations

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..dependencies import get_db, get_current_active_user, require_capability
from datetime import datetime
from ..models.assignment import Assignment, AssignmentStatus
from ..models.user import User
from ..models.task import AssignmentTask
from ..models.invoice import Invoice
from ..models.message import AssignmentMessage
from ..models.document import AssignmentDocument
from ..utils import rbac
from ..schemas.assignment import (
    AssignmentCreate,
    AssignmentRead,
    AssignmentListItem,
    AssignmentDetail,
    AssignmentUpdate,
)

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


def _can_view_assignment(user: User, assignment: Assignment) -> bool:
    """Return True if the user can view the assignment."""
    if rbac.user_has_capability(user, "assignments.read"):
        # admin/ops/hr/finance can read all
        return True
    # Others can only view assignments they created or are assigned to
    return (assignment.created_by_user_id == user.id) or (assignment.assigned_to_user_id == user.id)


@router.get("/", response_model=list[AssignmentListItem])
def list_assignments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    case_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    bank_id: Optional[int] = Query(None),
    branch_id: Optional[int] = Query(None),
    property_type_id: Optional[int] = Query(None),
    assigned_to_user_id: Optional[int] = Query(None),
    created_by_user_id: Optional[int] = Query(None),
    mine: Optional[bool] = Query(False),
):
    """List assignments with basic info and due state.

    Non‑admin users only see assignments they created or are assigned to
    unless they request `mine=true` which forcibly filters to their queue.
    """
    query = db.query(Assignment)

    # Basic filtering by query params
    if case_type:
        query = query.filter(Assignment.case_type == case_type)
    if status:
        query = query.filter(Assignment.status == status)
    if bank_id:
        query = query.filter(Assignment.bank_id == bank_id)
    if branch_id:
        query = query.filter(Assignment.branch_id == branch_id)
    if property_type_id:
        query = query.filter(Assignment.property_type_id == property_type_id)
    if assigned_to_user_id:
        query = query.filter(Assignment.assigned_to_user_id == assigned_to_user_id)
    if created_by_user_id:
        query = query.filter(Assignment.created_by_user_id == created_by_user_id)

    # RBAC: restrict non‑staff access
    if not rbac.user_has_capability(current_user, "assignments.read") or mine:
        # restrict to assignments created by or assigned to the user
        query = query.filter(
            (Assignment.created_by_user_id == current_user.id)
            | (Assignment.assigned_to_user_id == current_user.id)
        )

    assignments: List[Assignment] = query.all()
    items: list[AssignmentListItem] = []
    for a in assignments:
        items.append(
            AssignmentListItem(
                id=a.id,
                assignment_code=a.assignment_code,
                status=a.status,
                case_type=a.case_type,
                assigned_to_user_id=a.assigned_to_user_id,
                due_time=a.due_time,
                due_state=a.due_state,
                minutes_left=a.minutes_left,
            )
        )
    return items


@router.get("/with-due", response_model=list[AssignmentListItem])
def list_assignments_with_due(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    **filters,
):
    """Alias for GET /assignments that returns due information."""
    return list_assignments(db=db, current_user=current_user, **filters)


@router.post("/", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(
    assignment_in: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("assignments.create")),
):
    """Create a new assignment.

    The current user becomes the creator.  If `assigned_to_user_id` is set,
    the assignment will be assigned to that user.
    """
    existing = db.query(Assignment).filter(Assignment.assignment_code == assignment_in.assignment_code).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="assignment_code already exists")
    a = Assignment(
        assignment_code=assignment_in.assignment_code,
        case_type=assignment_in.case_type,
        bank_id=assignment_in.bank_id,
        branch_id=assignment_in.branch_id,
        client_id=assignment_in.client_id,
        property_type_id=assignment_in.property_type_id,
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
        assigned_to_user_id=assignment_in.assigned_to_user_id,
        site_visit_date=assignment_in.site_visit_date,
        report_due_date=assignment_in.report_due_date,
        fees=assignment_in.fees,
        is_paid=assignment_in.is_paid,
        notes=assignment_in.notes,
        created_by_user_id=current_user.id,
    )
    if assignment_in.assigned_to_user_id:
        a.assigned_at = datetime.utcnow()
    db.add(a)
    db.commit()
    db.refresh(a)
    return AssignmentRead.from_orm(a)


@router.get("/{assignment_id}", response_model=AssignmentRead)
def get_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    if not _can_view_assignment(current_user, assignment):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view assignment")
    return AssignmentRead.from_orm(assignment)


@router.get("/{assignment_id}/detail", response_model=AssignmentDetail)
def get_assignment_detail(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment: Assignment | None = (
        db.query(Assignment)
        .options(
            joinedload(Assignment.tasks),
            joinedload(Assignment.messages),
            joinedload(Assignment.documents),
            joinedload(Assignment.invoice).joinedload(Invoice.items),
        )
        .filter(Assignment.id == assignment_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    if not _can_view_assignment(current_user, assignment):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view assignment")
    # Build nested objects for detail view
    tasks = [
        {
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "due_at": t.due_at,
            "assignee_name": t.assignee.full_name if t.assignee else None,
        }
        for t in assignment.tasks
    ]
    documents = [
        {
            "id": d.id,
            "original_name": d.original_name,
            "category": d.category,
            "version_number": d.version_number,
            "is_final": d.is_final,
        }
        for d in assignment.documents
    ]
    messages = [
        {
            "id": m.id,
            "message": m.message,
            "sender_user_id": m.sender_user_id,
            "created_at": m.created_at,
            "pinned": m.pinned,
        }
        for m in assignment.messages
    ]
    invoice_nested = None
    if assignment.invoice:
        invoice_nested = {
            "id": assignment.invoice.id,
            "invoice_number": assignment.invoice.invoice_number,
            "status": assignment.invoice.status,
            "total_amount": float(assignment.invoice.total_amount or 0),
        }
    detail = AssignmentDetail(
        id=assignment.id,
        assignment_code=assignment.assignment_code,
        case_type=assignment.case_type,
        bank_id=assignment.bank_id,
        branch_id=assignment.branch_id,
        client_id=assignment.client_id,
        property_type_id=assignment.property_type_id,
        bank_name=assignment.bank_name,
        branch_name=assignment.branch_name,
        valuer_client_name=assignment.valuer_client_name,
        property_type=assignment.property_type,
        borrower_name=assignment.borrower_name,
        phone=assignment.phone,
        address=assignment.address,
        land_area=float(assignment.land_area or 0) if assignment.land_area is not None else None,
        builtup_area=float(assignment.builtup_area or 0) if assignment.builtup_area is not None else None,
        status=assignment.status,
        assigned_to_user_id=assignment.assigned_to_user_id,
        site_visit_date=assignment.site_visit_date,
        report_due_date=assignment.report_due_date,
        fees=float(assignment.fees or 0) if assignment.fees is not None else None,
        is_paid=assignment.is_paid,
        notes=assignment.notes,
        created_by_user_id=assignment.created_by_user_id,
        created_at=assignment.created_at,
        updated_at=assignment.updated_at,
        due_time=assignment.due_time,
        due_state=assignment.due_state,
        minutes_left=assignment.minutes_left,
        tasks=tasks,
        documents=documents,
        messages=messages,
        invoice=invoice_nested,
    )
    return detail


@router.patch("/{assignment_id}", response_model=AssignmentRead)
def update_assignment(
    assignment_id: int,
    assignment_update: AssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    # Permission: can update if user has capability or is assignee/creator
    if not (
        rbac.user_has_capability(current_user, "assignments.update")
        or assignment.created_by_user_id == current_user.id
        or assignment.assigned_to_user_id == current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to update assignment")
    data = assignment_update.dict(exclude_unset=True)
    # update each provided field
    for field, value in data.items():
        setattr(assignment, field, value)
    if "assigned_to_user_id" in data:
        assignment.assigned_at = datetime.utcnow()
    assignment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assignment)
    return AssignmentRead.from_orm(assignment)


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    if not rbac.user_has_capability(current_user, "assignments.delete"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to delete assignment")
    db.delete(assignment)
    db.commit()
    return