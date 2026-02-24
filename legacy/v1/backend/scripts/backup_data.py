#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import os
import shutil
import subprocess
import tarfile
from pathlib import Path

from sqlalchemy.engine.url import make_url

from app.core.settings import settings


def _safe_url() -> str:
    url = os.environ.get("DATABASE_URL") or settings.database_url
    parsed = make_url(url)
    if parsed.drivername.startswith("postgresql+"):
        parsed = parsed.set(drivername="postgresql")
    return str(parsed)


def _dump_postgres(backup_dir: Path, timestamp: str) -> Path:
    url = make_url(_safe_url())
    backup_dir.mkdir(parents=True, exist_ok=True)
    dump_path = backup_dir / f"zenops-db-{timestamp}.dump"

    env = os.environ.copy()
    if url.password:
        env["PGPASSWORD"] = url.password

    cmd = [
        "pg_dump",
        "-Fc",
        "-h",
        url.host or "localhost",
        "-p",
        str(url.port or 5432),
        "-U",
        url.username or "postgres",
        "-f",
        str(dump_path),
        url.database,
    ]
    subprocess.run(cmd, check=True, env=env)
    return dump_path


def _archive_uploads(backup_dir: Path, timestamp: str) -> Path | None:
    uploads_dir = os.environ.get("UPLOADS_DIR") or settings.uploads_dir
    uploads_path = Path(uploads_dir).expanduser().resolve()
    if not uploads_path.exists():
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    archive_path = backup_dir / f"zenops-uploads-{timestamp}.tar.gz"
    with tarfile.open(archive_path, "w:gz") as tar:
        tar.add(uploads_path, arcname="uploads")
    return archive_path


def _copy_to_target(path: Path, target_dir: str) -> None:
    dest_dir = Path(target_dir).expanduser()
    dest_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest_dir / path.name)


def _rclone_copy(path: Path, remote: str) -> None:
    rclone = shutil.which("rclone")
    if not rclone:
        print("rclone not found; skipping Google Drive upload.")
        return
    subprocess.run([rclone, "copy", str(path), remote], check=True)


def _remote_copy(path: Path, target: str) -> None:
    if shutil.which("rsync"):
        subprocess.run(["rsync", "-az", str(path), f"{target}/"], check=True)
        return
    if shutil.which("scp"):
        subprocess.run(["scp", str(path), f"{target}/"], check=True)
        return
    print("rsync/scp not found; skipping remote backup copy.")


def main() -> None:
    timestamp = dt.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup_dir = Path(os.environ.get("BACKUP_DIR", "./backups")).expanduser().resolve()

    print("Starting backup...")
    dump_path = _dump_postgres(backup_dir, timestamp)
    print(f"Database backup: {dump_path}")

    uploads_archive = _archive_uploads(backup_dir, timestamp)
    if uploads_archive:
        print(f"Uploads backup: {uploads_archive}")
    else:
        print("Uploads backup skipped (uploads dir missing).")

    local_target = os.environ.get("LOCAL_BACKUP_TARGET")
    if local_target:
        _copy_to_target(dump_path, local_target)
        if uploads_archive:
            _copy_to_target(uploads_archive, local_target)
        print(f"Copied backups to {local_target}")

    gdrive_remote = os.environ.get("GDRIVE_RCLONE_REMOTE")
    if gdrive_remote:
        _rclone_copy(dump_path, gdrive_remote)
        if uploads_archive:
            _rclone_copy(uploads_archive, gdrive_remote)
        print(f"Uploaded backups to {gdrive_remote}")

    remote_target = os.environ.get("REMOTE_BACKUP_TARGET")
    if remote_target:
        _remote_copy(dump_path, remote_target)
        if uploads_archive:
            _remote_copy(uploads_archive, remote_target)
        print(f"Copied backups to {remote_target}")

    print("Backup complete.")


if __name__ == "__main__":
    main()
