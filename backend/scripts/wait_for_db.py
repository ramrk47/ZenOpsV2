from __future__ import annotations

import os
import time

from sqlalchemy import create_engine, text


def main() -> None:
    database_url = os.getenv("DATABASE_URL", "")
    timeout = int(os.getenv("DB_WAIT_TIMEOUT", "30"))
    interval = float(os.getenv("DB_WAIT_INTERVAL", "2"))

    if not database_url:
        raise SystemExit("DATABASE_URL is not set")

    engine = create_engine(database_url, pool_pre_ping=True, future=True)
    start = time.time()
    while True:
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            break
        except Exception:
            if time.time() - start >= timeout:
                raise SystemExit("Database not reachable within timeout")
            time.sleep(interval)


if __name__ == "__main__":
    main()
