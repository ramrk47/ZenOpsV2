from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import DocumentReviewStatus, DocumentVisibility

if TYPE_CHECKING:
    from app.models.document_comment import DocumentComment
    from app.models.user import User


class AssignmentDocument(IDMixin, TimestampMixin, Base):
    __tablename__ = "assignment_documents"

    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    uploaded_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False)

    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Review fields
    review_status: Mapped[DocumentReviewStatus] = mapped_column(
        SQLEnum(DocumentReviewStatus),
        default=DocumentReviewStatus.RECEIVED,
        nullable=False,
        index=True
    )
    visibility: Mapped[DocumentVisibility] = mapped_column(
        SQLEnum(DocumentVisibility),
        default=DocumentVisibility.INTERNAL_ONLY,
        nullable=False
    )
    reviewed_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    assignment: Mapped["Assignment"] = relationship(back_populates="documents")
    uploader: Mapped["User"] = relationship(foreign_keys=[uploaded_by_user_id], back_populates="documents_uploaded")
    reviewer: Mapped[Optional["User"]] = relationship(foreign_keys=[reviewed_by_user_id])
    comments: Mapped[List["DocumentComment"]] = relationship("DocumentComment", back_populates="document", cascade="all, delete-orphan")
