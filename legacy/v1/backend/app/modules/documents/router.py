"""Documents module router aggregation."""
from app.routers import document_comments, document_templates, documents

ROUTERS = [
    documents.router,
    document_comments.router,
    document_templates.router,
]
