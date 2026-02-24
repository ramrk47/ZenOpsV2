"""
Company account routes.

Provides CRUD endpoints for managing the company's bank accounts. Each
invoice may reference a company account to indicate which bank account
should be used for payment. Only users with the ``manage_company_accounts``
capability (typically FINANCE or ADMIN) can create or modify accounts.
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from ..models.company import CompanyAccount
from ..models.user import User
from ..schemas.company import CompanyAccountCreate, CompanyAccountRead, CompanyAccountUpdate
from app.core.deps import get_current_user
from app.core.guards import require_destructive_allowed
from app.core.step_up import require_step_up
from app.core import rbac

router = APIRouter(prefix="/api/master/company-accounts", tags=["company_accounts"])


def _require_manage(user: User) -> None:
    caps = rbac.get_capabilities_for_user(user)
    if not caps.get("manage_company_accounts"):
        raise HTTPException(status_code=403, detail="Not authorised to manage company accounts")


@router.get("", response_model=List[CompanyAccountRead])
def list_accounts(db: Session = Depends(get_db)) -> List[CompanyAccountRead]:
    """Return all company bank accounts."""
    accts = db.query(CompanyAccount).order_by(CompanyAccount.id).all()
    return [CompanyAccountRead.model_validate(a) for a in accts]


@router.post("", response_model=CompanyAccountRead, status_code=status.HTTP_201_CREATED)
def create_account(
    account_in: CompanyAccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CompanyAccountRead:
    _require_manage(current_user)
    acct = CompanyAccount(
        account_name=account_in.account_name,
        account_number=account_in.account_number,
        bank_name=account_in.bank_name,
        branch_name=account_in.branch_name,
        ifsc_code=account_in.ifsc_code,
    )
    db.add(acct)
    db.commit()
    db.refresh(acct)
    return CompanyAccountRead.model_validate(acct)


@router.patch("/{account_id}", response_model=CompanyAccountRead)
def update_account(
    account_id: int,
    account_update: CompanyAccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CompanyAccountRead:
    _require_manage(current_user)
    acct = db.query(CompanyAccount).get(account_id)
    if not acct:
        raise HTTPException(status_code=404, detail="Company account not found")
    update_data = account_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(acct, field, value)
    db.add(acct)
    db.commit()
    db.refresh(acct)
    return CompanyAccountRead.model_validate(acct)


@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _step_up: dict = Depends(require_step_up),
):
    require_destructive_allowed("delete_company_account")
    _require_manage(current_user)
    acct = db.query(CompanyAccount).get(account_id)
    if not acct:
        raise HTTPException(status_code=404, detail="Company account not found")
    db.delete(acct)
    db.commit()
    return {"detail": "Company account deleted"}
