"""Auth/users module router aggregation."""
from app.routers import auth, users

ROUTERS = [auth.router, users.router]
