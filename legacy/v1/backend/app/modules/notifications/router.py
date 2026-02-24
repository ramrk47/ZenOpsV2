"""Notifications module router aggregation."""
from app.routers import calendar, notifications

ROUTERS = [calendar.router, notifications.router]
