# Monthly Restore-Test Checklist

Run this monthly (or after major upgrades) to prove backups are usable.

1. Choose the latest encrypted DB + uploads backups from the remote or `/backups` volume.
2. On a staging host, create a fresh environment (new Docker volumes, empty DB).
3. Export `BACKUP_ENCRYPTION_KEY` (the same key used for backup encryption).
4. Restore the database using `deploy/backup/restore.sh <db_dump.sql.gz.enc>`.
5. Restore uploads using `deploy/backup/restore.sh <db_dump.sql.gz.enc> <uploads.tar.gz.enc>`.
6. Start the stack (`docker compose up -d`) and wait for `/readyz` to return `ok`.
7. Log in as an admin and verify key flows (assignments list, document download, notifications).
8. Record the results (date, backup filenames, duration, any issues) in your ops log.
9. Clean up the staging environment when done.
