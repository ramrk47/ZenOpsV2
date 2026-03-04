from __future__ import annotations

from app.db.session import SessionLocal
from app.models.approval import Approval
from app.models.enums import ApprovalStatus, ApprovalType
from app.scripts.seed_e2e import reset_database, seed


def test_seed_e2e_creates_pending_approvals_without_jsonb_like_error() -> None:
    # Regression guard for PostgreSQL JSONB role filter used by approval routing.
    reset_database()
    seed()

    with SessionLocal() as db:
        pending = (
            db.query(Approval)
            .filter(Approval.status == ApprovalStatus.PENDING)
            .all()
        )

    pending_types = {row.approval_type for row in pending}
    assert ApprovalType.DRAFT_ASSIGNMENT in pending_types
    assert ApprovalType.FINAL_DOC_REVIEW in pending_types
    assert ApprovalType.PAYMENT_CONFIRMATION in pending_types
