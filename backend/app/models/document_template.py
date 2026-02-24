from __future__ import annotations

from typing import Optional
import uuid

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class DocumentTemplate(TimestampMixin, Base):
    """
    Document Templates for Master Data
    Templates can be scoped to specific clients, service lines, or property types
    Used to provide standard formatted documents (report formats, forms, etc.)
    """
    __tablename__ = "document_templates"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Basic info
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Scoping - NULL means applies to all
    client_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clients.id"), nullable=True, index=True)
    service_line: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    property_type_id: Mapped[Optional[int]] = mapped_column(ForeignKey("property_types.id"), nullable=True, index=True)
    bank_id: Mapped[Optional[int]] = mapped_column(ForeignKey("banks.id", ondelete="CASCADE"), nullable=True, index=True)
    branch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), nullable=True, index=True)
    scope_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    
    # File information
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    
    # Metadata
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Relationships
    client: Mapped[Optional["Client"]] = relationship(back_populates="document_templates")
    property_type: Mapped[Optional["PropertyType"]] = relationship(back_populates="document_templates")
    bank: Mapped[Optional["Bank"]] = relationship()
    branch: Mapped[Optional["Branch"]] = relationship()
    created_by: Mapped[Optional["User"]] = relationship(foreign_keys=[created_by_user_id])
    
    def __repr__(self):
        scope = []
        if self.client_id:
            scope.append(f"client={self.client_id}")
        if self.service_line:
            scope.append(f"service={self.service_line}")
        if self.property_type_id:
            scope.append(f"property={self.property_type_id}")
        scope_str = f" [{', '.join(scope)}]" if scope else " [global]"
        return f"<DocumentTemplate {self.name}{scope_str}>"
