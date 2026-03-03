# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Conventional Commits for messages.

## [Unreleased]

### Added
- Multi-role user model with capability union and partner single-role enforcement.
- Notification delivery tracking and email worker processing for queued notifications.
- Partner portal and partner admin flows for external requests and commissions.
- Backup API and admin UI surface for backup status and downloads.
- Deterministic OpenAPI generator script at `scripts/generate_openapi.py` for refreshing `docs/openapi.json`.
- Support resolve regression test (`backend/tests/test_support_api_resolve.py`) to verify resolved timestamp persistence.
- Terminology guard script (`scripts/terminology_check.sh`) to catch accidental Partner copy in UI text.

### Changed
- Reverse proxy configuration to preserve `/api` paths and support localhost HTTP/HTTPS.
- CORS and JWT safety checks for production startup validation.
- Regenerated `docs/openapi.json` to align with current FastAPI routes (including bridge-token and mobile endpoints).
- Frontend API calls now consistently use the shared API client/interceptors (no rogue local axios instances).
- Attendance CSV export now uses shared API client transport instead of raw fetch/manual auth headers.
- User-facing terminology updated from Partner to Associate across navigation, headings, and admin/portal labels.

### Fixed
- Frontend API base handling to avoid double `/api` pathing.
- Healthcheck host handling to prefer IPv4 for local checks.
- Support resolve endpoint now persists `closed_at` correctly and returns it consistently after refresh.

### Security
- Login rate limiting based on ActivityLog window and IP/email tracking.
