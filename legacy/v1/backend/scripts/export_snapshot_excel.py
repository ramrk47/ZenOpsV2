#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import json
import os
import re
import warnings
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2 import sql


def _safe_sheet_name(name: str, used: set[str]) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_\- ]", "_", name).strip() or "Sheet"
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


def _normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in df.columns:
        series = df[col]
        if pd.api.types.is_datetime64_any_dtype(series):
            df[col] = series.dt.tz_localize(None).astype("datetime64[ns]")
    return df


def _get_db_url() -> str:
    url = os.environ.get("DATABASE_URL") or ""
    if not url:
        raise RuntimeError("DATABASE_URL is required for Excel export")
    return url.replace("postgresql+psycopg2", "postgresql")


def _fetch_table_names(conn) -> list[str]:
    query = """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    """
    with conn.cursor() as cur:
        cur.execute(query)
        return [row[0] for row in cur.fetchall()]


def main() -> None:
    export_dir = Path(os.environ.get("EXPORT_DIR", "./backups")).expanduser().resolve()
    export_dir.mkdir(parents=True, exist_ok=True)

    app_name = os.environ.get("APP_NAME", "zenops")
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S")
    export_path = Path(os.environ.get("EXPORT_PATH", ""))
    if not export_path:
        export_path = export_dir / f"{app_name}_snapshot_{timestamp}.xlsx"
    else:
        export_path = export_path.expanduser().resolve()

    exclude_tables = set(filter(None, os.environ.get("EXCLUDE_TABLES", "alembic_version").split(",")))
    include_tables_raw = os.environ.get("INCLUDE_TABLES")
    include_tables = set(filter(None, include_tables_raw.split(","))) if include_tables_raw else None

    db_url = _get_db_url()

    used_sheet_names: set[str] = set()
    summary_rows = []

    warnings.filterwarnings("ignore", message="pandas only supports SQLAlchemy", category=UserWarning)

    with psycopg2.connect(db_url) as conn:
        tables = [t for t in _fetch_table_names(conn) if t not in exclude_tables]
        if include_tables is not None:
            tables = [t for t in tables if t in include_tables]

        with pd.ExcelWriter(export_path, engine="openpyxl") as writer:
            for table_name in tables:
                query = sql.SQL("SELECT * FROM {table}").format(table=sql.Identifier(table_name))
                df = pd.read_sql_query(query.as_string(conn), con=conn)
                df = _normalize_dataframe(df)
                sheet = _safe_sheet_name(table_name, used_sheet_names)
                df.to_excel(writer, sheet_name=sheet, index=False)
                summary_rows.append({"table": table_name, "sheet": sheet, "rows": len(df)})

            meta = {
                "exported_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                "database_url": db_url,
                "row_counts": summary_rows,
            }
            meta_df = pd.DataFrame(
                [
                    {
                        "exported_at_utc": meta["exported_at_utc"],
                        "database_url": meta["database_url"],
                        "rows": json.dumps(summary_rows),
                    }
                ]
            )
            meta_df.to_excel(writer, sheet_name=_safe_sheet_name("__meta__", used_sheet_names), index=False)

    print(f"Excel snapshot created: {export_path}")


if __name__ == "__main__":
    main()
