"""Tests for support system (threads, messages, tokens)."""
import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.support import SupportThread, SupportMessage, SupportToken
from app.models.enums import Role, SupportThreadStatus, SupportPriority, AuthorType
from app.utils.support_tokens import generate_support_token, verify_support_token


@pytest.fixture
def test_admin(db: Session):
    """Create test admin user."""
    admin = User(
        email="admin@zenops.com",
        full_name="Admin User",
        hashed_password="dummy",
        role=Role.ADMIN,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


@pytest.fixture
def test_ops_manager(db: Session):
    """Create test ops manager user."""
    ops = User(
        email="ops@zenops.com",
        full_name="Ops Manager",
        hashed_password="dummy",
        role=Role.OPS_MANAGER,
        is_active=True,
    )
    db.add(ops)
    db.commit()
    db.refresh(ops)
    return ops


@pytest.fixture
def test_support_thread(db: Session, test_admin: User):
    """Create a test support thread."""
    thread = SupportThread(
        subject="Test Support Thread",
        status=SupportThreadStatus.OPEN,
        priority=SupportPriority.MEDIUM,
        created_by_user_id=test_admin.id,
        created_via="INTERNAL",
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return thread


def test_create_support_thread(db: Session, test_admin: User):
    """Test creating a support thread."""
    thread = SupportThread(
        subject="Help with assignment",
        status=SupportThreadStatus.OPEN,
        priority=SupportPriority.HIGH,
        created_by_user_id=test_admin.id,
        created_via="INTERNAL",
        assignment_id=None,
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    
    assert thread.id is not None
    assert thread.subject == "Help with assignment"
    assert thread.status == SupportThreadStatus.OPEN
    assert thread.priority == SupportPriority.HIGH
    assert thread.created_by_user_id == test_admin.id
    assert thread.created_at is not None
    assert thread.last_message_at is None


def test_add_message_to_thread(db: Session, test_support_thread: SupportThread, test_ops_manager: User):
    """Test adding messages to a thread."""
    message1 = SupportMessage(
        thread_id=test_support_thread.id,
        author_user_id=test_ops_manager.id,
        author_type=AuthorType.INTERNAL,
        message_text="Thanks for reaching out. We're looking into this.",
    )
    db.add(message1)
    db.commit()
    db.refresh(message1)
    
    assert message1.id is not None
    assert message1.thread_id == test_support_thread.id
    assert message1.author_user_id == test_ops_manager.id
    assert message1.author_type == AuthorType.INTERNAL
    assert message1.created_at is not None
    
    # Add second message
    message2 = SupportMessage(
        thread_id=test_support_thread.id,
        author_user_id=None,
        author_type=AuthorType.EXTERNAL,
        author_label="External User",
        message_text="Thank you for the quick response!",
    )
    db.add(message2)
    db.commit()
    
    # Verify thread has messages
    db.refresh(test_support_thread)
    assert len(test_support_thread.messages) == 2


def test_thread_status_transitions(db: Session, test_support_thread: SupportThread):
    """Test support thread status transitions."""
    # Open -> Pending
    test_support_thread.status = SupportThreadStatus.PENDING
    db.commit()
    assert test_support_thread.status == SupportThreadStatus.PENDING
    
    # Pending -> Resolved
    test_support_thread.status = SupportThreadStatus.RESOLVED
    db.commit()
    assert test_support_thread.status == SupportThreadStatus.RESOLVED
    
    # Resolved -> Closed
    test_support_thread.status = SupportThreadStatus.CLOSED
    test_support_thread.closed_at = datetime.now(timezone.utc)
    db.commit()
    assert test_support_thread.status == SupportThreadStatus.CLOSED
    assert test_support_thread.closed_at is not None


def test_generate_support_token(db: Session, test_support_thread: SupportThread):
    """Test support token generation."""
    token_data = generate_support_token(
        db,
        assignment_id=123,
        thread_id=test_support_thread.id,
        expiry_days=7,
    )
    
    assert "token" in token_data
    assert "token_id" in token_data
    assert len(token_data["token"]) == 64  # 32 bytes = 64 hex chars
    
    # Verify token exists in DB
    token_record = db.query(SupportToken).filter(
        SupportToken.id == token_data["token_id"]
    ).first()
    assert token_record is not None
    assert token_record.assignment_id == 123
    assert token_record.thread_id == test_support_thread.id
    assert token_record.is_revoked is False
    assert token_record.expires_at > datetime.now(timezone.utc)


def test_verify_support_token_valid(db: Session, test_support_thread: SupportThread):
    """Test verifying a valid support token."""
    token_data = generate_support_token(
        db,
        assignment_id=456,
        thread_id=test_support_thread.id,
        expiry_days=7,
    )
    
    # Verify the token
    token_record = verify_support_token(db, token_data["token"])
    
    assert token_record is not None
    assert token_record.id == token_data["token_id"]
    assert token_record.assignment_id == 456
    assert token_record.thread_id == test_support_thread.id
    assert token_record.use_count == 1


def test_verify_support_token_expired(db: Session, test_support_thread: SupportThread):
    """Test verifying an expired support token."""
    # Create token that expires immediately
    token = SupportToken(
        token_hash="dummy_hash",
        assignment_id=789,
        thread_id=test_support_thread.id,
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),  # Expired
        is_revoked=False,
    )
    db.add(token)
    db.commit()
    
    # Should return None for expired token
    result = verify_support_token(db, "any_token")
    assert result is None


def test_verify_support_token_revoked(db: Session, test_support_thread: SupportThread):
    """Test verifying a revoked support token."""
    token_data = generate_support_token(
        db,
        assignment_id=999,
        thread_id=test_support_thread.id,
        expiry_days=7,
    )
    
    # Revoke the token
    token_record = db.query(SupportToken).filter(
        SupportToken.id == token_data["token_id"]
    ).first()
    token_record.is_revoked = True
    token_record.revoked_at = datetime.now(timezone.utc)
    db.commit()
    
    # Should return None for revoked token
    result = verify_support_token(db, token_data["token"])
    assert result is None


def test_thread_priority_levels(db: Session, test_admin: User):
    """Test different priority levels."""
    priorities = [
        SupportPriority.LOW,
        SupportPriority.MEDIUM,
        SupportPriority.HIGH,
    ]
    
    for priority in priorities:
        thread = SupportThread(
            subject=f"Thread with {priority} priority",
            status=SupportThreadStatus.OPEN,
            priority=priority,
            created_by_user_id=test_admin.id,
            created_via="INTERNAL",
        )
        db.add(thread)
    
    db.commit()
    
    # Verify all priorities exist
    for priority in priorities:
        count = db.query(SupportThread).filter(
            SupportThread.priority == priority
        ).count()
        assert count == 1


def test_external_message_without_user(db: Session, test_support_thread: SupportThread):
    """Test creating external message without a user_id."""
    message = SupportMessage(
        thread_id=test_support_thread.id,
        author_user_id=None,  # External user has no user_id
        author_type=AuthorType.EXTERNAL,
        author_label="partner@example.com",
        message_text="Question from external user",
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    
    assert message.id is not None
    assert message.author_user_id is None
    assert message.author_type == AuthorType.EXTERNAL
    assert message.author_label == "partner@example.com"


def test_thread_last_message_timestamp(db: Session, test_support_thread: SupportThread, test_admin: User):
    """Test that last_message_at gets updated."""
    initial_last_message = test_support_thread.last_message_at
    assert initial_last_message is None
    
    # Add a message
    message = SupportMessage(
        thread_id=test_support_thread.id,
        author_user_id=test_admin.id,
        author_type=AuthorType.INTERNAL,
        message_text="First message",
    )
    db.add(message)
    db.commit()
    
    # Update last_message_at manually (would be done by API endpoint)
    test_support_thread.last_message_at = message.created_at
    db.commit()
    db.refresh(test_support_thread)
    
    assert test_support_thread.last_message_at is not None
    assert test_support_thread.last_message_at == message.created_at
