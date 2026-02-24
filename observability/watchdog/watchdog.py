#!/usr/bin/env python3
"""
Zen Ops Watchdog - API/Frontend Contract Monitor

This service:
1. Periodically checks API health endpoints
2. Compares OpenAPI spec against frontend API calls
3. Runs basic smoke tests
4. Exposes Prometheus metrics
5. Logs in structured JSON for Loki
"""

import asyncio
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from prometheus_client import Counter, Gauge, generate_latest, CONTENT_TYPE_LATEST
from aiohttp import web

# Configuration
API_BASE_URL = os.getenv("API_BASE_URL", "http://api:8000")
CHECK_INTERVAL = int(os.getenv("CHECK_INTERVAL", "60"))
FRONTEND_ENDPOINTS_FILE = os.getenv("FRONTEND_ENDPOINTS_FILE", "/app/frontend_endpoints.json")
SMOKE_TEST_USER = os.getenv("SMOKE_TEST_USER", "")
SMOKE_TEST_PASSWORD = os.getenv("SMOKE_TEST_PASSWORD", "")

# Prometheus metrics
contract_missing_total = Counter(
    "zenops_contract_missing_total",
    "Total count of missing API endpoints called by frontend",
    ["path"]
)

smoke_test_success = Gauge(
    "zenops_smoke_test_success",
    "Whether smoke tests are passing (1=pass, 0=fail)"
)

api_health_up = Gauge(
    "zenops_api_health_up",
    "Whether API health endpoints are responding (1=up, 0=down)",
    ["endpoint"]
)

last_check_timestamp = Gauge(
    "zenops_watchdog_last_check_timestamp_seconds",
    "Timestamp of last successful check"
)

openapi_endpoints_total = Gauge(
    "zenops_openapi_endpoints_total",
    "Total number of endpoints in OpenAPI spec"
)

frontend_endpoints_total = Gauge(
    "zenops_frontend_endpoints_total",
    "Total number of endpoints called by frontend"
)


class JsonFormatter(logging.Formatter):
    """JSON log formatter for Loki ingestion."""
    
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "service": "watchdog",
        }
        
        for key in ("endpoint", "path", "error", "status", "latency_ms"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        
        return json.dumps(payload, default=str)


def configure_logging():
    """Configure structured JSON logging."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)


logger = logging.getLogger("watchdog")


def load_frontend_endpoints() -> set[str]:
    """Load frontend API endpoints from generated file."""
    try:
        if Path(FRONTEND_ENDPOINTS_FILE).exists():
            with open(FRONTEND_ENDPOINTS_FILE) as f:
                data = json.load(f)
                return set(data.get("endpoints", []))
    except Exception as e:
        logger.error("Failed to load frontend endpoints", extra={"error": str(e)})
    return set()


def normalize_path(path: str) -> str:
    """Normalize API path for comparison (replace IDs with placeholders)."""
    # Replace numeric IDs with {id}
    path = re.sub(r"/\d+", "/{id}", path)
    # Remove query strings
    path = path.split("?")[0]
    # Ensure leading slash
    if not path.startswith("/"):
        path = "/" + path
    return path


def extract_openapi_paths(openapi_spec: dict) -> set[str]:
    """Extract all paths from OpenAPI specification."""
    paths = set()
    for path in openapi_spec.get("paths", {}).keys():
        # Normalize OpenAPI path parameters
        normalized = re.sub(r"\{[^}]+\}", "{id}", path)
        paths.add(normalized)
    return paths


async def check_health_endpoints(client: httpx.AsyncClient) -> dict[str, bool]:
    """Check API health endpoints."""
    endpoints = {
        "readyz": f"{API_BASE_URL}/readyz",
        "healthz": f"{API_BASE_URL}/healthz",
    }
    
    results = {}
    for name, url in endpoints.items():
        try:
            start = time.perf_counter()
            response = await client.get(url, timeout=10)
            latency_ms = (time.perf_counter() - start) * 1000
            
            is_healthy = response.status_code == 200
            results[name] = is_healthy
            api_health_up.labels(endpoint=name).set(1 if is_healthy else 0)
            
            logger.info(
                f"Health check: {name}",
                extra={
                    "endpoint": name,
                    "status": response.status_code,
                    "latency_ms": round(latency_ms, 2),
                }
            )
        except Exception as e:
            results[name] = False
            api_health_up.labels(endpoint=name).set(0)
            logger.error(
                f"Health check failed: {name}",
                extra={"endpoint": name, "error": str(e)}
            )
    
    return results


async def fetch_openapi_spec(client: httpx.AsyncClient) -> Optional[dict]:
    """Fetch OpenAPI specification from API."""
    try:
        response = await client.get(f"{API_BASE_URL}/openapi.json", timeout=10)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        logger.error("Failed to fetch OpenAPI spec", extra={"error": str(e)})
    return None


async def check_contract(client: httpx.AsyncClient) -> list[str]:
    """Compare frontend endpoints against OpenAPI spec."""
    frontend_endpoints = load_frontend_endpoints()
    frontend_endpoints_total.set(len(frontend_endpoints))
    
    if not frontend_endpoints:
        logger.warning("No frontend endpoints loaded")
        return []
    
    openapi_spec = await fetch_openapi_spec(client)
    if not openapi_spec:
        logger.error("Could not fetch OpenAPI spec for contract check")
        return []
    
    openapi_paths = extract_openapi_paths(openapi_spec)
    openapi_endpoints_total.set(len(openapi_paths))
    
    # Find missing endpoints
    missing = []
    for endpoint in frontend_endpoints:
        normalized = normalize_path(endpoint)
        if normalized not in openapi_paths:
            missing.append(endpoint)
            contract_missing_total.labels(path=endpoint).inc()
            logger.error(
                f"Contract mismatch: endpoint not in OpenAPI",
                extra={"path": endpoint}
            )
    
    if missing:
        logger.warning(
            f"Found {len(missing)} missing endpoints",
            extra={"count": len(missing)}
        )
    else:
        logger.info("Contract check passed - all frontend endpoints exist in OpenAPI")
    
    return missing


async def run_smoke_tests(client: httpx.AsyncClient) -> bool:
    """Run basic smoke tests against API."""
    tests_passed = True
    
    # Test 1: Check readyz
    try:
        response = await client.get(f"{API_BASE_URL}/readyz", timeout=10)
        if response.status_code != 200:
            logger.error("Smoke test failed: /readyz", extra={"status": response.status_code})
            tests_passed = False
    except Exception as e:
        logger.error("Smoke test failed: /readyz", extra={"error": str(e)})
        tests_passed = False
    
    # Test 2: Check openapi.json exists
    try:
        response = await client.get(f"{API_BASE_URL}/openapi.json", timeout=10)
        if response.status_code != 200:
            logger.error("Smoke test failed: /openapi.json", extra={"status": response.status_code})
            tests_passed = False
    except Exception as e:
        logger.error("Smoke test failed: /openapi.json", extra={"error": str(e)})
        tests_passed = False
    
    # Test 3: Check version endpoint
    try:
        response = await client.get(f"{API_BASE_URL}/version", timeout=10)
        if response.status_code != 200:
            logger.error("Smoke test failed: /version", extra={"status": response.status_code})
            tests_passed = False
    except Exception as e:
        logger.error("Smoke test failed: /version", extra={"error": str(e)})
        tests_passed = False
    
    # Test 4: Login and authenticated endpoints (if credentials provided)
    if SMOKE_TEST_USER and SMOKE_TEST_PASSWORD:
        try:
            # Login
            login_response = await client.post(
                f"{API_BASE_URL}/api/auth/login",
                data={"username": SMOKE_TEST_USER, "password": SMOKE_TEST_PASSWORD},
                timeout=10
            )
            
            if login_response.status_code == 200:
                token = login_response.json().get("access_token")
                headers = {"Authorization": f"Bearer {token}"}
                
                # Check assignments summary
                response = await client.get(
                    f"{API_BASE_URL}/api/assignments/summary",
                    headers=headers,
                    timeout=10
                )
                if response.status_code not in (200, 403):
                    logger.error("Smoke test failed: /api/assignments/summary", extra={"status": response.status_code})
                    tests_passed = False
                
                # Check document templates
                response = await client.get(
                    f"{API_BASE_URL}/api/master/document-templates",
                    headers=headers,
                    timeout=10
                )
                if response.status_code not in (200, 403):
                    logger.error("Smoke test failed: /api/master/document-templates", extra={"status": response.status_code})
                    tests_passed = False
            else:
                logger.warning("Smoke test login failed - skipping authenticated tests", extra={"status": login_response.status_code})
        except Exception as e:
            logger.error("Smoke test authentication failed", extra={"error": str(e)})
    
    smoke_test_success.set(1 if tests_passed else 0)
    
    if tests_passed:
        logger.info("All smoke tests passed")
    else:
        logger.error("Some smoke tests failed")
    
    return tests_passed


async def run_checks():
    """Run all checks periodically."""
    async with httpx.AsyncClient() as client:
        while True:
            try:
                logger.info("Starting watchdog check cycle")
                
                # Health checks
                await check_health_endpoints(client)
                
                # Contract check
                await check_contract(client)
                
                # Smoke tests
                await run_smoke_tests(client)
                
                # Update last check timestamp
                last_check_timestamp.set(time.time())
                
                logger.info("Watchdog check cycle complete")
            except Exception as e:
                logger.exception("Watchdog check cycle failed", extra={"error": str(e)})
            
            await asyncio.sleep(CHECK_INTERVAL)


async def metrics_handler(request: web.Request) -> web.Response:
    """Prometheus metrics endpoint."""
    return web.Response(
        body=generate_latest(),
        content_type="text/plain"
    )


async def health_handler(request: web.Request) -> web.Response:
    """Health check endpoint."""
    return web.Response(text='{"status":"ok"}', content_type="application/json")


async def start_background_tasks(app: web.Application):
    """Start background check task."""
    app["checker"] = asyncio.create_task(run_checks())


async def cleanup_background_tasks(app: web.Application):
    """Cancel background tasks on shutdown."""
    app["checker"].cancel()
    try:
        await app["checker"]
    except asyncio.CancelledError:
        pass


def main():
    """Main entry point."""
    configure_logging()
    logger.info("Starting Zen Ops Watchdog")
    
    app = web.Application()
    app.router.add_get("/metrics", metrics_handler)
    app.router.add_get("/health", health_handler)
    
    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)
    
    web.run_app(app, host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
