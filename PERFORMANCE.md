# Performance & Scalability (Target ~100 Users)

## Recommended settings

- `WEB_CONCURRENCY`: 2-4 per CPU core (start with 2 on small VPS)
- `DB_POOL_SIZE`: 5
- `DB_MAX_OVERFLOW`: 10
- `DB_POOL_TIMEOUT`: 30
- `DB_POOL_RECYCLE`: 1800

## Gunicorn example

```
gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 2 -b 0.0.0.0:8000
```

## Load test (quick)

```
hey -n 200 -c 25 http://localhost:8000/healthz
```

Use k6/hey against `/api/assignments` or `/api/invoices` once authenticated.
