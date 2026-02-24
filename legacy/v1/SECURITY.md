# Security Notes (Production)

## Auth hardening

- Login is rate-limited (default 5 attempts / 10 minutes).
- Failed logins and invalid tokens are logged with request IDs.
- Password minimum length is 8 characters (enforced for admin-created and self-updated passwords).
- Password hashing uses bcrypt via Passlib.

## JWT

- Set a strong `JWT_SECRET` in `.env.backend`.
- Configure `ACCESS_TOKEN_EXPIRE_MINUTES` for production.

## CORS

- In production, `ALLOW_ORIGINS` must be explicit (no `*`).
- `ENVIRONMENT=production` disables the localhost regex.

## Operational practices

- Rotate secrets regularly.
- Keep database and OS patched.
- Use TLS via the reverse proxy configuration in `deploy/nginx.conf`.
