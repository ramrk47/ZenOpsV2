"""Payroll module router aggregation."""
from app.routers import attendance, payroll

ROUTERS = [attendance.router, payroll.router]
