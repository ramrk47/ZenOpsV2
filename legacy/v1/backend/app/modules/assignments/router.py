"""Assignments module router aggregation."""
from app.routers import assignment_metrics, assignments, messages, mobile, tasks, tasks_overview

ROUTERS = [
    assignment_metrics.router,
    assignments.router,
    mobile.router,
    tasks.router,
    tasks_overview.router,
    messages.router,
]
