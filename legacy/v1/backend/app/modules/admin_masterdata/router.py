"""Admin/master-data module router aggregation."""
from app.routers import activity, analytics, approvals, backups, billing_monitor, company, dashboard, invoices, leave, master

ROUTERS = [
    approvals.router,
    leave.router,
    dashboard.router,
    master.router,
    company.router,
    invoices.router,
    activity.router,
    analytics.router,
    backups.router,
    billing_monitor.router,
]
