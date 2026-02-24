.PHONY: build up down restart logs migrate seed e2e-user backup backup-run backup-test backup-restore backup-excel-restore contract-check docker-test

build:
	docker compose -f docker-compose.yml build

up:
	docker compose -f docker-compose.yml up -d

down:
	docker compose -f docker-compose.yml down

restart:
	docker compose -f docker-compose.yml restart

logs:
	docker compose -f docker-compose.yml logs -f

migrate:
	docker compose -f docker-compose.yml run --rm migrate

seed:
	docker compose -f docker-compose.yml exec api python -m app.seed

e2e-user:
	docker compose -f docker-compose.yml exec api python -m app.scripts.ensure_e2e_user

backup:
	docker compose -f docker-compose.yml --profile backup run --rm backup

backup-run:
	docker compose -f docker-compose.yml --profile backup run --rm backup

backup-test:
	docker compose -f docker-compose.yml --profile backup run --rm rclone ls gdrive:

backup-restore:
	@if [ -z "$$DB_DUMP" ] || [ -z "$$UPLOADS_ARCHIVE" ]; then echo "Usage: make backup-restore DB_DUMP=... UPLOADS_ARCHIVE=..."; exit 1; fi
	/bin/bash deploy/backup/restore.sh "$$DB_DUMP" "$$UPLOADS_ARCHIVE"

backup-excel-restore:
	@if [ -z "$$EXCEL_PATH" ]; then echo "Usage: make backup-excel-restore EXCEL_PATH=..."; exit 1; fi
	docker compose -f docker-compose.yml run --rm -v ./deploy/backups:/backups api python /app/scripts/restore_from_excel.py --path "$$EXCEL_PATH" --truncate --disable-constraints

contract-check:
	python3 scripts/contract_check.py --strict

docker-test:
	/bin/bash scripts/docker-test.sh
