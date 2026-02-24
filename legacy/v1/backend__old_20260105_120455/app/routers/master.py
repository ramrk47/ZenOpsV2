"""
Master data routes.

Provides endpoints to list banks, branches, clients and property types.  Only
reading is implemented here; creation/updating is left to admin users via
SQL or future endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..dependencies import get_db, get_current_active_user
from ..models.master import Bank, Branch, Client, PropertyType
from ..schemas.master import BankRead, BranchRead, ClientRead, PropertyTypeRead
from ..utils import rbac
from ..models.user import User

router = APIRouter(prefix="/api/master", tags=["master"])


@router.get("/banks", response_model=list[BankRead])
def list_banks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    # Anybody who can read assignments can read master data
    if not rbac.user_has_capability(current_user, "assignments.read"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to access master data")
    return [BankRead.from_orm(b) for b in db.query(Bank).all()]


@router.get("/branches", response_model=list[BranchRead])
def list_branches(
    bank_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not rbac.user_has_capability(current_user, "assignments.read"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to access master data")
    query = db.query(Branch)
    if bank_id:
        query = query.filter(Branch.bank_id == bank_id)
    return [BranchRead.from_orm(b) for b in query.all()]


@router.get("/clients", response_model=list[ClientRead])
def list_clients(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not rbac.user_has_capability(current_user, "assignments.read"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to access master data")
    return [ClientRead.from_orm(c) for c in db.query(Client).all()]


@router.get("/property-types", response_model=list[PropertyTypeRead])
def list_property_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not rbac.user_has_capability(current_user, "assignments.read"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to access master data")
    return [PropertyTypeRead.from_orm(p) for p in db.query(PropertyType).all()]