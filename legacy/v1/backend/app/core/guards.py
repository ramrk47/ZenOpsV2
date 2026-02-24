from __future__ import annotations

from fastapi import HTTPException, status

from app.core.settings import settings


def require_destructive_allowed(action: str) -> None:
    if settings.destructive_actions_enabled:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Destructive actions are disabled in this environment. ({action})",
    )
