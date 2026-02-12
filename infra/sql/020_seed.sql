INSERT INTO public.tenants (id, slug, name, lane, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'factory', 'Tenant #1 Factory', 'internal', NOW(), NOW()),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'external-lane', 'External Portal Lane', 'external', NOW(), NOW())
ON CONFLICT (id) DO UPDATE
SET slug = EXCLUDED.slug,
    name = EXCLUDED.name,
    lane = EXCLUDED.lane,
    updated_at = NOW();

INSERT INTO public.roles (id, name, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'owner', NOW(), NOW()),
  (gen_random_uuid(), 'manager', NOW(), NOW()),
  (gen_random_uuid(), 'staff', NOW(), NOW()),
  (gen_random_uuid(), 'portal_user', NOW(), NOW())
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

INSERT INTO public.billing_plans (
  id,
  tenant_id,
  code,
  name,
  currency,
  included_reports,
  unit_price_paise,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'launch-default',
    'Launch Default',
    'INR',
    10,
    150000,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '22222222-2222-2222-2222-222222222222'::uuid,
    'launch-default',
    'Launch Default',
    'INR',
    10,
    150000,
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, code) DO UPDATE
SET name = EXCLUDED.name,
    currency = EXCLUDED.currency,
    included_reports = EXCLUDED.included_reports,
    unit_price_paise = EXCLUDED.unit_price_paise,
    updated_at = NOW();

INSERT INTO public.tenant_billing (
  id,
  tenant_id,
  billing_plan_id,
  billing_email,
  currency,
  tax_rate_bps,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  seeded.tenant_id,
  bp.id,
  seeded.billing_email,
  'INR',
  0,
  NOW(),
  NOW()
FROM (
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'billing-internal@zenops.local'),
    ('22222222-2222-2222-2222-222222222222'::uuid, 'billing-external@zenops.local')
) AS seeded(tenant_id, billing_email)
JOIN public.billing_plans bp
  ON bp.tenant_id = seeded.tenant_id
 AND bp.code = 'launch-default'
ON CONFLICT (tenant_id) DO UPDATE
SET billing_plan_id = EXCLUDED.billing_plan_id,
    billing_email = EXCLUDED.billing_email,
    currency = EXCLUDED.currency,
    tax_rate_bps = EXCLUDED.tax_rate_bps,
    updated_at = NOW();

INSERT INTO public.contact_points (
  id,
  tenant_id,
  user_id,
  kind,
  value,
  is_primary,
  is_verified,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,
    'email',
    'internal-admin@zenops.local',
    true,
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '22222222-2222-2222-2222-222222222222'::uuid,
    NULL,
    'email',
    'external-ops@zenops.local',
    true,
    true,
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, kind, value) DO UPDATE
SET is_primary = EXCLUDED.is_primary,
    is_verified = EXCLUDED.is_verified,
    updated_at = NOW();

INSERT INTO public.notification_templates (
  id,
  tenant_id,
  channel,
  template_key,
  provider,
  provider_template_ref,
  schema_json,
  content_json,
  is_active,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'email',
    'assignment_created',
    'noop',
    NULL,
    '{"type":"object"}'::jsonb,
    '{"subject":"Assignment created","body":"Assignment {{assignment_id}} was created."}'::jsonb,
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'email',
    'report_draft_ready',
    'noop',
    NULL,
    '{"type":"object"}'::jsonb,
    '{"subject":"Draft ready","body":"Report {{report_request_id}} is draft ready."}'::jsonb,
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'email',
    'invoice_created',
    'noop',
    NULL,
    '{"type":"object"}'::jsonb,
    '{"subject":"Invoice updated","body":"Invoice {{invoice_id}} has a new line item."}'::jsonb,
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'email',
    'invoice_paid',
    'noop',
    NULL,
    '{"type":"object"}'::jsonb,
    '{"subject":"Invoice paid","body":"Invoice {{invoice_id}} was marked paid."}'::jsonb,
    true,
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, channel, template_key) DO UPDATE
SET provider = EXCLUDED.provider,
    provider_template_ref = EXCLUDED.provider_template_ref,
    schema_json = EXCLUDED.schema_json,
    content_json = EXCLUDED.content_json,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
