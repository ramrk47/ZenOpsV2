from __future__ import annotations

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.assignment import Assignment
from app.models.enums import CaseType, Role, ServiceLine
from app.models.partner import ExternalPartner
from app.models.user import User


@pytest.fixture()
def client():
    engine = create_engine(
        'sqlite+pysqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    partner_a = ExternalPartner(display_name='Partner A', is_active=True)
    partner_b = ExternalPartner(display_name='Partner B', is_active=True)
    db.add_all([partner_a, partner_b])
    db.flush()

    partner_user = User(
        email='partner-a@example.com',
        hashed_password='x',
        role=Role.EXTERNAL_PARTNER,
        full_name='Partner A User',
        is_active=True,
        partner_id=partner_a.id,
    )
    other_partner_user = User(
        email='partner-b@example.com',
        hashed_password='x',
        role=Role.EXTERNAL_PARTNER,
        full_name='Partner B User',
        is_active=True,
        partner_id=partner_b.id,
    )
    admin_user = User(
        email='admin@example.com',
        hashed_password='x',
        role=Role.ADMIN,
        full_name='Admin User',
        is_active=True,
    )
    db.add_all([partner_user, other_partner_user, admin_user])
    db.flush()

    own_assignment = Assignment(
        assignment_code='Z-MOB-0001',
        case_type=CaseType.EXTERNAL_VALUER,
        service_line=ServiceLine.VALUATION,
        created_by_user_id=admin_user.id,
        assigned_to_user_id=admin_user.id,
        partner_id=partner_a.id,
        borrower_name='Borrower A',
    )
    foreign_assignment = Assignment(
        assignment_code='Z-MOB-0002',
        case_type=CaseType.EXTERNAL_VALUER,
        service_line=ServiceLine.VALUATION,
        created_by_user_id=admin_user.id,
        assigned_to_user_id=admin_user.id,
        partner_id=partner_b.id,
        borrower_name='Borrower B',
    )
    db.add_all([own_assignment, foreign_assignment])
    db.commit()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    client_instance = TestClient(app)
    try:
        yield client_instance, partner_user, other_partner_user, admin_user, own_assignment, foreign_assignment
    finally:
        client_instance.close()
        db.close()
        app.dependency_overrides.clear()


def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token({'sub': str(user.id), 'role': str(user.role)})
    return {'Authorization': f'Bearer {token}'}


def test_partner_can_access_mobile_summary(client):
    client_instance, partner_user, _other_partner_user, _admin_user, own_assignment, _foreign_assignment = client

    response = client_instance.get('/api/mobile/summary', headers=_auth_headers(partner_user))
    assert response.status_code == 200, response.text

    payload = response.json()
    queue_codes = [row['assignment_code'] for row in payload.get('my_queue', [])]
    assert own_assignment.assignment_code in queue_codes


def test_partner_mobile_assignment_scoped(client):
    client_instance, partner_user, _other_partner_user, _admin_user, _own_assignment, foreign_assignment = client

    forbidden = client_instance.get(
        f'/api/mobile/assignments/{foreign_assignment.id}',
        headers=_auth_headers(partner_user),
    )
    assert forbidden.status_code == 404


def test_admin_mobile_summary_visible(client):
    client_instance, _partner_user, _other_partner_user, admin_user, own_assignment, foreign_assignment = client

    response = client_instance.get('/api/mobile/summary', headers=_auth_headers(admin_user))
    assert response.status_code == 200, response.text

    payload = response.json()
    queue_codes = [row['assignment_code'] for row in payload.get('my_queue', [])]
    assert own_assignment.assignment_code in queue_codes
    assert foreign_assignment.assignment_code in queue_codes
