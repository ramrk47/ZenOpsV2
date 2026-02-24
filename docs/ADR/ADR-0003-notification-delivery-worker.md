# ADR-0003: Notification Delivery Worker and Email Channel

## Status
Accepted

## Context
Zen Ops generates notifications throughout the application — approval requests, task assignments, SLA warnings, invoice reminders, partner updates, and more. Initially, notifications were in-app only (a row in the `notifications` table rendered in the UI). Users requested email delivery so they could act on time-sensitive items without being logged in.

Key constraints:
- Email sending is slow and unreliable (provider timeouts, rate limits, transient failures). It must not block the API request-response cycle.
- External partners receive a subset of notification types and must never see internal ops details (assignment names, task content, team chat).
- Users should be able to opt out of email per notification type.
- Duplicate notifications (from retries, network issues, or repeated triggers) must not spam inboxes.
- The system must work with email disabled (development, staging) and with different email providers (Postmark, SES, SMTP, etc.).

## Decision
1. **Background worker pattern**: A separate long-running process (`notification_worker.py`) polls the database for pending email deliveries and sends them. Runs as a Docker service (`email-worker`) with configurable poll interval (`--interval 30` seconds) and batch size (`--limit 50`).

2. **Dual-channel delivery model**: When a notification is created, the delivery service (`notification_deliveries.py`) creates delivery records for each eligible channel:
   - **IN_APP**: Always created, marked `SENT` immediately (the notification row itself is the delivery).
   - **EMAIL**: Created only if `_should_send_email()` returns true. Starts in `PENDING` status for the worker to pick up.

3. **Email eligibility logic** (`_should_send_email()`):
   - Check user preference: `UserNotificationPreference.email_enabled` must be true (defaults to true if no preference row exists).
   - Check partner whitelist: `EXTERNAL_PARTNER` users only receive email for explicitly whitelisted types (`PARTNER_DOC_REQUESTED`, `PARTNER_PAYMENT_RELEASED`, etc.). All other types are silently skipped.
   - Check provider: If `EMAIL_PROVIDER` is `disabled` or `none`, no email deliveries are created at all.

4. **Deduplication**: Before creating an EMAIL delivery, the service checks if an identical delivery already exists within a configurable window (same user + same notification type + same entity ID). The entity ID is resolved from the notification payload (`commission_request_id`, `assignment_id`, `invoice_id`, etc.). Duplicates are silently dropped — no error returned to the caller.

5. **Rate limiting**: The worker enforces a per-user daily email limit (`settings.email_daily_limit`). Once a user hits the limit, remaining deliveries for that day are marked `FAILED` with a rate-limit reason. This prevents runaway notification loops from flooding a user's inbox.

6. **Retry with backoff**: Failed deliveries are retried up to `email_max_attempts` times, with a minimum gap of `email_retry_minutes` between attempts. The worker uses `with_for_update(skip_locked=True)` on the delivery query, allowing multiple worker instances to run concurrently without deadlocks.

7. **Provider abstraction**: `services/email.py` provides a `send_email(to, subject, html, text)` function that dispatches to the configured provider. Adding a new provider means implementing one function. When the provider is disabled, the function is a no-op.

8. **Template system**: `services/notification_templates.py` builds role-specific HTML and plain-text email content based on notification type. Partner templates link to the partner portal; internal templates link to assignment detail or approval pages. Templates fetch related entities (Commission, Assignment, Invoice) from the notification payload to populate context.

## Consequences
- **Async delivery gap**: Emails are sent minutes later, not in real-time. Users expecting instant email notification will experience a delay equal to the poll interval plus processing time. Acceptable for the current use case (SLA alerts, approval requests are not sub-second urgent).
- **Silent deduplication**: Callers are unaware when a duplicate delivery is dropped. This is intentional (prevents spam) but makes debugging harder. The `notification_deliveries` table is the audit trail — check for missing rows there.
- **Daily limit can strand notifications**: If a user hits the daily cap, subsequent notifications that day are lost (marked FAILED, not retried the next day). A future improvement could defer them instead.
- **Partner email whitelist maintenance**: Adding a new partner-facing notification type requires updating the `PARTNER_EMAIL_TYPES` set in `notification_deliveries.py`. Forgetting this means partners silently don't get the email.
- **Worker downtime = delayed emails**: If the worker process crashes or isn't running, emails queue up indefinitely. There is no alerting on worker health beyond Docker container status. The `--once` flag supports cron-based invocation as an alternative to the long-running daemon.
- **No push notifications or webhooks**: Only IN_APP and EMAIL channels exist. Adding SMS, Slack, or webhook delivery would follow the same pattern (new channel type, new eligibility check, new provider).

## Alternatives Considered
- **Synchronous email in request handlers**: Send email inline during the API request. Rejected because provider latency (200ms–2s) would degrade API response times and transient failures would break user-facing operations.
- **Celery/Redis task queue**: Use a proper task queue for email delivery. Rejected for infrastructure complexity — the project runs on a single VPS with Docker Compose. A database-polling worker avoids adding Redis/RabbitMQ as a dependency. Would reconsider if throughput exceeds what polling can handle (~1000 emails/hour is well within range).
- **Third-party notification service (e.g., Novu, Courier)**: Delegate multi-channel delivery to a SaaS. Rejected for cost, vendor lock-in, and the need to keep partner data isolated. The current volume (~100 users) doesn't justify the integration effort.
- **Webhook-based delivery (push instead of poll)**: Use database triggers or LISTEN/NOTIFY to wake the worker immediately. Rejected for complexity — polling every 30 seconds is simple, debuggable, and sufficient for current latency requirements.

## Key Files
- `backend/app/scripts/notification_worker.py` — worker loop, batch fetch, retry, rate limiting
- `backend/app/services/notification_deliveries.py` — delivery creation, eligibility, deduplication
- `backend/app/services/email.py` — provider abstraction and send function
- `backend/app/services/notification_templates.py` — role-aware HTML/text template builder
- `backend/app/models/notification_delivery.py` — NotificationDelivery model (status, channel, attempts, error)
- `backend/app/models/notification_pref.py` — UserNotificationPreference model
- `backend/alembic/versions/0016_notification_deliveries.py` — delivery tracking table migration
