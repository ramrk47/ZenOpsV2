# Domain Transfer Protocol (V1 Pilot)

## Purpose
- Move V1 between pilot domains/subdomains without downtime surprises.
- Keep TLS and CORS aligned while domain cutover happens.

## Current Example
- Active domain: `zenops.notalonestudios.com`
- VPS IP: `89.116.134.199`

## 1) Add DNS Records (New Domain)
For new target domain `new-zenops.example.com`:
- Create `A` record:
  - Host: `new-zenops`
  - Value: `89.116.134.199`
  - TTL: 300 (recommended during cutover)

Validate from VPS:
```bash
dig +short new-zenops.example.com
```

## 2) Update V1 Environment
Edit `legacy/v1/.env`:
- `ZENOPS_DOMAIN=new-zenops.example.com`

Edit `legacy/v1/.env.backend`:
- `PUBLIC_BASE_URL=https://new-zenops.example.com`
- `ALLOW_ORIGINS=https://new-zenops.example.com`

Optional temporary dual-origin window (max 7 days):
- `ALLOW_ORIGINS=https://new-zenops.example.com,https://old-zenops.example.com`

## 3) Redeploy
```bash
cd /opt/zenops/ZenOpsV2/legacy/v1
./ops/deploy_pilot_v1.sh
```

## 4) Validate Before Full DNS Propagation
Use `curl --resolve` to force host -> IP mapping:
```bash
curl -I --resolve new-zenops.example.com:80:89.116.134.199 http://new-zenops.example.com/
curl -Ik --resolve new-zenops.example.com:443:89.116.134.199 https://new-zenops.example.com/
curl -s --resolve new-zenops.example.com:80:89.116.134.199 http://new-zenops.example.com/healthz
curl -s --resolve new-zenops.example.com:80:89.116.134.199 http://new-zenops.example.com/readyz
```

## 5) Keep Old Domain Live for 7 Days
Recommended:
- Keep old DNS record active.
- Keep old host rule active in Traefik with redirect middleware to new host.
- After 7 days and no traffic on old domain, remove old DNS + redirect.

If you keep only one host rule, switch during low-traffic window and monitor 30 minutes.

## 6) Certificate Notes
- Ensure Traefik has working ACME storage (`acme.json` writable).
- Ensure CAA records allow `letsencrypt.org` if CAA is used.
- If cert issuance fails, check Traefik logs for ACME errors and DNS propagation.

## 7) Rollback
If new domain fails:
1. Restore `.env` and `.env.backend` to previous domain values.
2. Re-run `./ops/deploy_pilot_v1.sh`.
3. Confirm old host header probes return valid responses.

## 8) Quick Checklist
- DNS A record resolves to VPS IP.
- `ZENOPS_DOMAIN`, `PUBLIC_BASE_URL`, and `ALLOW_ORIGINS` are aligned.
- Traefik routes visible in `http://127.0.0.1:8088/api/http/routers`.
- Host-header checks pass on local entrypoint.
