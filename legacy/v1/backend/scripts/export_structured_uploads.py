#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import re
import tarfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Tuple

import psycopg2


def _get_db_url() -> str:
    url = os.environ.get("DATABASE_URL") or ""
    if not url:
        raise RuntimeError("DATABASE_URL is required for structured uploads export")
    return url.replace("postgresql+psycopg2", "postgresql")


def _safe_part(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (value or "").strip())
    cleaned = cleaned.strip("_")
    return cleaned or fallback


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
    if name not in used:
        used.add(name)
        return name
    idx = 2
    while True:
        candidate = f"{name}_{idx}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        idx += 1


def _write_json_member(tf: tarfile.TarFile, name: str, payload: dict) -> None:
    data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    tarinfo = tarfile.TarInfo(name=name)
    tarinfo.size = len(data)
    tarinfo.mtime = int(dt.datetime.now(dt.timezone.utc).timestamp())
    tf.addfile(tarinfo, io.BytesIO(data))


def main() -> None:
    parser = argparse.ArgumentParser(description="Create structured uploads archive aligned to Drive layout.")
    parser.add_argument("--uploads-dir", default=os.environ.get("UPLOADS_DIR", "/uploads"))
    parser.add_argument("--root", default=os.environ.get("STRUCTURED_UPLOADS_ROOT", "valuations"))
    parser.add_argument("--output", default=os.environ.get("STRUCTURED_UPLOADS_PATH", ""))
    args = parser.parse_args()

    uploads_dir = Path(args.uploads_dir).expanduser().resolve()
    root_name = _safe_part(args.root, "valuations")

    export_dir = Path(os.environ.get("EXPORT_DIR", "./backups")).expanduser().resolve()
    export_dir.mkdir(parents=True, exist_ok=True)
    app_name = os.environ.get("APP_NAME", "zenops")
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S")
    output = Path(args.output).expanduser() if args.output else export_dir / f"{app_name}_uploads_structured_{timestamp}.tar.gz"
    output = output.resolve()

    db_url = _get_db_url()

    query = """
        SELECT
            d.id,
            d.assignment_id,
            a.assignment_code,
            COALESCE(a.bank_name, b.name, 'Unknown Bank') AS bank_name,
            COALESCE(a.borrower_name, 'Unknown Borrower') AS borrower_name,
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
        LEFT JOIN banks b ON b.id = a.bank_id
        ORDER BY a.assignment_code, d.created_at ASC
    """

    assignments_index: Dict[str, dict] = {}
    assignment_docs: Dict[str, List[dict]] = defaultdict(list)

    with psycopg2.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            columns = [desc[0] for desc in cur.description]
            for row in cur.fetchall():
                record = dict(zip(columns, row))
                assignment_code = record.get("assignment_code") or f"assignment_{record.get('assignment_id')}"
                bank_name = _safe_part(record.get("bank_name") or "", "Unknown_Bank")
                borrower_name = _safe_part(record.get("borrower_name") or "", "Unknown_Borrower")
                assignment_code_safe = _safe_part(assignment_code, f"assignment_{record.get('assignment_id')}")

                assignment_key = assignment_code_safe
                assignments_index[assignment_key] = {
                    "assignment_id": record.get("assignment_id"),
                    "assignment_code": assignment_code,
                    "bank_name": record.get("bank_name"),
                    "borrower_name": record.get("borrower_name"),
                }
                assignment_docs[assignment_key].append(record)

    tmp_path = output.with_suffix(".tar.gz.tmp")
    with tarfile.open(tmp_path, "w:gz") as tf:
        index_payload = {
            "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
            "root": root_name,
            "assignment_count": len(assignments_index),
            "assignments": list(assignments_index.values()),
        }
        _write_json_member(tf, f"{root_name}/index.json", index_payload)

        for assignment_code_safe, docs in assignment_docs.items():
            if not docs:
                continue
            sample = docs[0]
            bank_name = _safe_part(sample.get("bank_name") or "", "Unknown_Bank")
            borrower_name = _safe_part(sample.get("borrower_name") or "", "Unknown_Borrower")
            assignment_folder = f"{root_name}/{bank_name}/{borrower_name}/{assignment_code_safe}"

            used_names: set[str] = set()
            manifest_docs = []
            for record in docs:
                category = _safe_part(record.get("category") or "Misc", "Misc")
                original_name = record.get("original_name") or f"doc_{record.get('id')}"
                original_name = original_name.replace("/", "_").replace("\\", "_")
                version = record.get("version_number") or 1
                prefix = "final" if record.get("is_final") else f"v{version}"
                filename = _safe_part(f"{prefix}_{original_name}", f"{prefix}_doc")
                filename = _unique_name(filename, used_names)

                storage_path = record.get("storage_path") or ""
                resolved_path, relative_path = _resolve_path(storage_path, uploads_dir)

                archive_path = f"{assignment_folder}/{category}/{filename}"
                manifest_item = {
                    "document_id": record.get("id"),
                    "assignment_id": record.get("assignment_id"),
                    "assignment_code": record.get("assignment_code"),
                    "original_name": record.get("original_name"),
                    "category": record.get("category"),
                    "version_number": record.get("version_number"),
                    "is_final": record.get("is_final"),
                    "storage_path": storage_path,
                    "relative_path": relative_path,
                    "archive_path": archive_path,
                    "mime_type": record.get("mime_type"),
                    "declared_size": record.get("size"),
                    "created_at": record.get("created_at").isoformat() if record.get("created_at") else None,
                }

                if resolved_path and resolved_path.exists():
                    tf.add(resolved_path, arcname=archive_path)
                    manifest_item["file_exists"] = True
                    manifest_item["file_size"] = resolved_path.stat().st_size
                else:
                    manifest_item["file_exists"] = False
                    manifest_item["file_size"] = None

                manifest_docs.append(manifest_item)

            manifest_payload = {
                "assignment_code": assignment_code_safe,
                "assignment_id": sample.get("assignment_id"),
                "bank_name": sample.get("bank_name"),
                "borrower_name": sample.get("borrower_name"),
                "documents": manifest_docs,
            }
            _write_json_member(tf, f"{assignment_folder}/manifest.json", manifest_payload)

    tmp_path.replace(output)
    print(f"Structured uploads archive created: {output}")


if __name__ == "__main__":
    main()
