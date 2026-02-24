from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Request, Response
from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.security import decode_token


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        for key in (
            "request_id",
            "user_id",
            "path",
            "method",
            "status_code",
            "latency_ms",
        ):
            if hasattr(record, key):
                payload[key] = getattr(record, key)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(
        level=level,
        handlers=[handler],
        force=True,
    )


def _resolve_user_id(request: Request) -> Optional[int]:
    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        payload = decode_token(token)
        raw_user_id = payload.get("sub")
        if raw_user_id is None:
            return None
        return int(raw_user_id)
    except (JWTError, ValueError, TypeError):
        return None


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, logger_name: str = "request") -> None:
        super().__init__(app)
        self.logger = logging.getLogger(logger_name)

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            latency_ms = (time.perf_counter() - start) * 1000
            self.logger.exception(
                "unhandled_exception",
                extra={
                    "request_id": request_id,
                    "path": request.url.path,
                    "method": request.method,
                    "latency_ms": round(latency_ms, 2),
                    "user_id": _resolve_user_id(request),
                },
            )
            raise

        latency_ms = (time.perf_counter() - start) * 1000
        user_id = _resolve_user_id(request)
        self.logger.info(
            "request",
            extra={
                "request_id": request_id,
                "path": request.url.path,
                "method": request.method,
                "status_code": response.status_code,
                "latency_ms": round(latency_ms, 2),
                "user_id": user_id,
            },
        )

        if response.status_code == 403 and user_id:
            security_logger = logging.getLogger("security")
            security_logger.info(
                "forbidden",
                extra={
                    "request_id": request_id,
                    "path": request.url.path,
                    "method": request.method,
                    "status_code": response.status_code,
                    "user_id": user_id,
                },
            )

        response.headers["X-Request-Id"] = request_id
        return response
