"""
Client-side error logging router.
Allows frontend to report JavaScript errors to backend for centralized logging.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/client-logs", tags=["monitoring"])


class ClientErrorLog(BaseModel):
    """Client-side error log entry."""
    message: str = Field(..., max_length=2000)
    stack: Optional[str] = Field(None, max_length=5000)
    route: Optional[str] = Field(None, max_length=500)
    user_agent: Optional[str] = Field(None, max_length=500)
    build_version: Optional[str] = Field(None, max_length=100)
    component: Optional[str] = Field(None, max_length=200)
    severity: str = Field(default="error", pattern="^(error|warn|info)$")
    metadata: Optional[dict] = None


@router.post("")
def log_client_error(
    error: ClientErrorLog,
    request: Request,
) -> dict[str, str]:
    """
    Log a client-side error.
    No authentication required (errors can happen before auth).
    Rate limiting should be applied at reverse proxy level.
    """
    request_id = getattr(request.state, "request_id", "unknown")
    
    # Extract user_id if available (from middleware)
    user_id = getattr(request.state, "user_id", None)
    
    log_level = logging.ERROR
    if error.severity == "warn":
        log_level = logging.WARNING
    elif error.severity == "info":
        log_level = logging.INFO
    
    logger.log(
        log_level,
        "client_error",
        extra={
            "request_id": request_id,
            "user_id": user_id,
            "error_message": error.message,
            "error_stack": error.stack,
            "route": error.route,
            "user_agent": error.user_agent,
            "build_version": error.build_version,
            "component": error.component,
            "severity": error.severity,
            "error_metadata": error.metadata,
        },
    )
    
    return {"status": "logged", "request_id": request_id}
