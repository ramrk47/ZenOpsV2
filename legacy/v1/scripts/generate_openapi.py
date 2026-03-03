#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate FastAPI OpenAPI schema snapshot for V1.",
    )
    parser.add_argument(
        "--output",
        default="docs/openapi.json",
        help="Output path relative to legacy/v1 root (default: docs/openapi.json).",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    backend_root = repo_root / "backend"
    sys.path.insert(0, str(backend_root))

    from app.main import app  # pylint: disable=import-outside-toplevel

    output_path = (repo_root / args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    schema = app.openapi()
    payload = json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True)
    output_path.write_text(payload + "\n", encoding="utf-8")

    print(f"Wrote OpenAPI schema to {output_path}")
    print(f"Path count: {len(schema.get('paths', {}))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
