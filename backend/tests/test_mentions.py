"""Tests for @mention parsing and resolution."""
import pytest
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.enums import Role
from app.utils.mentions import extract_mentions, resolve_mentions, parse_and_resolve_mentions


@pytest.fixture
def test_users(db: Session):
    """Create test users."""
    users = [
        User(
            email="john@example.com",
            full_name="John Smith",
            hashed_password="dummy",
            role=Role.EMPLOYEE,
            is_active=True,
        ),
        User(
            email="jane@example.com",
            full_name="Jane Doe",
            hashed_password="dummy",
            role=Role.EMPLOYEE,
            is_active=True,
        ),
        User(
            email="bob@example.com",
            full_name="Bob Johnson",
            hashed_password="dummy",
            role=Role.EMPLOYEE,
            is_active=True,
        ),
        User(
            email="alice@example.com",
            full_name="Alice Lee",
            hashed_password="dummy",
            role=Role.EMPLOYEE,
            is_active=True,
        ),
        User(
            email="inactive@example.com",
            full_name="Inactive User",
            hashed_password="dummy",
            role=Role.EMPLOYEE,
            is_active=False,
        ),
    ]
    for user in users:
        db.add(user)
    db.commit()
    for user in users:
        db.refresh(user)
    return users


def test_extract_mentions_email():
    """Test extracting @email mentions."""
    text = "Hey @john@example.com can you review this?"
    mentions = extract_mentions(text)
    assert mentions == ["john@example.com"]


def test_extract_mentions_name():
    """Test extracting @Name mentions."""
    text = "cc @Jane Doe and @Bob Johnson"
    mentions = extract_mentions(text)
    assert set(mentions) == {"Jane Doe", "Bob Johnson"}


def test_extract_mentions_mixed():
    """Test extracting mixed email and name mentions."""
    text = "@john@example.com please work with @Jane Doe on this"
    mentions = extract_mentions(text)
    assert set(mentions) == {"john@example.com", "Jane Doe"}


def test_extract_mentions_dedupe():
    """Test deduplication of mentions."""
    text = "@john@example.com and @john@example.com again"
    mentions = extract_mentions(text)
    assert mentions == ["john@example.com"]


def test_extract_mentions_empty():
    """Test empty text."""
    assert extract_mentions("") == []
    assert extract_mentions(None) == []
    assert extract_mentions("no mentions here") == []


def test_resolve_mentions_by_email(db: Session, test_users):
    """Test resolving mentions by email."""
    john = test_users[0]
    user_ids, warnings = resolve_mentions(db, ["john@example.com"])
    assert user_ids == [john.id]
    assert warnings == []


def test_resolve_mentions_by_name(db: Session, test_users):
    """Test resolving mentions by name."""
    jane = test_users[1]
    user_ids, warnings = resolve_mentions(db, ["Jane Doe"])
    assert user_ids == [jane.id]
    assert warnings == []


def test_resolve_mentions_not_found(db: Session, test_users):
    """Test resolving non-existent user."""
    user_ids, warnings = resolve_mentions(db, ["nobody@example.com"])
    assert user_ids == []
    assert len(warnings) == 1
    assert "not found" in warnings[0].lower()


def test_resolve_mentions_inactive_user(db: Session, test_users):
    """Test that inactive users are not resolved."""
    user_ids, warnings = resolve_mentions(db, ["inactive@example.com"])
    assert user_ids == []
    assert len(warnings) == 1


def test_resolve_mentions_multiple(db: Session, test_users):
    """Test resolving multiple mentions."""
    john, jane = test_users[0], test_users[1]
    user_ids, warnings = resolve_mentions(
        db, ["john@example.com", "Jane Doe"]
    )
    assert sorted(user_ids) == sorted([john.id, jane.id])
    assert warnings == []


def test_resolve_mentions_exclude_author(db: Session, test_users):
    """Test excluding author from mentions."""
    john = test_users[0]
    user_ids, warnings = resolve_mentions(
        db, ["john@example.com"], exclude_user_id=john.id
    )
    assert user_ids == []
    assert warnings == []


def test_parse_and_resolve_mentions(db: Session, test_users):
    """Test end-to-end mention parsing and resolution."""
    john, jane = test_users[0], test_users[1]
    author = test_users[2]  # Bob

    text = "@john@example.com and @Jane Doe, please review"
    user_ids, warnings = parse_and_resolve_mentions(db, text, author.id)

    assert sorted(user_ids) == sorted([john.id, jane.id])
    assert warnings == []


def test_parse_and_resolve_mentions_self_mention(db: Session, test_users):
    """Test that author cannot mention themselves."""
    john = test_users[0]

    text = "I'll do this @john@example.com"
    user_ids, warnings = parse_and_resolve_mentions(db, text, john.id)

    assert user_ids == []
    assert warnings == []
