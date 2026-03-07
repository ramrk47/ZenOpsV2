# Maulya Domain Migration

## Target Hosts
- Marketing: `https://maulya.in`
- App pilot: `https://app.maulya.in`
- Demo: `https://demo.maulya.in`

## DNS Records
- `A maulya.in -> <VPS_IP>`
- `A app.maulya.in -> <VPS_IP>`
- `A demo.maulya.in -> <VPS_IP>`

## Legacy Redirects
- `https://zenops.notalonestudios.com/*` -> `301 https://app.maulya.in/*`
- `https://demo.zenops.notalonestudios.com/*` -> `301 https://demo.maulya.in/*`

## Deploy Order
1. Create DNS records for `maulya.in`, `app.maulya.in`, and `demo.maulya.in`.
2. Refresh pilot envs with `V1_DOMAIN=app.maulya.in`.
3. Refresh demo envs with `DEMO_DOMAIN=demo.maulya.in`.
4. Deploy pilot and demo so Traefik requests certificates for the new hosts.
5. Verify old hosts return permanent redirects before announcing the cutover complete.

## Verification
```bash
curl -I https://zenops.notalonestudios.com/
curl -I https://demo.zenops.notalonestudios.com/
curl -I https://app.maulya.in/
curl -I https://demo.maulya.in/
```
