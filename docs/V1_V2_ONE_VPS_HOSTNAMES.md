# One VPS Hostname Plan (V1 + V2 via Traefik)

## Goal
Run V1 and V2 concurrently on one VPS with non-overlapping hostnames and deterministic routing.

## Recommended Hostnames
## V2
- `zenops.notalonestudios.com` -> V2 Web
- `api-zenops.notalonestudios.com` -> V2 API
- `studio-zenops.notalonestudios.com` -> V2 Studio
- `portal-zenops.notalonestudios.com` -> V2 Portal

## V1 (legacy)
- `v1-zenops.notalonestudios.com` -> V1 frontend
- `api-v1-zenops.notalonestudios.com` -> V1 API

## Routing Principles
1. One Traefik instance owns `:80/:443`.
2. App containers do not bind public host ports directly.
3. Routers are matched by `Host(...)` rules only.
4. Keep V1 and V2 on the same proxy network; never share app DB containers.

## Minimal Traefik Label Example (Docker)
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.v2-api.rule=Host(`api-zenops.notalonestudios.com`)"
  - "traefik.http.routers.v2-api.entrypoints=websecure"
  - "traefik.http.routers.v2-api.tls.certresolver=letsencrypt"
  - "traefik.http.services.v2-api.loadbalancer.server.port=3000"
```

## Ops Validation
After deployment, confirm each hostname identity:
```bash
curl -sS https://api-zenops.notalonestudios.com/v1/meta
curl -sS https://api-v1-zenops.notalonestudios.com/v1/meta
```

Expected:
- V2 response: `"app":"zenops-v2"`
- V1 response: `"app":"zenops-v1"`
