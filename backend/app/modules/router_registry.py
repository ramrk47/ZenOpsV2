"""Central router registry for module-oriented composition."""
from __future__ import annotations

from fastapi import FastAPI

from app.modules.admin_masterdata.router import ROUTERS as ADMIN_MASTERDATA_ROUTERS
from app.modules.assignments.router import ROUTERS as ASSIGNMENTS_ROUTERS
from app.modules.auth_users.router import ROUTERS as AUTH_USERS_ROUTERS
from app.modules.documents.router import ROUTERS as DOCUMENT_ROUTERS
from app.modules.notifications.router import ROUTERS as NOTIFICATION_ROUTERS
from app.modules.partners.router import ROUTERS as PARTNER_ROUTERS
from app.modules.payroll.router import ROUTERS as PAYROLL_ROUTERS
from app.modules.support.router import ROUTERS as SUPPORT_ROUTERS

ALL_ROUTERS = (
    AUTH_USERS_ROUTERS
    + ASSIGNMENTS_ROUTERS
    + DOCUMENT_ROUTERS
    + ADMIN_MASTERDATA_ROUTERS
    + NOTIFICATION_ROUTERS
    + PARTNER_ROUTERS
    + PAYROLL_ROUTERS
    + SUPPORT_ROUTERS
)


def include_all_routers(app: FastAPI) -> None:
    for router in ALL_ROUTERS:
        app.include_router(router)
