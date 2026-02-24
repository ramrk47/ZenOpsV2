#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path

import psycopg2


def _get_db_url() -> str:
    url = os.environ.get("DATABASE_URL") or ""
    if not url:
        raise RuntimeError("DATABASE_URL is required for uploads manifest export")
    return url.replace("postgresql+psycopg2", "postgresql")


def _sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _resolve_path(storage_path: str, uploads_dir: Path) -> tuple[Path | None, str | None]:
    raw = Path(storage_path)
    if raw.exists():
        try:
            return raw, str(raw.relative_to(uploads_dir))
        except ValueError:
            return raw, None

    if raw.is_absolute():
        parts = raw.parts
        if "uploads" in parts:
            idx = parts.index("uploads")
            candidate = uploads_dir.joinpath(*parts[idx + 1 :])
            if candidate.exists():
                return candidate, str(candidate.relative_to(uploads_dir))
        candidate = uploads_dir / raw.name
        if candidate.exists():
            return candidate, str(candidate.relative_to(uploads_dir))
    else:
        candidate = uploads_dir / raw
        if candidate.exists():
            return candidate, str(candidate.relative_to(uploads_dir))

    return None, None


def _row_to_manifest(
    row: dict,
    record_type: str,
    uploads_dir: Path,
    hash_files: bool,
) -> dict:
    storage_path = row.get("storage_path") or ""
    resolved_path, relative_path = _resolve_path(storage_path, uploads_dir)

    file_exists = bool(resolved_path and resolved_path.exists())
    file_size = resolved_path.stat().st_size if file_exists else None
    checksum = _sha256(resolved_path) if file_exists and hash_files else None

    return {
        "record_type": record_type,
        "id": row.get("id"),
        "assignment_id": row.get("assignment_id"),
        "assignment_code": row.get("assignment_code"),
        "invoice_id": row.get("invoice_id"),
        "invoice_number": row.get("invoice_number"),
        "original_name": row.get("original_name"),
        "storage_path": storage_path,
        "relative_path": relative_path,
        "mime_type": row.get("mime_type"),
        "declared_size": row.get("size"),
        "category": row.get("category"),
        "version_number": row.get("version_number"),
        "is_final": row.get("is_final"),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "file_exists": file_exists,
        "file_size": file_size,
        "sha256": checksum,
    }


def main() -> None:
    export_dir = Path(os.environ.get("EXPORT_DIR", "./backups")).expanduser().resolve()
    export_dir.mkdir(parents=True, exist_ok=True)

    app_name = os.environ.get("APP_NAME", "zenops")
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S")
    export_path = Path(os.environ.get("MANIFEST_PATH", "")).expanduser()
    if not export_path.as_posix().strip():
        export_path = export_dir / f"{app_name}_uploads_manifest_{timestamp}.jsonl"
    else:
        export_path = export_path.expanduser().resolve()

    uploads_dir = Path(os.environ.get("UPLOADS_DIR", "/uploads")).expanduser().resolve()
    hash_files = os.environ.get("MANIFEST_HASH", "1").strip().lower() not in {"0", "false", "no"}

    db_url = _get_db_url()

    meta = {
        "record_type": "meta",
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "uploads_dir": str(uploads_dir),
        "hash_files": hash_files,
    }

    assignment_query = """
        SELECT
            d.id,
            d.assignment_id,
            a.assignment_code,
            d.original_name,
            d.storage_path,
            d.mime_type,
            d.size,
            d.category,
            d.version_number,
            d.is_final,
            d.created_at
        FROM assignment_documents d
        JOIN assignments a ON a.id = d.assignment_id
        ORDER BY d.id
    """

    invoice_query = """
        SELECT
            ia.id,
            ia.invoice_id,
            i.invoice_number,
            i.assignment_id,
            a.assignment_code,
            ia.original_name,
            ia.storage_path,
            ia.mime_type,
            ia.size,
            ia.category,
            ia.created_at
        FROM invoice_attachments ia
        JOIN invoices i ON i.id = ia.invoice_id
        LEFT JOIN assignments a ON a.id = i.assignment_id
        ORDER BY ia.id
    """

    with psycopg2.connect(db_url) as conn, export_path.open("w", encoding="utf-8") as handle:
        handle.write(json.dumps(meta) + "\n")
        with conn.cursor() as cur:
            cur.execute(assignment_query)
            columns = [desc[0] for desc in cur.description]
            for row in cur.fetchall():
                record = dict(zip(columns, row))
                manifest = _row_to_manifest(record, "assignment_document", uploads_dir, hash_files)
                handle.write(json.dumps(manifest, ensure_ascii=False) + "\n")

        with conn.cursor() as cur:
            cur.execute(invoice_query)
            columns = [desc[0] for desc in cur.description]
            for row in cur.fetchall():
                record = dict(zip(columns, row))
                manifest = _row_to_manifest(record, "invoice_attachment", uploads_dir, hash_files)
                handle.write(json.dumps(manifest, ensure_ascii=False) + "\n")

    print(f"Uploads manifest created: {export_path}")


if __name__ == "__main__":
    main()
