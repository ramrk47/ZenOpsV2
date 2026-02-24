"""
AssignmentDocument model.

Stores uploaded files associated with assignments.  Documents are stored
on the local filesystem under a configurable storage directory.  Each
record stores metadata about the file and whether it is the final
version of its category.
"""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship

from .base import Base


class AssignmentDocument(Base):
    __tablename__ = "assignment_documents"

    id: int = Column(Integer, primary_key=True)
    assignment_id: int = Column(Integer, ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    uploaded_by_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    original_name: str = Column(String(255), nullable=False)
    storage_path: str = Column(String(500), nullable=False)
    mime_type: str | None = Column(String(100), nullable=True)
    size: int | None = Column(Integer, nullable=True)
    category: str | None = Column(String(100), nullable=True)
    version_number: int | None = Column(Integer, nullable=True)
    is_final: bool = Column(Boolean, nullable=False, default=False)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)

    assignment = relationship("Assignment", back_populates="documents")
    uploader = relationship("User")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AssignmentDocument id={self.id} name={self.original_name} category={self.category}>"