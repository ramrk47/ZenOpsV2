# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Conventional Commits for messages.

## [Unreleased]

### Added
- Multi-role user model with capability union and partner single-role enforcement.
- Notification delivery tracking and email worker processing for queued notifications.
- Partner portal and partner admin flows for external requests and commissions.
- Backup API and admin UI surface for backup status and downloads.

### Changed
- Reverse proxy configuration to preserve `/api` paths and support localhost HTTP/HTTPS.
- CORS and JWT safety checks for production startup validation.

### Fixed
- Frontend API base handling to avoid double `/api` pathing.
- Healthcheck host handling to prefer IPv4 for local checks.

### Security
- Login rate limiting based on ActivityLog window and IP/email tracking.
