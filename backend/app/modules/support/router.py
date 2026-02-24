"""Support module router aggregation."""
from app.routers import client_logs, support

ROUTERS = [support.router, client_logs.router]
