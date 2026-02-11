INSERT INTO public.tenants (id, slug, name, lane, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'factory', 'Tenant #1 Factory', 'internal', NOW(), NOW()),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'external-lane', 'External Portal Lane', 'external', NOW(), NOW())
ON CONFLICT (id) DO UPDATE
SET slug = EXCLUDED.slug,
    name = EXCLUDED.name,
    lane = EXCLUDED.lane,
    updated_at = NOW();

INSERT INTO public.roles (name, created_at, updated_at)
VALUES
  ('owner', NOW(), NOW()),
  ('manager', NOW(), NOW()),
  ('staff', NOW(), NOW()),
  ('portal_user', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.users (id, email, name, created_at, updated_at)
VALUES
  ('33333333-3333-3333-3333-333333333333'::uuid, 'internal-admin@zenops.local', 'Internal Admin', NOW(), NOW()),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'studio-admin@zenops.local', 'Studio Admin', NOW(), NOW())
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    name = EXCLUDED.name,
    updated_at = NOW();

INSERT INTO public.memberships (id, tenant_id, user_id, role_id, created_at, updated_at)
SELECT gen_random_uuid(),
       '11111111-1111-1111-1111-111111111111'::uuid,
       seeded.user_id,
       owner_role.id,
       NOW(),
       NOW()
FROM (
  VALUES
    ('33333333-3333-3333-3333-333333333333'::uuid),
    ('44444444-4444-4444-4444-444444444444'::uuid)
) AS seeded(user_id)
CROSS JOIN LATERAL (
  SELECT id FROM public.roles WHERE name = 'owner' LIMIT 1
) AS owner_role
ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING;
