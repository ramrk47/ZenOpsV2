#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import Boolean, Date, DateTime, Enum, Float, Integer, Numeric, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection

from app.db.session import engine
from app.models import Base


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Restore Zen Ops database from Excel snapshot")
    parser.add_argument("--path", required=True, help="Path to .xlsx snapshot")
    parser.add_argument("--truncate", action="store_true", help="Truncate tables before restore")
    parser.add_argument("--disable-constraints", action="store_true", help="Disable FK checks during restore (Postgres only)")
    return parser.parse_args()


def _safe_sheet_name(name: str, used: set[str]) -> str:
    cleaned = "".join(c if c.isalnum() or c in "_- " else "_" for c in name).strip() or "Sheet"
    cleaned = cleaned[:31]
    if cleaned not in used:
        used.add(cleaned)
        return cleaned
    idx = 2
    while True:
        suffix = f"_{idx}"
        candidate = f"{cleaned[:31 - len(suffix)]}{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        idx += 1


def _table_order(metadata) -> list[str]:
    tables = {name: table for name, table in metadata.tables.items() if name != "alembic_version"}
    deps = {name: set() for name in tables}
    for name, table in tables.items():
        for fk in table.foreign_keys:
            ref_table = fk.column.table.name
            if ref_table in tables and ref_table != name:
                deps[name].add(ref_table)

    ordered = []
    while deps:
        ready = sorted([name for name, parents in deps.items() if not parents])
        if not ready:
            ordered.extend(sorted(deps.keys()))
            break
        for name in ready:
            ordered.append(name)
            deps.pop(name)
        for parents in deps.values():
            parents.difference_update(ready)
    return ordered


def _is_nan(value: Any) -> bool:
    return isinstance(value, float) and math.isnan(value)


def _coerce_value(value: Any, column) -> Any:
    if value is None or _is_nan(value):
        return None

    if isinstance(column.type, JSONB):
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return value
        return value

    if isinstance(column.type, (DateTime,)):
        if isinstance(value, datetime):
            return value
        parsed = pd.to_datetime(value, errors="coerce")
        if pd.isna(parsed):
            return None
        return parsed.to_pydatetime()

    if isinstance(column.type, (Date,)):
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        parsed = pd.to_datetime(value, errors="coerce")
        if pd.isna(parsed):
            return None
        return parsed.date()

    if isinstance(column.type, (Boolean,)):
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"true", "1", "yes", "y"}
        return bool(value)

    if isinstance(column.type, (Integer,)):
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, str) and value.strip():
            return int(float(value))

    if isinstance(column.type, (Numeric, Float)):
        if isinstance(value, Decimal):
            return value
        if isinstance(value, (int, float)):
            return Decimal(str(value)) if isinstance(column.type, Numeric) else float(value)
        if isinstance(value, str) and value.strip():
            return Decimal(value) if isinstance(column.type, Numeric) else float(value)

    if isinstance(column.type, Enum):
        return str(value)

    return value


def _truncate_tables(conn: Connection, tables: list[str]) -> None:
    if not tables:
        return
    table_list = ", ".join(f'"{name}"' for name in tables)
    conn.execute(text(f"TRUNCATE {table_list} CASCADE"))


def _reset_sequences(conn: Connection, tables: list[str]) -> None:
    for table_name in tables:
        table = Base.metadata.tables.get(table_name)
        if not table:
            continue
        pk_cols = list(table.primary_key.columns)
        if len(pk_cols) != 1:
            continue
        pk = pk_cols[0]
        if not pk.autoincrement:
            continue
        seq_sql = (
            f"SELECT setval(pg_get_serial_sequence('{table_name}', '{pk.name}'), "
            f"COALESCE((SELECT MAX({pk.name}) FROM {table_name}), 1), true)"
        )
        conn.execute(text(seq_sql))


def main() -> None:
    args = parse_args()
    path = Path(args.path).expanduser().resolve()
    if not path.exists():
        raise SystemExit(f"Snapshot not found: {path}")

    metadata = Base.metadata
    table_order = _table_order(metadata)

    sheet_map = {}
    used = set()
    for table_name in table_order:
        sheet_map[table_name] = _safe_sheet_name(table_name, used)

    with engine.begin() as conn:
        if args.disable_constraints and engine.dialect.name == "postgresql":
            conn.execute(text("SET session_replication_role = 'replica'"))

        if args.truncate:
            _truncate_tables(conn, table_order)

        for table_name in table_order:
            sheet_name = sheet_map[table_name]
            try:
                df = pd.read_excel(path, sheet_name=sheet_name, dtype=object)
            except ValueError:
                continue
            if df.empty:
                continue
            table = metadata.tables.get(table_name)
            if not table:
                continue
            columns = {col.name: col for col in table.columns}
            records = []
            for _, row in df.iterrows():
                record = {}
                for col_name, value in row.items():
                    column = columns.get(col_name)
                    if not column:
                        continue
                    record[col_name] = _coerce_value(value, column)
                records.append(record)
            if records:
                conn.execute(table.insert(), records)

        if engine.dialect.name == "postgresql":
            _reset_sequences(conn, table_order)

        if args.disable_constraints and engine.dialect.name == "postgresql":
            conn.execute(text("SET session_replication_role = 'origin'"))

    print(f"Restore complete from {path}")


if __name__ == "__main__":
    main()
