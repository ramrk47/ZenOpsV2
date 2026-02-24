"""Document comments for assignment documents."""
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.db.base import Base, IDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.assignment import Assignment
    from app.models.document import AssignmentDocument
    from app.models.user import User


class CommentLane(str, enum.Enum):
    """Comment lane types."""
    INTERNAL = "INTERNAL"  # Internal team comments
    EXTERNAL = "EXTERNAL"  # External client requests


class DocumentComment(IDMixin, TimestampMixin, Base):
    """Comments on assignment documents with internal/external lanes."""

    __tablename__ = "document_comments"

    # Relationships
    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("assignment_documents.id"), nullable=False, index=True)
    assignment_id: Mapped[int] = mapped_column(Integer, ForeignKey("assignments.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Comment content
    content: Mapped[str] = mapped_column(Text, nullable=False)
    lane: Mapped[CommentLane] = mapped_column(SQLEnum(CommentLane), default=CommentLane.INTERNAL, nullable=False, index=True)

    # Threading
    parent_comment_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("document_comments.id"), nullable=True, index=True)
    thread_depth: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Mentions
    mentioned_user_ids: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # Comma-separated user IDs

    # Status
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    resolved_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Client visibility (for external lane)
    is_visible_to_client: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Edit tracking
    is_edited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    edited_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Relationships
    document: Mapped["AssignmentDocument"] = relationship("AssignmentDocument", back_populates="comments")
    assignment: Mapped["Assignment"] = relationship("Assignment", foreign_keys=[assignment_id])
    author: Mapped["User"] = relationship("User", foreign_keys=[author_id])
    resolved_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[resolved_by_id])

    # Threading relationships
    parent_comment: Mapped[Optional["DocumentComment"]] = relationship(
        "DocumentComment",
        remote_side="DocumentComment.id",
        foreign_keys=[parent_comment_id],
        back_populates="replies"
    )
    replies: Mapped[List["DocumentComment"]] = relationship(
        "DocumentComment",
        back_populates="parent_comment",
        foreign_keys=[parent_comment_id]
    )

    def __repr__(self) -> str:
        return f"<DocumentComment(id={self.id}, document_id={self.document_id}, lane={self.lane}, author_id={self.author_id})>"

    @property
    def mentioned_users(self) -> List[int]:
        """Parse mentioned user IDs from comma-separated string."""
        if not self.mentioned_user_ids:
            return []
        return [int(uid.strip()) for uid in self.mentioned_user_ids.split(',') if uid.strip()]

    @mentioned_users.setter
    def mentioned_users(self, user_ids: List[int]) -> None:
        """Set mentioned user IDs as comma-separated string."""
        self.mentioned_user_ids = ','.join(str(uid) for uid in user_ids) if user_ids else None
