"""
OpenTelemetry and Prometheus instrumentation for Zen Ops API.

This module sets up:
- OpenTelemetry tracing with OTLP export
- Prometheus metrics endpoint
- Request/exception counters
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Request, Response
from fastapi.responses import PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# Prometheus metrics
http_requests_total = Counter(
    "http_server_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"]
)

http_request_duration_seconds = Histogram(
    "http_server_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "path"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)

http_exceptions_total = Counter(
    "http_server_exceptions_total",
    "Total unhandled exceptions",
    ["method", "path", "exception_type"]
)

zenops_email_queue_pending = Gauge(
    "zenops_email_queue_pending",
    "Number of pending emails in queue"
)

zenops_email_queue_failed = Gauge(
    "zenops_email_queue_failed",
    "Number of failed emails in queue"
)


def setup_opentelemetry(app, service_name: str = "zenops-api") -> None:
    """Initialize OpenTelemetry instrumentation if enabled."""
    otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not otel_endpoint:
        logger.info("OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping OpenTelemetry setup")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource, SERVICE_NAME
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        resource = Resource.create({SERVICE_NAME: service_name})
        provider = TracerProvider(resource=resource)
        
        otlp_exporter = OTLPSpanExporter(endpoint=otel_endpoint, insecure=True)
        provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
        
        trace.set_tracer_provider(provider)
        
        FastAPIInstrumentor.instrument_app(app)
        
        logger.info(f"OpenTelemetry initialized, exporting to {otel_endpoint}")
    except ImportError as e:
        logger.warning(f"OpenTelemetry packages not available: {e}")
    except Exception as e:
        logger.error(f"Failed to initialize OpenTelemetry: {e}")


def setup_sqlalchemy_instrumentation(engine) -> None:
    """Instrument SQLAlchemy engine for tracing."""
    otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not otel_endpoint:
        return

    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        SQLAlchemyInstrumentor().instrument(engine=engine)
        logger.info("SQLAlchemy instrumentation enabled")
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"Failed to instrument SQLAlchemy: {e}")


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Middleware to collect Prometheus metrics for all requests."""

    async def dispatch(self, request: Request, call_next) -> Response:
        import time
        
        # Skip metrics endpoint to avoid recursion
        if request.url.path == "/metrics":
            return await call_next(request)
        
        method = request.method
        # Normalize path to avoid high cardinality (replace IDs with placeholder)
        path = self._normalize_path(request.url.path)
        
        start_time = time.perf_counter()
        
        try:
            response = await call_next(request)
            duration = time.perf_counter() - start_time
            
            http_requests_total.labels(
                method=method,
                path=path,
                status=response.status_code
            ).inc()
            
            http_request_duration_seconds.labels(
                method=method,
                path=path
            ).observe(duration)
            
            return response
        except Exception as e:
            duration = time.perf_counter() - start_time
            
            http_exceptions_total.labels(
                method=method,
                path=path,
                exception_type=type(e).__name__
            ).inc()
            
            http_requests_total.labels(
                method=method,
                path=path,
                status=500
            ).inc()
            
            http_request_duration_seconds.labels(
                method=method,
                path=path
            ).observe(duration)
            
            raise

    def _normalize_path(self, path: str) -> str:
        """Replace numeric IDs in path with placeholder to reduce cardinality."""
        import re
        # Replace /123 with /{id}
        normalized = re.sub(r'/\d+', '/{id}', path)
        # Limit path segments to avoid cardinality explosion
        parts = normalized.split('/')[:5]
        return '/'.join(parts)


async def metrics_endpoint(request: Request) -> Response:
    """Prometheus metrics endpoint handler."""
    return PlainTextResponse(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )


def update_email_queue_metrics(pending: int, failed: int) -> None:
    """Update email queue metrics (called from healthcheck)."""
    zenops_email_queue_pending.set(pending)
    zenops_email_queue_failed.set(failed)
