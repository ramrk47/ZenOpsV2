from __future__ import annotations

import logging
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.settings import settings

logger = logging.getLogger("security.uploads")

_DANGEROUS_INTERMEDIATE_EXTENSIONS = {
    "exe",
    "bat",
    "cmd",
    "com",
    "dll",
    "jar",
    "js",
    "msi",
    "ps1",
    "scr",
    "sh",
    "vbs",
}


class UploadSecurityError(Exception):
    def __init__(self, *, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class StoredUploadFile:
    original_name: str
    storage_path: str
    mime_type: str
    size: int


def _assert_within_base(base_dir: Path, candidate: Path) -> None:
    try:
        candidate.relative_to(base_dir)
    except ValueError as exc:
        raise UploadSecurityError(
            code="UPLOAD_PATH_TRAVERSAL_BLOCKED",
            message="Upload path traversal attempt blocked",
            status_code=400,
        ) from exc


def _sanitize_path_component(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value))
    cleaned = cleaned.strip("._")
    return cleaned or "item"


def sanitize_original_filename(filename: str | None) -> str:
    basename = Path(filename or "upload.bin").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", basename)
    cleaned = cleaned.strip()
    return cleaned or "upload.bin"


def build_upload_subdir(*parts: str) -> Path:
    base = settings.ensure_uploads_dir().resolve()
    sanitized_parts = [_sanitize_path_component(part) for part in parts]
    candidate = (base.joinpath(*sanitized_parts)).resolve()
    _assert_within_base(base, candidate)
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


def _normalize_content_type(content_type: str | None) -> str:
    raw = (content_type or "").split(";")[0].strip().lower()
    return raw


def _validate_upload(file: UploadFile) -> tuple[str, str, str]:
    safe_original_name = sanitize_original_filename(file.filename)
    suffixes = [suffix.lower().lstrip(".") for suffix in Path(safe_original_name).suffixes]
    extension = suffixes[-1] if suffixes else ""
    allowed_extensions = {ext.lower().lstrip(".") for ext in settings.allowed_upload_extensions}

    if not extension or extension not in allowed_extensions:
        raise UploadSecurityError(
            code="UPLOAD_EXTENSION_NOT_ALLOWED",
            message=f"File extension '.{extension or 'unknown'}' is not allowed",
            status_code=400,
        )

    if len(suffixes) > 1 and any(ext in _DANGEROUS_INTERMEDIATE_EXTENSIONS for ext in suffixes[:-1]):
        raise UploadSecurityError(
            code="UPLOAD_DOUBLE_EXTENSION_BLOCKED",
            message="Suspicious double extension detected",
            status_code=400,
        )

    content_type = _normalize_content_type(file.content_type)
    allowed_content_types = {ctype.lower() for ctype in settings.allowed_upload_content_types}
    if not content_type or content_type not in allowed_content_types:
        raise UploadSecurityError(
            code="UPLOAD_CONTENT_TYPE_NOT_ALLOWED",
            message=f"Content type '{content_type or 'unknown'}' is not allowed",
            status_code=400,
        )

    return safe_original_name, extension, content_type


def _scan_upload(path: Path) -> None:
    if not settings.av_scan_enabled:
        logger.info("upload_av_scan_skipped path=%s", path)
        return
    logger.warning("upload_av_scan_placeholder path=%s", path)


def store_upload_file(file: UploadFile, *, destination_dir: Path) -> StoredUploadFile:
    base = settings.ensure_uploads_dir().resolve()
    resolved_destination = destination_dir.resolve()
    _assert_within_base(base, resolved_destination)
    resolved_destination.mkdir(parents=True, exist_ok=True)

    safe_original_name, extension, content_type = _validate_upload(file)
    max_bytes = max(1, int(settings.max_upload_mb)) * 1024 * 1024

    total_size = 0
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=resolved_destination,
            prefix=".upload_",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > max_bytes:
                    raise UploadSecurityError(
                        code="UPLOAD_TOO_LARGE",
                        message=f"File exceeds max upload size of {settings.max_upload_mb} MB",
                        status_code=413,
                    )
                temp_file.write(chunk)
            temp_file.flush()
            os.fsync(temp_file.fileno())

        _scan_upload(temp_path)

        storage_path = resolved_destination / f"{uuid4().hex}.{extension}"
        while storage_path.exists():
            storage_path = resolved_destination / f"{uuid4().hex}.{extension}"
        _assert_within_base(base, storage_path.resolve())

        os.replace(temp_path, storage_path)
        return StoredUploadFile(
            original_name=safe_original_name,
            storage_path=str(storage_path),
            mime_type=content_type,
            size=total_size,
        )
    except UploadSecurityError:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise UploadSecurityError(
            code="UPLOAD_WRITE_FAILED",
            message="Failed to store upload",
            status_code=500,
        ) from exc
    finally:
        try:
            file.file.close()
        except Exception:
            pass
