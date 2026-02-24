"""Backend-side API contract constants.

Keep externally visible prefixes centralized for drift control.
"""

API_PREFIXES = {
    "auth": "/api/auth",
    "assignments": "/api/assignments",
    "documents": "/api/assignments/{assignment_id}/documents",
    "payroll": "/api/payroll",
    "partners": "/api/partner",
    "support": "/api/support",
    "master": "/api/master",
}
