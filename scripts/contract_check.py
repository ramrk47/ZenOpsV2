#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_SRC = ROOT / "frontend" / "src"
OPENAPI_PATH = ROOT / "docs" / "openapi.json"
REPORT_PATH = ROOT / "docs" / "CONTRACT_REPORT.md"

API_CALL_RE = re.compile(
    r"\b(?P<client>api|axios)\.(?P<method>get|post|put|patch|delete)\(\s*(?P<quote>[`\"'])"
    r"(?P<path>.+?)(?P=quote)",
    re.DOTALL,
)
FETCH_RE = re.compile(
    r"\bfetch\(\s*(?P<quote>[`\"'])(?P<path>.+?)(?P=quote)",
    re.DOTALL,
)


@dataclass
class CallSite:
    file: str
    line: int
    method: str
    raw_path: str
    norm_path: str
    source: str


@dataclass
class MatchResult:
    call: CallSite
    matched: bool
    openapi_path: str | None
    response_shape: str



def _normalize_path(raw: str) -> str:
    path = raw.strip()
    path = path.replace("${API_BASE_URL}", "")
    path = re.sub(r"\$\{[^}]+\}", "{param}", path)
    path = path.split("?", 1)[0]
    if path.startswith("http://") or path.startswith("https://"):
        path = "/" + path.split("/", 3)[-1]
    if not path.startswith("/"):
        path = "/" + path
    path = re.sub(r"/+", "/", path)
    return path.rstrip("/") or "/"



def _iter_files() -> Iterable[Path]:
    for p in FRONTEND_SRC.rglob("*.js"):
        yield p
    for p in FRONTEND_SRC.rglob("*.jsx"):
        yield p



def _collect_calls() -> list[CallSite]:
    calls: list[CallSite] = []
    for path in _iter_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        rel = str(path.relative_to(ROOT))

        for m in API_CALL_RE.finditer(text):
            raw_path = m.group("path")
            line = text.count("\n", 0, m.start()) + 1
            calls.append(
                CallSite(
                    file=rel,
                    line=line,
                    method=m.group("method").upper(),
                    raw_path=raw_path,
                    norm_path=_normalize_path(raw_path),
                    source=m.group("client"),
                )
            )

        # fetch() defaults to GET when options are non-literal; assume GET for static-url scans.
        for m in FETCH_RE.finditer(text):
            raw_path = m.group("path")
            line = text.count("\n", 0, m.start()) + 1
            calls.append(
                CallSite(
                    file=rel,
                    line=line,
                    method="GET",
                    raw_path=raw_path,
                    norm_path=_normalize_path(raw_path),
                    source="fetch",
                )
            )

    return calls



def _openapi_routes(spec: dict) -> dict[str, dict[str, dict]]:
    routes: dict[str, dict[str, dict]] = {}
    for path, methods in spec.get("paths", {}).items():
        routes[path] = {}
        for method, meta in methods.items():
            if method.lower() in {"get", "post", "put", "patch", "delete"}:
                routes[path][method.upper()] = meta
    return routes



def _path_matches(call_path: str, openapi_path: str) -> bool:
    call_parts = [p for p in call_path.strip("/").split("/") if p]
    open_parts = [p for p in openapi_path.strip("/").split("/") if p]
    if len(call_parts) != len(open_parts):
        return False
    for c, o in zip(call_parts, open_parts):
        if o.startswith("{") and o.endswith("}"):
            continue
        if c != o:
            return False
    return True



def _response_shape(op: dict) -> str:
    responses = op.get("responses", {})
    preferred = None
    for code in ("200", "201", "202", "204", "default"):
        if code in responses:
            preferred = responses[code]
            break
    if not preferred:
        return "unknown"
    content = preferred.get("content", {})
    app_json = content.get("application/json") if isinstance(content, dict) else None
    schema = (app_json or {}).get("schema", {}) if isinstance(app_json, dict) else {}
    if not schema:
        return preferred.get("description", "no-json-response")
    if "$ref" in schema:
        return schema["$ref"].split("/")[-1]
    if "type" in schema:
        if schema["type"] == "array":
            items = schema.get("items", {})
            if isinstance(items, dict) and "$ref" in items:
                return f"array<{items['$ref'].split('/')[-1]}>"
            return "array"
        return str(schema["type"])
    return "schema"



def _match_calls(calls: list[CallSite], routes: dict[str, dict[str, dict]]) -> list[MatchResult]:
    results: list[MatchResult] = []
    for call in calls:
        matched_path = None
        shape = "unknown"
        for path, methods in routes.items():
            if call.method not in methods:
                continue
            if _path_matches(call.norm_path, path):
                matched_path = path
                shape = _response_shape(methods[call.method])
                break
        results.append(
            MatchResult(
                call=call,
                matched=matched_path is not None,
                openapi_path=matched_path,
                response_shape=shape,
            )
        )
    return results



def _write_report(results: list[MatchResult]) -> tuple[int, int]:
    total = len(results)
    mismatches = [r for r in results if not r.matched and r.call.norm_path.startswith("/api/")]

    lines = [
        "# Frontend/Backend Contract Report",
        "",
        f"- Total call sites scanned: **{total}**",
        f"- Mismatches: **{len(mismatches)}**",
        "",
        "## Call Site Map",
        "",
        "| File | Method | Frontend Path | Backend OpenAPI Path | Response Shape | Status |",
        "|---|---|---|---|---|---|",
    ]

    for r in sorted(results, key=lambda x: (x.call.file, x.call.line)):
        status = "OK" if r.matched else "MISMATCH"
        backend_path = r.openapi_path or "-"
        lines.append(
            f"| `{r.call.file}:{r.call.line}` | `{r.call.method}` | `{r.call.norm_path}` | "
            f"`{backend_path}` | `{r.response_shape}` | {status} |"
        )

    if mismatches:
        lines.extend(["", "## Mismatches", ""])
        for r in mismatches:
            lines.append(
                f"- `{r.call.file}:{r.call.line}` `{r.call.method} {r.call.norm_path}` does not match OpenAPI"
            )

    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return total, len(mismatches)



def main() -> int:
    parser = argparse.ArgumentParser(description="Check frontend API contracts against OpenAPI")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when mismatches are found")
    args = parser.parse_args()

    if not OPENAPI_PATH.exists():
        raise SystemExit(f"Missing {OPENAPI_PATH}. Generate it first.")

    spec = json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))
    routes = _openapi_routes(spec)
    calls = _collect_calls()
    results = _match_calls(calls, routes)
    total, mismatch_count = _write_report(results)

    print(f"Scanned {total} call sites. Mismatches: {mismatch_count}")
    if args.strict and mismatch_count > 0:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
