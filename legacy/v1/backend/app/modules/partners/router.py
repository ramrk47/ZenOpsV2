"""Partners module router aggregation."""
from app.routers import partner, partner_admin, partner_onboarding

ROUTERS = [partner.router, partner_admin.router, partner_onboarding.router]
