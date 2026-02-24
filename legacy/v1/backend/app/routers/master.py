from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.guards import require_destructive_allowed
from app.db.session import get_db
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
from app.models.partner import ExternalPartner
from app.models.user import User
from app.schemas.master import (
    BankCreate,
    BankRead,
    BankUpdate,
    BranchCreate,
    BranchRead,
    BranchUpdate,
    CalendarEventLabelCreate,
    CalendarEventLabelRead,
    CalendarEventLabelUpdate,
    ClientCreate,
    ClientRead,
    ClientUpdate,
    CompanyAccountCreate,
    CompanyAccountRead,
    CompanyAccountUpdate,
    CompanyProfileRead,
    CompanyProfileUpdate,
    DocumentChecklistTemplateCreate,
    DocumentChecklistTemplateRead,
    DocumentChecklistTemplateUpdate,
    PropertySubtypeCreate,
    PropertySubtypeRead,
    PropertySubtypeUpdate,
    PropertyTypeCreate,
    PropertyTypeRead,
    PropertyTypeUpdate,
)
from app.schemas.partner import ExternalPartnerCreate, ExternalPartnerRead, ExternalPartnerUpdate

router = APIRouter(prefix="/api/master", tags=["master-data"])


def _require_master_manage(user: User) -> None:
    if not rbac.can_manage_master(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to manage master data")


def _require_company_manage(user: User) -> None:
    if not rbac.can_manage_company_accounts(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to manage company accounts")


def _get_or_404(db: Session, model, obj_id: int, name: str):
    obj = db.get(model, obj_id)
    if not obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{name} not found")
    return obj


def _validate_bank(db: Session, bank_id: Optional[int]) -> None:
    if bank_id:
        _get_or_404(db, Bank, bank_id, "Bank")


def _validate_property_refs(
    db: Session,
    *,
    property_type_id: Optional[int],
    property_subtype_id: Optional[int],
) -> None:
    if property_type_id:
        _get_or_404(db, PropertyType, property_type_id, "Property type")
    if property_subtype_id:
        subtype = _get_or_404(db, PropertySubtype, property_subtype_id, "Property subtype")
        if property_type_id and subtype.property_type_id != property_type_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="property_subtype_id does not belong to property_type_id",
            )


# Banks
@router.get("/banks", response_model=List[BankRead])
def list_banks(db: Session = Depends(get_db), _current_user: User = Depends(get_current_user)) -> List[BankRead]:
    banks = db.query(Bank).order_by(Bank.name.asc()).all()
    return [BankRead.model_validate(b) for b in banks]


@router.post("/banks", response_model=BankRead, status_code=status.HTTP_201_CREATED)
def create_bank(
    bank_in: BankCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BankRead:
    _require_master_manage(current_user)
    existing = db.query(Bank).filter(Bank.name == bank_in.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bank already exists")
    bank = Bank(**bank_in.model_dump())
    db.add(bank)
    db.commit()
    db.refresh(bank)
    return BankRead.model_validate(bank)


@router.patch("/banks/{bank_id}", response_model=BankRead)
def update_bank(
    bank_id: int,
    bank_update: BankUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BankRead:
    _require_master_manage(current_user)
    bank = _get_or_404(db, Bank, bank_id, "Bank")
    update_data = bank_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(bank, field, value)
    db.add(bank)
    db.commit()
    db.refresh(bank)
    return BankRead.model_validate(bank)


@router.delete("/banks/{bank_id}", response_model=dict)
def delete_bank(bank_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    require_destructive_allowed("delete_bank")
    _require_master_manage(current_user)
    bank = _get_or_404(db, Bank, bank_id, "Bank")
    db.delete(bank)
    db.commit()
    return {"detail": "Bank deleted"}


# Branches
@router.get("/branches", response_model=List[BranchRead])
def list_branches(db: Session = Depends(get_db), _current_user: User = Depends(get_current_user)) -> List[BranchRead]:
    branches = db.query(Branch).order_by(Branch.name.asc()).all()
    return [BranchRead.model_validate(b) for b in branches]


@router.post("/branches", response_model=BranchRead, status_code=status.HTTP_201_CREATED)
def create_branch(
    branch_in: BranchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BranchRead:
    _require_master_manage(current_user)
    _get_or_404(db, Bank, branch_in.bank_id, "Bank")
    branch = Branch(**branch_in.model_dump())
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return BranchRead.model_validate(branch)


@router.patch("/branches/{branch_id}", response_model=BranchRead)
def update_branch(
    branch_id: int,
    branch_update: BranchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BranchRead:
    _require_master_manage(current_user)
    branch = _get_or_404(db, Branch, branch_id, "Branch")
    update_data = branch_update.model_dump(exclude_unset=True)
    if "bank_id" in update_data and update_data["bank_id"]:
        _get_or_404(db, Bank, update_data["bank_id"], "Bank")
    for field, value in update_data.items():
        setattr(branch, field, value)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return BranchRead.model_validate(branch)


@router.delete("/branches/{branch_id}", response_model=dict)
def delete_branch(branch_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    require_destructive_allowed("delete_branch")
    _require_master_manage(current_user)
    branch = _get_or_404(db, Branch, branch_id, "Branch")
    db.delete(branch)
    db.commit()
    return {"detail": "Branch deleted"}


# Clients
@router.get("/clients", response_model=List[ClientRead])
def list_clients(db: Session = Depends(get_db), _current_user: User = Depends(get_current_user)) -> List[ClientRead]:
    clients = db.query(Client).order_by(Client.name.asc()).all()
    return [ClientRead.model_validate(c) for c in clients]


@router.post("/clients", response_model=ClientRead, status_code=status.HTTP_201_CREATED)
def create_client(
    client_in: ClientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ClientRead:
    _require_master_manage(current_user)
    client = Client(**client_in.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    return ClientRead.model_validate(client)


@router.patch("/clients/{client_id}", response_model=ClientRead)
def update_client(
    client_id: int,
    client_update: ClientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ClientRead:
    _require_master_manage(current_user)
    client = _get_or_404(db, Client, client_id, "Client")
    update_data = client_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(client, field, value)
    db.add(client)
    db.commit()
    db.refresh(client)
    return ClientRead.model_validate(client)


@router.delete("/clients/{client_id}", response_model=dict)
def delete_client(client_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    require_destructive_allowed("delete_client")
    _require_master_manage(current_user)
    client = _get_or_404(db, Client, client_id, "Client")
    db.delete(client)
    db.commit()
    return {"detail": "Client deleted"}


# Property types
@router.get("/property-types", response_model=List[PropertyTypeRead])
def list_property_types(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> List[PropertyTypeRead]:
    types = db.query(PropertyType).order_by(PropertyType.name.asc()).all()
    return [PropertyTypeRead.model_validate(p) for p in types]


@router.post("/property-types", response_model=PropertyTypeRead, status_code=status.HTTP_201_CREATED)
def create_property_type(
    prop_in: PropertyTypeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PropertyTypeRead:
    _require_master_manage(current_user)
    existing = db.query(PropertyType).filter(PropertyType.name == prop_in.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Property type already exists")
    prop = PropertyType(**prop_in.model_dump())
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return PropertyTypeRead.model_validate(prop)


@router.patch("/property-types/{prop_id}", response_model=PropertyTypeRead)
def update_property_type(
    prop_id: int,
    prop_update: PropertyTypeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PropertyTypeRead:
    _require_master_manage(current_user)
    prop = _get_or_404(db, PropertyType, prop_id, "Property type")
    update_data = prop_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(prop, field, value)
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return PropertyTypeRead.model_validate(prop)


@router.delete("/property-types/{prop_id}", response_model=dict)
def delete_property_type(prop_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    require_destructive_allowed("delete_property_type")
    _require_master_manage(current_user)
    prop = _get_or_404(db, PropertyType, prop_id, "Property type")
    db.delete(prop)
    db.commit()
    return {"detail": "Property type deleted"}


# Property subtypes
@router.get("/property-subtypes", response_model=List[PropertySubtypeRead])
def list_property_subtypes(
    property_type_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> List[PropertySubtypeRead]:
    query = db.query(PropertySubtype)
    if property_type_id:
        query = query.filter(PropertySubtype.property_type_id == property_type_id)
    subtypes = query.order_by(PropertySubtype.property_type_id.asc(), PropertySubtype.name.asc()).all()
    return [PropertySubtypeRead.model_validate(s) for s in subtypes]


@router.post("/property-subtypes", response_model=PropertySubtypeRead, status_code=status.HTTP_201_CREATED)
def create_property_subtype(
    subtype_in: PropertySubtypeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PropertySubtypeRead:
    _require_master_manage(current_user)
    _get_or_404(db, PropertyType, subtype_in.property_type_id, "Property type")
    existing = (
        db.query(PropertySubtype)
        .filter(
            PropertySubtype.property_type_id == subtype_in.property_type_id,
            PropertySubtype.name == subtype_in.name,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Property subtype already exists")
    subtype = PropertySubtype(**subtype_in.model_dump())
    db.add(subtype)
    db.commit()
    db.refresh(subtype)
    return PropertySubtypeRead.model_validate(subtype)


@router.patch("/property-subtypes/{subtype_id}", response_model=PropertySubtypeRead)
def update_property_subtype(
    subtype_id: int,
    subtype_update: PropertySubtypeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PropertySubtypeRead:
    _require_master_manage(current_user)
    subtype = _get_or_404(db, PropertySubtype, subtype_id, "Property subtype")
    update_data = subtype_update.model_dump(exclude_unset=True)
    if "property_type_id" in update_data and update_data["property_type_id"]:
        _get_or_404(db, PropertyType, update_data["property_type_id"], "Property type")
    for field, value in update_data.items():
        setattr(subtype, field, value)
    db.add(subtype)
    db.commit()
    db.refresh(subtype)
    return PropertySubtypeRead.model_validate(subtype)


@router.delete("/property-subtypes/{subtype_id}", response_model=dict)
def delete_property_subtype(
    subtype_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    require_destructive_allowed("delete_property_subtype")
    _require_master_manage(current_user)
    subtype = _get_or_404(db, PropertySubtype, subtype_id, "Property subtype")
    db.delete(subtype)
    db.commit()
    return {"detail": "Property subtype deleted"}


# Company accounts
@router.get("/company-accounts", response_model=List[CompanyAccountRead])
def list_company_accounts(
    bank_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> List[CompanyAccountRead]:
    query = db.query(CompanyAccount)
    if bank_id:
        query = query.filter(CompanyAccount.bank_id == bank_id)
    accounts = query.order_by(CompanyAccount.is_primary.desc(), CompanyAccount.created_at.asc()).all()
    return [CompanyAccountRead.model_validate(a) for a in accounts]


def _enforce_primary(db: Session, account: CompanyAccount) -> None:
    if not account.is_primary:
        return
    others = db.query(CompanyAccount).filter(CompanyAccount.id != account.id, CompanyAccount.is_primary.is_(True)).all()
    for other in others:
        other.is_primary = False
        db.add(other)


@router.post("/company-accounts", response_model=CompanyAccountRead, status_code=status.HTTP_201_CREATED)
def create_company_account(
    account_in: CompanyAccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CompanyAccountRead:
    _require_company_manage(current_user)
    _validate_bank(db, account_in.bank_id)
    account = CompanyAccount(**account_in.model_dump())
    db.add(account)
    db.flush()
    _enforce_primary(db, account)
    db.commit()
    db.refresh(account)
    return CompanyAccountRead.model_validate(account)


@router.patch("/company-accounts/{account_id}", response_model=CompanyAccountRead)
def update_company_account(
    account_id: int,
    account_update: CompanyAccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CompanyAccountRead:
    _require_company_manage(current_user)
    account = _get_or_404(db, CompanyAccount, account_id, "Company account")
    update_data = account_update.model_dump(exclude_unset=True)
    if "bank_id" in update_data:
        _validate_bank(db, update_data["bank_id"])
    for field, value in update_data.items():
        setattr(account, field, value)
    db.add(account)
    db.flush()
    _enforce_primary(db, account)
    db.commit()
    db.refresh(account)
    return CompanyAccountRead.model_validate(account)


@router.delete("/company-accounts/{account_id}", response_model=dict)
def delete_company_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    require_destructive_allowed("delete_company_account")
    _require_company_manage(current_user)
    account = _get_or_404(db, CompanyAccount, account_id, "Company account")
    db.delete(account)
    db.commit()
    return {"detail": "Company account deleted"}


# Company profile
@router.get("/company-profile", response_model=CompanyProfileRead)
def get_company_profile(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> CompanyProfileRead:
    profile = db.query(CompanyProfile).order_by(CompanyProfile.id.asc()).first()
    if not profile:
        profile = CompanyProfile(business_name="Pinnacle Consultants")
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return CompanyProfileRead.model_validate(profile)


@router.patch("/company-profile", response_model=CompanyProfileRead)
def update_company_profile(
    profile_update: CompanyProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CompanyProfileRead:
    _require_company_manage(current_user)
    profile = db.query(CompanyProfile).order_by(CompanyProfile.id.asc()).first()
    if not profile:
        profile = CompanyProfile(business_name="Pinnacle Consultants")
        db.add(profile)
        db.flush()
    update_data = profile_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(profile, field, value)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return CompanyProfileRead.model_validate(profile)


# Calendar labels
@router.get("/calendar-labels", response_model=List[CalendarEventLabelRead])
@router.get("/calendar-event-labels", response_model=List[CalendarEventLabelRead], include_in_schema=False)
def list_calendar_labels(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> List[CalendarEventLabelRead]:
    labels = db.query(CalendarEventLabel).order_by(CalendarEventLabel.name.asc()).all()
    return [CalendarEventLabelRead.model_validate(label) for label in labels]


@router.post("/calendar-labels", response_model=CalendarEventLabelRead, status_code=status.HTTP_201_CREATED)
def create_calendar_label(
    label_in: CalendarEventLabelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CalendarEventLabelRead:
    _require_master_manage(current_user)
    existing = db.query(CalendarEventLabel).filter(CalendarEventLabel.name == label_in.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Calendar label already exists")
    label = CalendarEventLabel(**label_in.model_dump())
    db.add(label)
    db.commit()
    db.refresh(label)
    return CalendarEventLabelRead.model_validate(label)


@router.patch("/calendar-labels/{label_id}", response_model=CalendarEventLabelRead)
def update_calendar_label(
    label_id: int,
    label_update: CalendarEventLabelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CalendarEventLabelRead:
    _require_master_manage(current_user)
    label = _get_or_404(db, CalendarEventLabel, label_id, "Calendar label")
    update_data = label_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(label, field, value)
    db.add(label)
    db.commit()
    db.refresh(label)
    return CalendarEventLabelRead.model_validate(label)


@router.delete("/calendar-labels/{label_id}", response_model=dict)
def delete_calendar_label(
    label_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    require_destructive_allowed("delete_calendar_label")
    _require_master_manage(current_user)
    label = _get_or_404(db, CalendarEventLabel, label_id, "Calendar label")
    db.delete(label)
    db.commit()
    return {"detail": "Calendar label deleted"}


# Document checklist templates
@router.get("/doc-templates", response_model=List[DocumentChecklistTemplateRead])
@router.get("/checklist-templates", response_model=List[DocumentChecklistTemplateRead], include_in_schema=False)
def list_doc_templates(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> List[DocumentChecklistTemplateRead]:
    templates = db.query(DocumentChecklistTemplate).order_by(DocumentChecklistTemplate.category.asc()).all()
    return [DocumentChecklistTemplateRead.model_validate(t) for t in templates]


def _validate_template_refs(db: Session, template: DocumentChecklistTemplateCreate | DocumentChecklistTemplateUpdate) -> None:
    if getattr(template, "bank_id", None):
        _get_or_404(db, Bank, template.bank_id, "Bank")
    if getattr(template, "branch_id", None):
        _get_or_404(db, Branch, template.branch_id, "Branch")
    _validate_property_refs(
        db,
        property_type_id=getattr(template, "property_type_id", None),
        property_subtype_id=getattr(template, "property_subtype_id", None),
    )


@router.post("/doc-templates", response_model=DocumentChecklistTemplateRead, status_code=status.HTTP_201_CREATED)
def create_doc_template(
    template_in: DocumentChecklistTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentChecklistTemplateRead:
    _require_master_manage(current_user)
    _validate_template_refs(db, template_in)
    template = DocumentChecklistTemplate(**template_in.model_dump())
    db.add(template)
    db.commit()
    db.refresh(template)
    return DocumentChecklistTemplateRead.model_validate(template)


@router.patch("/doc-templates/{template_id}", response_model=DocumentChecklistTemplateRead)
def update_doc_template(
    template_id: int,
    template_update: DocumentChecklistTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentChecklistTemplateRead:
    _require_master_manage(current_user)
    template = _get_or_404(db, DocumentChecklistTemplate, template_id, "Document template")
    _validate_template_refs(db, template_update)
    update_data = template_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)
    db.add(template)
    db.commit()
    db.refresh(template)
    return DocumentChecklistTemplateRead.model_validate(template)


@router.delete("/doc-templates/{template_id}", response_model=dict)
def delete_doc_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    require_destructive_allowed("delete_doc_template")
    _require_master_manage(current_user)
    template = _get_or_404(db, DocumentChecklistTemplate, template_id, "Document template")
    db.delete(template)
    db.commit()
    return {"detail": "Document template deleted"}


# External Partners
@router.get("/partners", response_model=List[ExternalPartnerRead])
def list_partners(
    include_inactive: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[ExternalPartnerRead]:
    _require_master_manage(current_user)
    query = db.query(ExternalPartner)
    if not include_inactive:
        query = query.filter(ExternalPartner.is_active.is_(True))
    partners = query.order_by(ExternalPartner.display_name.asc()).all()
    return [ExternalPartnerRead.model_validate(p) for p in partners]


@router.post("/partners", response_model=ExternalPartnerRead, status_code=status.HTTP_201_CREATED)
def create_partner(
    payload: ExternalPartnerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExternalPartnerRead:
    _require_master_manage(current_user)
    partner = ExternalPartner(**payload.model_dump())
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return ExternalPartnerRead.model_validate(partner)


@router.patch("/partners/{partner_id}", response_model=ExternalPartnerRead)
def update_partner(
    partner_id: int,
    payload: ExternalPartnerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExternalPartnerRead:
    _require_master_manage(current_user)
    partner = _get_or_404(db, ExternalPartner, partner_id, "Partner")
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(partner, field, value)
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return ExternalPartnerRead.model_validate(partner)


@router.delete("/partners/{partner_id}", response_model=dict)
def delete_partner(
    partner_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    require_destructive_allowed("delete_partner")
    _require_master_manage(current_user)
    partner = _get_or_404(db, ExternalPartner, partner_id, "Partner")
    db.delete(partner)
    db.commit()
    return {"detail": "Partner deleted"}
