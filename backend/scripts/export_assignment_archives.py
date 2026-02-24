#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import re
import tarfile
from pathlib import Path
from typing import Any, Dict, List, Tuple

import psycopg2


def _get_db_url() -> str:
    url = os.environ.get("DATABASE_URL") or ""
    if not url:
        raise RuntimeError("DATABASE_URL is required for assignment archives")
    return url.replace("postgresql+psycopg2", "postgresql")


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", value).strip("_")
    return cleaned or "assignment"


def _resolve_path(storage_path: str, uploads_dir: Path) -> Tuple[Path | None, str | None]:
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


def _unique_name(name: str, used: set[str]) -> str:
    candidate = name
    if candidate not in used:
        used.add(candidate)
        return candidate
    idx = 2
    while True:
        suffix = f"_{idx}"
        candidate = f"{name}{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        idx += 1


def _build_member_name(record: Dict[str, Any], used: set[str]) -> str:
    original = record.get("original_name") or f"doc_{record.get('id')}"
    category = record.get("category") or "doc"
    version = record.get("version_number") or 1
    base = f"{category}_v{version}_{original}"
    base = base.replace("/", "_").replace("\\", "_")
    base = _safe_filename(base)
    return _unique_name(base, used)


def _write_manifest(tf: tarfile.TarFile, payload: dict) -> None:
    data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    tarinfo = tarfile.TarInfo(name="manifest.json")
    tarinfo.size = len(data)
    tarinfo.mtime = int(dt.datetime.now(dt.timezone.utc).timestamp())
    tf.addfile(tarinfo, io.BytesIO(data))


def main() -> None:
    parser = argparse.ArgumentParser(description="Create per-assignment archives of uploaded documents")
    parser.add_argument("--scope", choices=["final", "all"], default=os.environ.get("ARCHIVE_SCOPE", "final"))
    parser.add_argument("--output-dir", default=os.environ.get("ARCHIVE_OUTPUT_DIR", "/backups/assignment_archives"))
    parser.add_argument("--uploads-dir", default=os.environ.get("UPLOADS_DIR", "/uploads"))
    parser.add_argument(
        "--incremental",
        default=os.environ.get("ARCHIVE_INCREMENTAL", "1"),
        help="Skip archives if unchanged (1/0)",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    uploads_dir = Path(args.uploads_dir).expanduser().resolve()
    incremental = str(args.incremental).strip().lower() not in {"0", "false", "no"}

    db_url = _get_db_url()

    scope_filter = "AND d.is_final = TRUE" if args.scope == "final" else ""

    summary_query = f"""
        SELECT d.assignment_id,
               a.assignment_code,
               COUNT(*) AS doc_count,
               MAX(d.updated_at) AS last_updated
        FROM assignment_documents d
        JOIN assignments a ON a.id = d.assignment_id
        WHERE 1=1 {scope_filter}
        GROUP BY d.assignment_id, a.assignment_code
        ORDER BY a.assignment_code
    """

    docs_query = f"""
        SELECT d.id,
               d.assignment_id,
               a.assignment_code,
               d.original_name,
               d.storage_path,
               d.mime_type,
               d.size,
               d.category,
               d.version_number,
               d.is_final,
               d.created_at,
               d.updated_at
        FROM assignment_documents d
        JOIN assignments a ON a.id = d.assignment_id
        WHERE d.assignment_id = %s {scope_filter}
        ORDER BY d.created_at ASC
    """

    created = 0
    skipped = 0

    with psycopg2.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(summary_query)
            summaries = cur.fetchall()

        for assignment_id, assignment_code, doc_count, last_updated in summaries:
            safe_code = _safe_filename(assignment_code or f"assignment_{assignment_id}")
            tag = "final" if args.scope == "final" else "all"
            archive_path = output_dir / f"{safe_code}_{tag}.tar.gz"

            if incremental and archive_path.exists() and last_updated:
                archive_mtime = dt.datetime.fromtimestamp(archive_path.stat().st_mtime, tz=dt.timezone.utc)
                if archive_mtime >= last_updated:
                    skipped += 1
                    continue

            with conn.cursor() as cur:
                cur.execute(docs_query, (assignment_id,))
                columns = [desc[0] for desc in cur.description]
                rows = [dict(zip(columns, row)) for row in cur.fetchall()]

            if not rows:
                skipped += 1
                continue

            used_names: set[str] = set()
            manifest_items: List[dict] = []

            tmp_path = archive_path.with_suffix(".tar.gz.tmp")
            with tarfile.open(tmp_path, "w:gz") as tf:
                for record in rows:
                    storage_path = record.get("storage_path") or ""
                    resolved_path, relative_path = _resolve_path(storage_path, uploads_dir)
                    member_name = _build_member_name(record, used_names)

                    item = {
                        "document_id": record.get("id"),
                        "assignment_id": assignment_id,
                        "assignment_code": assignment_code,
                        "original_name": record.get("original_name"),
                        "category": record.get("category"),
                        "version_number": record.get("version_number"),
                        "is_final": record.get("is_final"),
                        "storage_path": storage_path,
                        "relative_path": relative_path,
                        "archive_name": member_name,
                        "mime_type": record.get("mime_type"),
                        "declared_size": record.get("size"),
                        "created_at": record.get("created_at").isoformat() if record.get("created_at") else None,
                    }

                    if resolved_path and resolved_path.exists():
                        tf.add(resolved_path, arcname=member_name)
                        item["file_exists"] = True
                        item["file_size"] = resolved_path.stat().st_size
                    else:
                        item["file_exists"] = False
                        item["file_size"] = None

                    manifest_items.append(item)

                manifest = {
                    "assignment_id": assignment_id,
                    "assignment_code": assignment_code,
                    "scope": args.scope,
                    "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "documents": manifest_items,
                }
                _write_manifest(tf, manifest)

            tmp_path.replace(archive_path)
            created += 1

    print(f"Assignment archives completed. created={created} skipped={skipped} dir={output_dir}")


if __name__ == "__main__":
    main()
