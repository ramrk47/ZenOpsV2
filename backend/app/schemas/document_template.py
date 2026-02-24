from typing import Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field


class DocumentTemplateBase(BaseModel):
    """Base schema for document template"""
    name: str = Field(..., max_length=200, description="Template name")
    description: Optional[str] = Field(None, description="Template description")
    category: Optional[str] = Field(None, max_length=100, description="Template category (REPORT, FORM, etc.)")
    
    # Scoping - NULL means global
    client_id: Optional[int] = Field(None, description="Client ID (NULL = global)")
    service_line: Optional[str] = Field(None, max_length=100, description="Service line (NULL = all)")
    property_type_id: Optional[int] = Field(None, description="Property type ID (NULL = all)")
    
    is_active: bool = Field(True, description="Whether template is active")
    display_order: int = Field(0, description="Display order for sorting")


class DocumentTemplateCreate(DocumentTemplateBase):
    """Schema for creating a document template (file uploaded separately)"""
    pass


class DocumentTemplateUpdate(BaseModel):
    """Schema for updating document template metadata"""
    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    client_id: Optional[int] = None
    service_line: Optional[str] = Field(None, max_length=100)
    property_type_id: Optional[int] = None
    is_active: Optional[bool] = None
    display_order: Optional[int] = None


class DocumentTemplateRead(DocumentTemplateBase):
    """Schema for reading document template"""
    id: UUID
    
    # File information
    storage_path: str
    original_name: str
    mime_type: Optional[str]
    size: Optional[int]
    
    # Metadata
    created_by_user_id: Optional[int]
    created_at: datetime
    updated_at: datetime
    
    # Computed fields
    client_name: Optional[str] = None
    property_type_name: Optional[str] = None
    created_by_name: Optional[str] = None
    
    class Config:
        from_attributes = True


class DocumentTemplateList(BaseModel):
    """Paginated list of document templates"""
    items: list[DocumentTemplateRead]
    total: int
    page: int = 1
    page_size: int = 50


class AvailableTemplatesResponse(BaseModel):
    """Response for available templates for an assignment"""
    templates: list[DocumentTemplateRead]
    assignment_id: int
    filters_applied: dict
