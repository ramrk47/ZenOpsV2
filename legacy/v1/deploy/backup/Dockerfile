FROM postgres:15-alpine

RUN apk add --no-cache bash openssl rclone tar gzip python3 py3-pandas py3-openpyxl py3-sqlalchemy py3-psycopg2

WORKDIR /backup
COPY deploy/backup/backup.sh /backup/backup.sh
COPY backend/scripts/export_snapshot_excel.py /backup/export_snapshot_excel.py
COPY backend/scripts/export_uploads_manifest.py /backup/export_uploads_manifest.py
COPY backend/scripts/export_assignment_archives.py /backup/export_assignment_archives.py
COPY backend/scripts/export_structured_uploads.py /backup/export_structured_uploads.py

ENTRYPOINT ["/bin/bash", "/backup/backup.sh"]
