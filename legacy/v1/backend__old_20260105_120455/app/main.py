"""
FastAPI application entrypoint.

Initialises the FastAPI app, mounts all API routers and configures CORS.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import auth, users, assignments, tasks, messages, documents, approvals, invoices, calendar, notifications, leave, master

app = FastAPI(title="Zen Ops API", version="0.1.0", openapi_url="/api/openapi.json")

# CORS configuration – adjust origins as needed for your frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(assignments.router)
app.include_router(tasks.router)
app.include_router(messages.router)
app.include_router(documents.router)
app.include_router(approvals.router)
app.include_router(invoices.router)
app.include_router(calendar.router)
app.include_router(notifications.router)
app.include_router(leave.router)
app.include_router(master.router)

# Root path for health check
@app.get("/")
def read_root():
    return {"message": "Zen Ops backend is running"}