from __future__ import annotations

import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
try:
    from starlette.middleware.proxy_headers import ProxyHeadersMiddleware
except Exception:  # pragma: no cover - optional dependency guard
    ProxyHeadersMiddleware = None

from app.core.logging import RequestLoggingMiddleware, configure_logging
from app.core.settings import settings
from app.core.observability import (
    setup_opentelemetry,
    setup_sqlalchemy_instrumentation,
    PrometheusMiddleware,
    metrics_endpoint,
    update_email_queue_metrics,
)
from app.db.session import engine, get_db
from app.modules.router_registry import include_all_routers
from app.services.checklist_rules_loader import (
    load_checklist_rules,
    load_document_categories,
    load_document_template_slots,
    refresh_seed_cache,
)

configure_logging(level=settings.log_level)

app = FastAPI(title=settings.project_name, version=settings.project_version)


def _resolve_repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in current.parents:
        if (candidate / ".git").exists():
            return candidate
    # Container images do not ship git metadata; fallback keeps version route resilient.
    return current.parent


v1_repo_root = _resolve_repo_root()
v1_build_time = os.getenv("BUILD_TIME") or datetime.now(timezone.utc).isoformat()
is_production = settings.environment.lower() in ("production", "prod")


def _resolve_v1_git_sha() -> str:
    if settings.git_sha:
        return settings.git_sha
    try:
        return subprocess.check_output(
            ["git", "-C", str(v1_repo_root), "rev-parse", "--short", "HEAD"],
            text=True,
        ).strip()
    except Exception:
        return "unknown"

# Always allow localhost during development (Vite often changes ports).
allow_origin_regex = None
if not is_production:
    allow_origin_regex = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"
else:
    if any(origin.strip() == "*" for origin in settings.allow_origins):
        raise RuntimeError("ALLOW_ORIGINS cannot include '*' in production")
    if settings.jwt_secret.startswith("change_me"):
        raise RuntimeError("JWT_SECRET must be set in production")
    if "change_me" in settings.database_url:
        raise RuntimeError("DATABASE_URL password must be set in production")


def _normalize_origin(value: str) -> str:
    return value.strip().rstrip("/").lower()


allowed_origin_set = {_normalize_origin(origin) for origin in settings.allow_origins if origin.strip()}


def _origin_allowed(origin: str | None) -> bool:
    if not origin:
        return True
    normalized = _normalize_origin(origin)
    if normalized in allowed_origin_set:
        return True
    if allow_origin_regex and re.match(allow_origin_regex, normalized):
        return True
    return False


def _harden_set_cookie_headers(response) -> None:
    hardened_headers = []
    for key, value in response.raw_headers:
        if key.lower() != b"set-cookie":
            hardened_headers.append((key, value))
            continue

        cookie = value.decode("latin-1")
        lowered = cookie.lower()
        if "httponly" not in lowered:
            cookie = f"{cookie}; HttpOnly"
        if "samesite=" not in lowered:
            cookie = f"{cookie}; SameSite=Lax"
        if is_production and "secure" not in lowered:
            cookie = f"{cookie}; Secure"
        hardened_headers.append((key, cookie.encode("latin-1")))

    response.raw_headers = hardened_headers

if ProxyHeadersMiddleware:
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allow_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "X-Request-Id",
        "Accept",
        "X-Step-Up-Token",
        "X-Admin-Master-Key",
    ],
)

# Observability middleware
app.add_middleware(PrometheusMiddleware)
app.add_middleware(RequestLoggingMiddleware)


@app.middleware("http")
async def security_enforcement_middleware(request: Request, call_next):
    origin = request.headers.get("origin")
    origin_allowed = _origin_allowed(origin)

    if is_production and origin and not origin_allowed:
        return JSONResponse(
            status_code=403,
            content={"detail": {"code": "ORIGIN_NOT_ALLOWED", "origin": origin}},
        )

    response = await call_next(request)

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = (
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
        "microphone=(), payment=(), usb=()"
    )
    # Roll out in report-only mode to avoid unexpected SPA breakage.
    response.headers["Content-Security-Policy-Report-Only"] = (
        "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; "
        "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: ws: wss:"
    )

    if is_production:
        if origin and origin_allowed:
            response.headers["Access-Control-Allow-Credentials"] = "true"
        elif "Access-Control-Allow-Credentials" in response.headers:
            del response.headers["Access-Control-Allow-Credentials"]

    _harden_set_cookie_headers(response)
    return response

# Prometheus metrics endpoint
app.add_api_route("/metrics", metrics_endpoint, methods=["GET"], tags=["observability"], include_in_schema=False)

include_all_routers(app)


@app.get("/healthz", tags=["health"])
def healthcheck(db: Session = Depends(get_db)) -> dict[str, str | int]:
    """
    Health check endpoint with DB and queue status.
    Returns 503 if any critical component is unhealthy.
    """
    try:
        # Check database connectivity
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        
        # Check email delivery queue backlog
        from app.models.support import EmailDeliveryLog
        queued_count = db.query(EmailDeliveryLog).filter(
            EmailDeliveryLog.status == "QUEUED"
        ).count()
        
        failed_count = db.query(EmailDeliveryLog).filter(
            EmailDeliveryLog.status == "FAILED",
            EmailDeliveryLog.attempts >= 5
        ).count()
        
        # Update Prometheus metrics
        update_email_queue_metrics(queued_count, failed_count)
        
        # Warn if queue backlog is high
        status = "ok"
        if queued_count > 100:
            status = "degraded"
        if failed_count > 50:
            status = "degraded"
            
        return {
            "status": status,
            "database": "ok",
            "email_queue_pending": queued_count,
            "email_queue_failed": failed_count,
        }
    except Exception as exc:  # pragma: no cover - runtime health check
        import logging
        logging.error(f"Healthcheck failed: {exc}", exc_info=True)
        raise HTTPException(status_code=503, detail="Service unavailable") from exc


@app.get("/v1/meta", tags=["health"])
def v1_meta() -> dict[str, str]:
    return {
        "app": "maulya-v1",
        "repo_root": str(v1_repo_root),
        "git_sha": _resolve_v1_git_sha(),
        "build_time": v1_build_time,
        "service": "api",
        "env": "prod" if settings.environment.lower() in ("production", "prod") else "dev",
    }


@app.get("/healthz/deps", tags=["health"])
def healthcheck_deps(db: Session = Depends(get_db)) -> dict[str, str | bool | int | float]:
    """
    Deep dependency health check.
    Includes storage, queue backlogs, and rate-limit table sanity.
    """
    import shutil

    from app.models.support import EmailDeliveryLog
    from app.models.rate_limit_bucket import RateLimitBucket

    checks: dict[str, bool | int | float] = {
        "database": False,
        "uploads_dir": False,
        "disk_space_ok": False,
        "outbox_backlog_ok": True,
        "email_backlog_ok": True,
        "rate_limit_table_ok": True,
    }

    # Database check
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception:
        pass

    # Uploads directory check
    uploads_path = Path(settings.uploads_dir)
    try:
        if uploads_path.exists() and uploads_path.is_dir():
            probe = uploads_path / ".healthcheck"
            probe.touch()
            probe.unlink()
            checks["uploads_dir"] = True
    except Exception:
        pass

    # Disk space check
    try:
        usage = shutil.disk_usage(uploads_path)
        free_percent = (usage.free / usage.total) * 100
        checks["disk_space_ok"] = free_percent > 10
        checks["disk_free_percent"] = round(free_percent, 1)
        checks["uploads_free_bytes"] = int(usage.free)
    except Exception:
        pass

    bridge_enabled = bool((settings.v2_events_ingest_url or "").strip())
    checks["bridge_enabled"] = bridge_enabled

    # Outbox backlog check (only meaningful when bridge is configured)
    outbox_backlog = 0
    if bridge_enabled:
        try:
            from app.models.v1_outbox_event import V1OutboxEvent

            outbox_backlog = (
                db.query(V1OutboxEvent)
                .filter(V1OutboxEvent.status != "DELIVERED")
                .count()
            )
        except Exception:
            checks["outbox_backlog_ok"] = False
    checks["outbox_backlog_count"] = outbox_backlog
    outbox_warn_threshold = int(os.getenv("WATCHDOG_OUTBOX_MAX", "200"))
    checks["outbox_backlog_warn_threshold"] = outbox_warn_threshold
    if outbox_backlog > outbox_warn_threshold:
        checks["outbox_backlog_ok"] = False

    # Email queue backlog
    try:
        email_pending = (
            db.query(EmailDeliveryLog)
            .filter(EmailDeliveryLog.status == "QUEUED")
            .count()
        )
    except Exception:
        email_pending = -1
        checks["email_backlog_ok"] = False
    checks["email_queue_pending_count"] = email_pending
    email_warn_threshold = int(os.getenv("WATCHDOG_EMAIL_MAX", "100"))
    checks["email_backlog_warn_threshold"] = email_warn_threshold
    if email_pending > email_warn_threshold:
        checks["email_backlog_ok"] = False

    # Rate limit table sanity
    try:
        rl_table_size = db.query(RateLimitBucket).count()
        checks["rate_limit_table_rows"] = rl_table_size
        max_rows = int(os.getenv("RATE_LIMIT_TABLE_MAX_ROWS", "50000"))
        checks["rate_limit_table_max_rows"] = max_rows
        if rl_table_size > max_rows:
            checks["rate_limit_table_ok"] = False
    except Exception:
        checks["rate_limit_table_ok"] = False

    all_ok = all(v for v in checks.values() if isinstance(v, bool))
    if not all_ok:
        raise HTTPException(status_code=503, detail=checks)

    return {"status": "ok", **checks}


@app.get("/readyz", tags=["health"])
def readiness() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            try:
                result = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
            except Exception:
                raise HTTPException(status_code=503, detail="Migrations not applied")
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - runtime readiness check
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ok", "alembic_revision": str(result)}


@app.get("/version", tags=["health"])
def version() -> dict[str, str | None]:
    return {
        "version": settings.project_version,
        "git_sha": settings.git_sha,
        "build": settings.build_version,
        "environment": settings.environment,
    }


@app.on_event("startup")
def startup_event():
    """Application startup event."""
    # Initialize OpenTelemetry tracing
    setup_opentelemetry(app, service_name="maulya-api")
    setup_sqlalchemy_instrumentation(engine)
    # Warm in-memory seed caches for checklist and upload slot rules.
    refresh_seed_cache()
    load_document_categories()
    load_checklist_rules()
    load_document_template_slots()
