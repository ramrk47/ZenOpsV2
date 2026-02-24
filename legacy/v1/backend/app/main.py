from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
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
if settings.environment != "production":
    allow_origin_regex = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"
else:
    if any(origin.strip() == "*" for origin in settings.allow_origins):
        raise RuntimeError("ALLOW_ORIGINS cannot include '*' in production")
    if settings.jwt_secret.startswith("change_me"):
        raise RuntimeError("JWT_SECRET must be set in production")
    if "change_me" in settings.database_url:
        raise RuntimeError("DATABASE_URL password must be set in production")

if ProxyHeadersMiddleware:
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allow_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id", "Accept", "X-Step-Up-Token"],
)

# Observability middleware
app.add_middleware(PrometheusMiddleware)
app.add_middleware(RequestLoggingMiddleware)

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
        "app": "zenops-v1",
        "repo_root": str(v1_repo_root),
        "git_sha": _resolve_v1_git_sha(),
        "build_time": v1_build_time,
        "service": "api",
        "env": "prod" if settings.environment.lower() in ("production", "prod") else "dev",
    }


@app.get("/healthz/deps", tags=["health"])
def healthcheck_deps() -> dict[str, str | bool]:
    """
    Deep health check for all dependencies.
    Checks database, uploads directory, and disk space.
    """
    import shutil
    
    checks = {
        "database": False,
        "uploads_dir": False,
        "disk_space_ok": False,
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
            # Test write access
            test_file = uploads_path / ".healthcheck"
            test_file.touch()
            test_file.unlink()
            checks["uploads_dir"] = True
    except Exception:
        pass
    
    # Disk space check (warn if <10% free)
    try:
        usage = shutil.disk_usage(uploads_path)
        free_percent = (usage.free / usage.total) * 100
        checks["disk_space_ok"] = free_percent > 10
        checks["disk_free_percent"] = round(free_percent, 1)
    except Exception:
        pass
    
    all_ok = all(v for k, v in checks.items() if isinstance(v, bool))
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
    setup_opentelemetry(app, service_name="zenops-api")
    setup_sqlalchemy_instrumentation(engine)
