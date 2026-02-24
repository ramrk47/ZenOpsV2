"""Document Templates router - Master data for bank/service-specific document formats"""

import os
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.document_template import DocumentTemplate
from app.models.master import Bank, Branch, Client, PropertyType
from app.models.user import User
from app.models.assignment import Assignment
from app.models.document import AssignmentDocument
from app.models.enums import Role, ServiceLine
from app.schemas.document_template import (
    DocumentTemplateCreate,
    DocumentTemplateUpdate,
    DocumentTemplateRead,
    DocumentTemplateList,
    AvailableTemplatesResponse,
)
from app.core.deps import get_current_user
from app.services.assignments import ensure_assignment_access

router = APIRouter(prefix="/api/master/document-templates", tags=["document-templates"])

UPLOAD_DIR = Path(os.getenv("UPLOADS_DIR", "/app/uploads"))
TEMPLATES_DIR = UPLOAD_DIR / "templates"
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


def check_template_permissions(user: User, operation: str = "read"):
    """Check if user has permission for template operations"""
    if operation in ["create", "update", "delete"]:
        if user.role not in [Role.ADMIN, Role.OPS_MANAGER]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Admin and Managers can modify templates"
            )
    # Read access: all internal users + partners (filtered by client)
    if user.role == Role.EXTERNAL_PARTNER and operation == "read":
        return  # Partners can read, but results will be filtered
    elif user.role == Role.EXTERNAL_PARTNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Partners cannot modify templates"
        )

def _normalize_service_line(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, ServiceLine):
        return value.value
    return str(value).upper()


def _validate_template_scope(
    *,
    service_line: Optional[str],
    bank_id: Optional[int],
    branch_id: Optional[int],
) -> None:
    normalized = _normalize_service_line(service_line)
    if not normalized:
        raise HTTPException(status_code=400, detail="service_line is required")
    if normalized == ServiceLine.VALUATION.value:
        if not bank_id:
            raise HTTPException(status_code=400, detail="bank_id is required for valuation templates")
    else:
        if bank_id or branch_id:
            raise HTTPException(status_code=400, detail="bank_id/branch_id only allowed for valuation templates")


@router.get("", response_model=DocumentTemplateList)
def list_templates(
    client_id: Optional[int] = None,
    service_line: Optional[str] = None,
    property_type_id: Optional[int] = None,
    bank_id: Optional[int] = None,
    branch_id: Optional[int] = None,
    is_active: Optional[bool] = True,
    category: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List document templates with optional filtering"""
    check_template_permissions(current_user, "read")

    query = db.query(DocumentTemplate).options(
        selectinload(DocumentTemplate.client),
        selectinload(DocumentTemplate.property_type),
        selectinload(DocumentTemplate.created_by),
    )

    if is_active is not None:
        query = query.filter(DocumentTemplate.is_active == is_active)

    if category:
        query = query.filter(DocumentTemplate.category == category)

    # Scope filters
    if client_id is not None:
        query = query.filter(
            or_(
                DocumentTemplate.client_id.is_(None),
                DocumentTemplate.client_id == client_id,
            )
        )

    normalized_service_line = _normalize_service_line(service_line)
    if normalized_service_line:
        query = query.filter(
            or_(
                DocumentTemplate.service_line.is_(None),
                DocumentTemplate.service_line == normalized_service_line,
            )
        )

    if property_type_id is not None:
        query = query.filter(
            or_(
                DocumentTemplate.property_type_id.is_(None),
                DocumentTemplate.property_type_id == property_type_id,
            )
        )

    if bank_id is not None:
        query = query.filter(
            or_(
                DocumentTemplate.bank_id.is_(None),
                DocumentTemplate.bank_id == bank_id,
            )
        )

    if branch_id is not None:
        query = query.filter(
            or_(
                DocumentTemplate.branch_id.is_(None),
                DocumentTemplate.branch_id == branch_id,
            )
        )

    # Partner filtering
    if current_user.role == Role.EXTERNAL_PARTNER:
        query = query.filter(DocumentTemplate.client_id.is_(None))

    total = query.count()

    query = query.order_by(DocumentTemplate.display_order, DocumentTemplate.name)
    offset = (page - 1) * page_size
    templates = query.offset(offset).limit(page_size).all()

    items = []
    for t in templates:
        item = DocumentTemplateRead.model_validate(t)
        if t.client:
            item.client_name = t.client.name
        if t.property_type:
            item.property_type_name = t.property_type.name
        if t.bank:
            item.bank_name = t.bank.name
        if t.branch:
            item.branch_name = t.branch.name
        if t.created_by:
            item.created_by_name = t.created_by.full_name or ""
        items.append(item)

    return DocumentTemplateList(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=DocumentTemplateRead, status_code=status.HTTP_201_CREATED)
def create_template(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    client_id: Optional[int] = Form(None),
    service_line: Optional[str] = Form(None),
    property_type_id: Optional[int] = Form(None),
    bank_id: Optional[int] = Form(None),
    branch_id: Optional[int] = Form(None),
    scope_type: Optional[str] = Form(None),
    is_active: bool = Form(True),
    display_order: int = Form(0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a new document template"""
    check_template_permissions(current_user, "create")

    # Check file size
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB",
        )

    _validate_template_scope(service_line=service_line, bank_id=bank_id, branch_id=branch_id)

    # Validate foreign keys
    if client_id:
        if not db.get(Client, client_id):
            raise HTTPException(status_code=404, detail="Client not found")

    if property_type_id:
        if not db.get(PropertyType, property_type_id):
            raise HTTPException(status_code=404, detail="Property type not found")

    if bank_id:
        if not db.get(Bank, bank_id):
            raise HTTPException(status_code=404, detail="Bank not found")

    if branch_id:
        branch = db.get(Branch, branch_id)
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")
        if bank_id and branch.bank_id != bank_id:
            raise HTTPException(status_code=400, detail="Branch does not belong to selected bank")

    # Generate unique filename - sanitize to prevent path traversal
    safe_name = Path(file.filename).name if file.filename else ""
    file_ext = Path(safe_name).suffix
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = TEMPLATES_DIR / unique_filename

    # Save file
    try:
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    template = DocumentTemplate(
        name=name,
        description=description,
        category=category,
        client_id=client_id,
        service_line=_normalize_service_line(service_line),
        property_type_id=property_type_id,
        bank_id=bank_id,
        branch_id=branch_id,
        scope_type=scope_type,
        storage_path=str(file_path),
        original_name=file.filename or "unknown",
        mime_type=file.content_type,
        size=file_size,
        is_active=is_active,
        display_order=display_order,
        created_by_user_id=current_user.id,
    )

    db.add(template)
    db.commit()
    db.refresh(template)

    result = DocumentTemplateRead.model_validate(template)
    if template.client:
        result.client_name = template.client.name
    if template.property_type:
        result.property_type_name = template.property_type.name
    if template.bank:
        result.bank_name = template.bank.name
    if template.branch:
        result.branch_name = template.branch.name
    if template.created_by:
        result.created_by_name = template.created_by.full_name or ""

    return result


@router.get("/{template_id}", response_model=DocumentTemplateRead)
def get_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single template by ID"""
    check_template_permissions(current_user, "read")

    template = (
        db.query(DocumentTemplate)
        .options(
            selectinload(DocumentTemplate.client),
            selectinload(DocumentTemplate.property_type),
            selectinload(DocumentTemplate.bank),
            selectinload(DocumentTemplate.branch),
            selectinload(DocumentTemplate.created_by),
        )
        .filter(DocumentTemplate.id == template_id)
        .first()
    )

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if current_user.role == Role.EXTERNAL_PARTNER and template.client_id is not None:
        raise HTTPException(status_code=403, detail="Access denied")

    item = DocumentTemplateRead.model_validate(template)
    if template.client:
        item.client_name = template.client.name
    if template.property_type:
        item.property_type_name = template.property_type.name
    if template.bank:
        item.bank_name = template.bank.name
    if template.branch:
        item.branch_name = template.branch.name
    if template.created_by:
        item.created_by_name = template.created_by.full_name or ""

    return item


@router.get("/{template_id}/download")
def download_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download template file"""
    check_template_permissions(current_user, "read")

    template = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if current_user.role == Role.EXTERNAL_PARTNER and template.client_id is not None:
        raise HTTPException(status_code=403, detail="Access denied")

    file_path = Path(template.storage_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Template file not found")

    return FileResponse(
        path=file_path,
        filename=template.original_name,
        media_type=template.mime_type or "application/octet-stream",
    )


@router.patch("/{template_id}", response_model=DocumentTemplateRead)
def update_template(
    template_id: uuid.UUID,
    updates: DocumentTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update template metadata (not the file itself)"""
    check_template_permissions(current_user, "update")

    template = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    update_data = updates.model_dump(exclude_unset=True)
    if "service_line" in update_data:
        update_data["service_line"] = _normalize_service_line(update_data["service_line"])
    scope_service_line = update_data.get("service_line", template.service_line)
    scope_bank_id = update_data.get("bank_id", template.bank_id)
    scope_branch_id = update_data.get("branch_id", template.branch_id)
    _validate_template_scope(
        service_line=scope_service_line,
        bank_id=scope_bank_id,
        branch_id=scope_branch_id,
    )

    if "client_id" in update_data and update_data["client_id"]:
        if not db.get(Client, update_data["client_id"]):
            raise HTTPException(status_code=404, detail="Client not found")

    if "property_type_id" in update_data and update_data["property_type_id"]:
        if not db.get(PropertyType, update_data["property_type_id"]):
            raise HTTPException(status_code=404, detail="Property type not found")

    if "bank_id" in update_data and update_data["bank_id"]:
        if not db.get(Bank, update_data["bank_id"]):
            raise HTTPException(status_code=404, detail="Bank not found")

    if "branch_id" in update_data and update_data["branch_id"]:
        branch = db.get(Branch, update_data["branch_id"])
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")
        bank_value = update_data.get("bank_id", template.bank_id)
        if bank_value and branch.bank_id != bank_value:
            raise HTTPException(status_code=400, detail="Branch does not belong to selected bank")

    for field, value in update_data.items():
        setattr(template, field, value)

    db.commit()
    db.refresh(template)

    item = DocumentTemplateRead.model_validate(template)
    if template.client:
        item.client_name = template.client.name
    if template.property_type:
        item.property_type_name = template.property_type.name
    if template.bank:
        item.bank_name = template.bank.name
    if template.branch:
        item.branch_name = template.branch.name
    if template.created_by:
        item.created_by_name = template.created_by.full_name or ""

    return item


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Soft delete template (set is_active=false)"""
    check_template_permissions(current_user, "delete")

    template = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template.is_active = False
    db.commit()

    return None


# Assignment Integration Endpoints

@router.get("/assignments/{assignment_id}/available", response_model=AvailableTemplatesResponse)
def get_available_templates(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get templates available for an assignment based on its client, service_line, property_type"""
    assignment = (
        db.query(Assignment)
        .options(selectinload(Assignment.client))
        .filter(Assignment.id == assignment_id)
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    ensure_assignment_access(assignment, current_user)

    query = db.query(DocumentTemplate).options(
        selectinload(DocumentTemplate.client),
        selectinload(DocumentTemplate.property_type),
        selectinload(DocumentTemplate.bank),
        selectinload(DocumentTemplate.branch),
    ).filter(DocumentTemplate.is_active == True)

    filters_applied = {}

    assignment_service_line = _normalize_service_line(getattr(assignment, "service_line", None))
    if assignment_service_line:
        query = query.filter(
            or_(
                DocumentTemplate.service_line.is_(None),
                DocumentTemplate.service_line == assignment_service_line,
            )
        )
        filters_applied["service_line"] = assignment_service_line

    if assignment_service_line == ServiceLine.VALUATION.value:
        if assignment.bank_id:
            query = query.filter(DocumentTemplate.bank_id == assignment.bank_id)
            filters_applied["bank_id"] = assignment.bank_id
        if assignment.branch_id:
            query = query.filter(
                or_(
                    DocumentTemplate.branch_id.is_(None),
                    DocumentTemplate.branch_id == assignment.branch_id,
                )
            )
            filters_applied["branch_id"] = assignment.branch_id
    else:
        if assignment.client_id:
            query = query.filter(
                or_(
                    DocumentTemplate.client_id.is_(None),
                    DocumentTemplate.client_id == assignment.client_id,
                )
            )
            filters_applied["client_id"] = assignment.client_id

    if assignment.property_type_id:
        query = query.filter(
            or_(
                DocumentTemplate.property_type_id.is_(None),
                DocumentTemplate.property_type_id == assignment.property_type_id,
            )
        )
        filters_applied["property_type_id"] = assignment.property_type_id

    templates = query.order_by(DocumentTemplate.display_order, DocumentTemplate.name).all()

    items = []
    for t in templates:
        item = DocumentTemplateRead.model_validate(t)
        if t.client:
            item.client_name = t.client.name
        if t.property_type:
            item.property_type_name = t.property_type.name
        if t.bank:
            item.bank_name = t.bank.name
        if t.branch:
            item.branch_name = t.branch.name
        items.append(item)

    return AvailableTemplatesResponse(
        templates=items,
        assignment_id=assignment_id,
        filters_applied=filters_applied,
    )


@router.post("/assignments/{assignment_id}/from-template/{template_id}", response_model=dict)
def add_document_from_template(
    assignment_id: int,
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new assignment document by copying a template"""
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    ensure_assignment_access(assignment, current_user)

    template = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not template or not template.is_active:
        raise HTTPException(status_code=404, detail="Template not found or inactive")

    assignment_service_line = _normalize_service_line(getattr(assignment, "service_line", None))
    if template.service_line and assignment_service_line and template.service_line != assignment_service_line:
        raise HTTPException(status_code=400, detail="Template not applicable to this assignment's service line")

    if assignment_service_line == ServiceLine.VALUATION.value:
        if template.bank_id and template.bank_id != assignment.bank_id:
            raise HTTPException(status_code=400, detail="Template not applicable to this assignment's bank")
        if template.branch_id and template.branch_id != assignment.branch_id:
            raise HTTPException(status_code=400, detail="Template not applicable to this assignment's branch")
    else:
        if template.client_id and template.client_id != assignment.client_id:
            raise HTTPException(status_code=400, detail="Template not applicable to this assignment's client")

    template_path = Path(template.storage_path)
    if not template_path.exists():
        raise HTTPException(status_code=404, detail="Template file not found")

    # Copy template file to assignment uploads
    file_ext = template_path.suffix
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    assignment_uploads_dir = UPLOAD_DIR / "assignments" / str(assignment_id)
    assignment_uploads_dir.mkdir(parents=True, exist_ok=True)
    new_file_path = assignment_uploads_dir / unique_filename

    try:
        shutil.copy2(template_path, new_file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to copy template: {str(e)}")

    doc = AssignmentDocument(
        assignment_id=assignment_id,
        uploaded_by_user_id=current_user.id,
        original_name=template.original_name,
        storage_path=str(new_file_path),
        mime_type=template.mime_type,
        size=template.size or 0,
        category=template.category or "TEMPLATE",
        version_number=1,
        is_final=False,
    )

    db.add(doc)
    db.commit()
    db.refresh(doc)

    return {
        "message": "Document created from template successfully",
        "document_id": doc.id,
        "template_id": str(template_id),
        "original_name": template.original_name,
    }
