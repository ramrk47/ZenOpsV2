# Demo Deployment

This deploys a public Maulya V1 demo on the same VPS without touching pilot data.

## Isolation Model

- Separate compose project: `maulya-demo`
- Separate domain: `demo.maulya.in`
- Separate Postgres volume
- Separate Redis volume
- Separate uploads volume
- Separate `.env.demo` and `.env.demo.backend`
- Separate JWT secret
- Email disabled
- Demo traffic rate-limited at Traefik

## Files

- `docker-compose.hostinger.yml`
- `docker-compose.demo.yml`
- `ops/bootstrap_demo_env.sh`
- `ops/demo_up.sh`
- `ops/demo_reset.sh`
- `ops/demo_smoke.sh`

## Bootstrap

```bash
cd legacy/v1
DEMO_DOMAIN=demo.maulya.in ./ops/bootstrap_demo_env.sh --force
```

This creates:

- `.env.demo`
- `.env.demo.backend`

Review both before deploy.

## Bring Up Demo

```bash
cd legacy/v1
./ops/demo_up.sh
./ops/demo_reset.sh
./ops/demo_smoke.sh
```

## Demo Credentials

These are seeded by `ops/demo_reset.sh`:

- `admin@maulya.local / password`
- `field@maulya.local / password`
- `associate@maulya.local / password`

The demo login page exposes these roles only when `VITE_DEMO_MODE=1`.

## Nightly Reset

Recommended:

```bash
0 3 * * * cd /root/maulya-v1/legacy/v1 && ./ops/demo_reset.sh >> /var/log/maulya-demo-reset.log 2>&1
```

That keeps the demo dataset fresh and prevents drift from public use.

## Notes

- Demo uses `seed_e2e` so the workspace contains realistic assignments, approvals, invoices, and associate data.
- Pilot and demo must never share `.env` files or secrets.
- Because demo runs on a different subdomain, browser localStorage is origin-isolated from pilot.
- If you change router names, keep `TRAEFIK_ROUTER_PREFIX` unique per environment.
