# Architecture Decision Records (ADR)

## Purpose
ADRs capture key architectural decisions, their context, and consequences. They prevent decision loss during AI handoffs and keep reasoning explicit.

## When to Write an ADR
- New data model or persistence strategy.
- Significant workflow or business logic change.
- Core infra/process change (workers, queues, backups).
- Security or access control changes.

## Statuses
- Proposed
- Accepted
- Deprecated
- Superseded

## Naming
- `ADR-0001-<short-title>.md` (zero-padded numeric sequence).

## Template
- Title
- Status
- Context
- Decision
- Consequences
- Alternatives considered
- Key files

## Index
| ADR | Title | Status |
|-----|-------|--------|
| [ADR-0001](ADR-0001-multi-role-user-model.md) | Multi-Role User Model + Capability Union + Partner Single-Role | Accepted |
| [ADR-0002](ADR-0002-approval-routing.md) | Approval Routing by Entity Type with Self-Approval Guard | Accepted |
| [ADR-0003](ADR-0003-notification-delivery-worker.md) | Notification Delivery Worker and Email Channel | Accepted |
| [ADR-0004](ADR-0004-invoice-numbering-idempotency.md) | Invoice Numbering, Canonical Totals, and Idempotency | Accepted |
