"""
Document routes.

Allow listing and uploading assignment documents.  Files are stored on
disk under the `storage/` directory relative to the backend root.  The
frontend can download files using a simple file server (not included
here).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session

from ..dependencies import get_db, get_current_active_user
from ..models.assignment import Assignment
from ..models.document import AssignmentDocument
from ..models.user import User
from ..utils import rbac
from ..schemas.document import DocumentRead

router = APIRouter(prefix="/api/assignments/{assignment_id}/documents", tags=["documents"])

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "storage"))


def _get_assignment(db: Session, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


@router.get("/", response_model=list[DocumentRead])
def list_documents(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = _get_assignment(db, assignment_id)
    if not rbac.user_has_capability(current_user, "documents.manage") and not (
        assignment.created_by_user_id == current_user.id or assignment.assigned_to_user_id == current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view documents")
    return [DocumentRead.from_orm(doc) for doc in assignment.documents]


@router.post("/upload", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
async def upload_document(
    assignment_id: int,
    file: UploadFile = File(...),
    category: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = _get_assignment(db, assignment_id)
    if not rbac.user_has_capability(current_user, "documents.manage") and not (
        assignment.created_by_user_id == current_user.id or assignment.assigned_to_user_id == current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to upload documents")
    # Determine storage path
    assignment_dir = STORAGE_ROOT / f"assignment_{assignment_id}"
    assignment_dir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    file_path = assignment_dir / file.filename
    with open(file_path, "wb") as f:
        f.write(content)
    # Determine version number
    existing_versions = [d.version_number or 0 for d in assignment.documents if d.category == category]
    version = (max(existing_versions) + 1) if existing_versions else 1
    doc = AssignmentDocument(
        assignment_id=assignment.id,
        uploaded_by_user_id=current_user.id,
        original_name=file.filename,
        storage_path=str(file_path),
        mime_type=file.content_type,
        size=len(content),
        category=category,
        version_number=version,
        is_final=False,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return DocumentRead.from_orm(doc)