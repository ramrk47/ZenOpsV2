from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class BackupFile(BaseModel):
    name: str
    size_bytes: int
    modified_at: datetime
    tier: Optional[str] = None
    kind: Optional[str] = None
    location: str = Field(default="base", description="base or tier")


class BackupStatus(BaseModel):
    state: str
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    message: Optional[str] = None


class BackupListResponse(BaseModel):
    status: Optional[BackupStatus] = None
    files: list[BackupFile] = Field(default_factory=list)


class BackupTriggerPayload(BaseModel):
    pin: str
