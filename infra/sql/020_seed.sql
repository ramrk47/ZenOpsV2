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
