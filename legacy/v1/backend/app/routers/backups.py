from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.core import rbac
from app.core.deps import get_current_user
from app.core.settings import settings
from app.core.step_up import require_step_up
from app.models.enums import Role
from app.models.user import User
from app.schemas.backup import BackupFile, BackupListResponse, BackupStatus, BackupTriggerPayload

router = APIRouter(prefix="/api/backups", tags=["backups"])


def _require_admin(user: User) -> None:
    if not rbac.user_has_role(user, Role.ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


def _require_backup_pin(pin: str) -> None:
    expected = (settings.backup_admin_pin or "").strip()
    if not expected or expected.lower() == "change_me":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Backup PIN not configured",
        )
    if pin.strip() != expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid backup PIN")


def _backup_dir() -> Path:
    return Path(settings.backup_dir).expanduser().resolve()


def _read_status(backup_dir: Path) -> Optional[BackupStatus]:
    status_path = backup_dir / "backup.status.json"
    if not status_path.exists():
        return None
    try:
        payload = json.loads(status_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return BackupStatus.model_validate(payload)


def _infer_tier(name: str) -> Optional[str]:
    for tag in ("daily_a", "daily_b", "weekly", "fortnightly", "monthly"):
        if f"_{tag}" in name:
            return tag
    return None


def _infer_kind(name: str) -> Optional[str]:
    if "_db_" in name:
        return "db"
    if "_uploads_manifest_" in name:
        return "uploads_manifest"
    if "_uploads_" in name:
        return "uploads"
    if "_snapshot_" in name:
        return "snapshot"
    return None


def _list_files(directory: Path, location: str) -> list[BackupFile]:
    if not directory.exists():
        return []
    files: list[BackupFile] = []
    for path in directory.iterdir():
        if not path.is_file():
            continue
        if path.name in {"backup.trigger", "backup.lock", "backup.status.json"}:
            continue
        if not any(path.name.endswith(ext) for ext in (".sql.gz", ".tar.gz", ".xlsx", ".jsonl")):
            continue
        stat = path.stat()
        files.append(
            BackupFile(
                name=path.name,
                size_bytes=stat.st_size,
                modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                tier=_infer_tier(path.name),
                kind=_infer_kind(path.name),
                location=location,
            )
        )
    return files


@router.get("", response_model=BackupListResponse)
def list_backups(
    current_user: User = Depends(get_current_user),
) -> BackupListResponse:
    _require_admin(current_user)
    base_dir = _backup_dir()
    tier_dir = base_dir / "tiers"
    files = _list_files(base_dir, "base") + _list_files(tier_dir, "tier")
    files.sort(key=lambda f: f.modified_at, reverse=True)
    status = _read_status(base_dir)
    return BackupListResponse(status=status, files=files)


@router.post("/trigger")
def trigger_backup(
    payload: BackupTriggerPayload,
    current_user: User = Depends(get_current_user),
    _step_up: dict = Depends(require_step_up),
) -> dict:
    _require_admin(current_user)
    _require_backup_pin(payload.pin)
    base_dir = _backup_dir()
    base_dir.mkdir(parents=True, exist_ok=True)
    trigger_path = base_dir / "backup.trigger"
    trigger_payload = {
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "requested_by": current_user.id,
        "requested_by_email": current_user.email,
    }
    trigger_path.write_text(json.dumps(trigger_payload), encoding="utf-8")
    return {"status": "queued"}


@router.get("/download/{filename}")
def download_backup(
    filename: str,
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    _require_admin(current_user)
    base_dir = _backup_dir()
    tier_dir = base_dir / "tiers"
    candidate = (base_dir / filename).resolve()
    if not str(candidate).startswith(str(base_dir)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename")
    if not candidate.exists():
        candidate = (tier_dir / filename).resolve()
        if not str(candidate).startswith(str(tier_dir)) or not candidate.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup file not found")
    return FileResponse(path=candidate, filename=filename)
