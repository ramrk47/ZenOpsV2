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
  (gen_random_uuid(), 'portal_user', NOW(), NOW()),
  (gen_random_uuid(), 'super_admin', NOW(), NOW()),
  (gen_random_uuid(), 'ops_manager', NOW(), NOW()),
  (gen_random_uuid(), 'valuer', NOW(), NOW()),
  (gen_random_uuid(), 'accounts', NOW(), NOW()),
  (gen_random_uuid(), 'hr', NOW(), NOW())
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

INSERT INTO public.employees (
  id,
  tenant_id,
  user_id,
  name,
  phone,
  email,
  role,
  status,
  deleted_at,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,
    'Internal Admin',
    '+919999000001',
    'internal-admin@zenops.local',
    'admin',
    'active',
    NULL,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid,
    'Studio Finance',
    '+919999000002',
    'studio-admin@zenops.local',
    'finance',
    'active',
    NULL,
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = NOW();

INSERT INTO public.attendance_events (
  id,
  tenant_id,
  employee_id,
  kind,
  happened_at,
  meta_json,
  request_id,
  created_by_user_id,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  e.tenant_id,
  e.id,
  'checkin',
  TIMESTAMPTZ '2026-02-12T09:00:00Z',
  '{"source":"seed"}'::jsonb,
  'seed-attendance-checkin-20260212',
  '33333333-3333-3333-3333-333333333333'::uuid,
  NOW(),
  NOW()
FROM public.employees e
WHERE e.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND e.user_id = '33333333-3333-3333-3333-333333333333'::uuid
ON CONFLICT (tenant_id, request_id) DO UPDATE
SET employee_id = EXCLUDED.employee_id,
    kind = EXCLUDED.kind,
    happened_at = EXCLUDED.happened_at,
    meta_json = EXCLUDED.meta_json,
    created_by_user_id = EXCLUDED.created_by_user_id,
    updated_at = NOW();

INSERT INTO public.payroll_periods (
  id,
  tenant_id,
  month_start,
  month_end,
  status,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    DATE '2026-02-01',
    DATE '2026-02-28',
    'running',
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, month_start, month_end) DO UPDATE
SET status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO public.payroll_items (
  id,
  tenant_id,
  employee_id,
  payroll_period_id,
  kind,
  label,
  amount_paise,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  e.id,
  p.id,
  'earning',
  'Base Salary',
  12000000,
  NOW(),
  NOW()
FROM public.payroll_periods p
JOIN public.employees e
  ON e.tenant_id = p.tenant_id
WHERE p.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND p.month_start = DATE '2026-02-01'
  AND p.month_end = DATE '2026-02-28'
  AND e.user_id = '33333333-3333-3333-3333-333333333333'::uuid
  AND NOT EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    WHERE pi.tenant_id = p.tenant_id
      AND pi.payroll_period_id = p.id
      AND pi.employee_id = e.id
      AND pi.kind = 'earning'
      AND pi.label = 'Base Salary'
  );

INSERT INTO public.payroll_items (
  id,
  tenant_id,
  employee_id,
  payroll_period_id,
  kind,
  label,
  amount_paise,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  e.id,
  p.id,
  'deduction',
  'Professional Tax',
  100000,
  NOW(),
  NOW()
FROM public.payroll_periods p
JOIN public.employees e
  ON e.tenant_id = p.tenant_id
WHERE p.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND p.month_start = DATE '2026-02-01'
  AND p.month_end = DATE '2026-02-28'
  AND e.user_id = '44444444-4444-4444-4444-444444444444'::uuid
  AND NOT EXISTS (
    SELECT 1
    FROM public.payroll_items pi
    WHERE pi.tenant_id = p.tenant_id
      AND pi.payroll_period_id = p.id
      AND pi.employee_id = e.id
      AND pi.kind = 'deduction'
      AND pi.label = 'Professional Tax'
  );

INSERT INTO public.notification_target_groups (
  id,
  tenant_id,
  key,
  name,
  is_active,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'FIELD',
    'Field Team',
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'FINANCE',
    'Finance Team',
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'HR',
    'HR Team',
    true,
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, key) DO UPDATE
SET name = EXCLUDED.name,
    is_active = EXCLUDED.is_active,
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
    NULL,
    'email',
    'finance-team@zenops.local',
    true,
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    NULL,
    'whatsapp',
    '+919999000111',
    true,
    true,
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, kind, value) DO UPDATE
SET is_primary = EXCLUDED.is_primary,
    is_verified = EXCLUDED.is_verified,
    updated_at = NOW();

INSERT INTO public.notification_targets (
  id,
  tenant_id,
  group_id,
  channel,
  to_contact_point_id,
  is_active,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  tg.tenant_id,
  tg.id,
  seeded.channel::"NotificationChannel",
  cp.id,
  true,
  NOW(),
  NOW()
FROM (
  VALUES
    ('FIELD', 'whatsapp', '+919999000111'),
    ('FINANCE', 'email', 'finance-team@zenops.local'),
    ('HR', 'email', 'internal-admin@zenops.local')
) AS seeded(group_key, channel, contact_value)
JOIN public.notification_target_groups tg
  ON tg.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
 AND tg.key = seeded.group_key
JOIN public.contact_points cp
  ON cp.tenant_id = tg.tenant_id
 AND cp.kind = seeded.channel::"ContactPointKind"
 AND cp.value = seeded.contact_value
ON CONFLICT (tenant_id, group_id, channel, to_contact_point_id) DO UPDATE
SET is_active = EXCLUDED.is_active,
    updated_at = NOW();

INSERT INTO public.notification_subscriptions (
  id,
  tenant_id,
  employee_id,
  event_type,
  channel,
  is_active,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  e.tenant_id,
  e.id,
  seeded.event_type::"NotificationEventType",
  seeded.channel::"NotificationChannel",
  true,
  NOW(),
  NOW()
FROM (
  VALUES
    ('33333333-3333-3333-3333-333333333333'::uuid, 'assignment_created', 'whatsapp'),
    ('44444444-4444-4444-4444-444444444444'::uuid, 'invoice_paid', 'email')
) AS seeded(user_id, event_type, channel)
JOIN public.employees e
  ON e.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
 AND e.user_id = seeded.user_id
ON CONFLICT (tenant_id, employee_id, event_type, channel) DO UPDATE
SET is_active = EXCLUDED.is_active,
    updated_at = NOW();

INSERT INTO public.banks (
  id,
  tenant_id,
  name,
  code,
  is_verified,
  reviewed_at,
  reviewed_by_user_id,
  deleted_at,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'State Bank of India',
    'SBI',
    true,
    NOW(),
    '33333333-3333-3333-3333-333333333333'::uuid,
    NULL,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Bank of India',
    'BOI',
    true,
    NOW(),
    '33333333-3333-3333-3333-333333333333'::uuid,
    NULL,
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, name) DO UPDATE
SET code = EXCLUDED.code,
    is_verified = EXCLUDED.is_verified,
    reviewed_at = EXCLUDED.reviewed_at,
    reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = NOW();

INSERT INTO public.client_orgs (
  id,
  tenant_id,
  name,
  city,
  type,
  is_verified,
  reviewed_at,
  reviewed_by_user_id,
  deleted_at,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'SBI Belgaum Main Branch Org',
    'Belgaum',
    'bank_branch',
    true,
    NOW(),
    '33333333-3333-3333-3333-333333333333'::uuid,
    NULL,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Direct Retail Clients',
    'Belgaum',
    'direct',
    true,
    NOW(),
    '33333333-3333-3333-3333-333333333333'::uuid,
    NULL,
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, name, city) DO UPDATE
SET type = EXCLUDED.type,
    is_verified = EXCLUDED.is_verified,
    reviewed_at = EXCLUDED.reviewed_at,
    reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = NOW();

INSERT INTO public.bank_branches (
  id,
  tenant_id,
  bank_id,
  client_org_id,
  branch_name,
  city,
  state,
  ifsc,
  is_verified,
  reviewed_at,
  reviewed_by_user_id,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  b.id,
  co.id,
  seeded.branch_name,
  seeded.city,
  seeded.state,
  seeded.ifsc,
  true,
  NOW(),
  '33333333-3333-3333-3333-333333333333'::uuid,
  NULL,
  NOW(),
  NOW()
FROM (
  VALUES
    ('State Bank of India', 'SBI Belgaum Main', 'Belgaum', 'KA', 'SBIN0000123', 'SBI Belgaum Main Branch Org'),
    ('Bank of India', 'BOI Mudhol Road', 'Mudhol', 'KA', 'BKID0000456', 'Direct Retail Clients')
) AS seeded(bank_name, branch_name, city, state, ifsc, client_org_name)
JOIN public.banks b
  ON b.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
 AND b.name = seeded.bank_name
LEFT JOIN public.client_orgs co
  ON co.tenant_id = b.tenant_id
 AND co.name = seeded.client_org_name
 AND co.city = 'Belgaum'
ON CONFLICT (tenant_id, bank_id, branch_name, city) DO UPDATE
SET state = EXCLUDED.state,
    ifsc = EXCLUDED.ifsc,
    client_org_id = EXCLUDED.client_org_id,
    is_verified = EXCLUDED.is_verified,
    reviewed_at = EXCLUDED.reviewed_at,
    reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = NOW();

INSERT INTO public.branch_contacts (
  id,
  tenant_id,
  branch_id,
  name,
  phone,
  email,
  role,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  bb.tenant_id,
  bb.id,
  seeded.name,
  seeded.phone,
  seeded.email,
  seeded.role,
  NULL,
  NOW(),
  NOW()
FROM (
  VALUES
    ('SBI Belgaum Main', 'Branch Ops Desk', '+919999000911', 'ops.sbi.main@zenops.local', 'ops_manager'),
    ('SBI Belgaum Main', 'Credit Officer', '+919999000912', 'credit.sbi.main@zenops.local', 'credit')
) AS seeded(branch_name, name, phone, email, role)
JOIN public.bank_branches bb
  ON bb.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
 AND bb.branch_name = seeded.branch_name
ON CONFLICT DO NOTHING;

INSERT INTO public.contacts (
  id,
  tenant_id,
  client_org_id,
  name,
  role_label,
  phone,
  email,
  is_primary,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  co.tenant_id,
  co.id,
  seeded.name,
  seeded.role_label,
  seeded.phone,
  seeded.email,
  seeded.is_primary,
  NULL,
  NOW(),
  NOW()
FROM (
  VALUES
    ('SBI Belgaum Main Branch Org', 'Branch Manager', 'Manager', '+919999000910', 'manager.sbi@zenops.local', true),
    ('Direct Retail Clients', 'Primary Borrower Contact', 'Borrower', '+919999000920', 'borrower@zenops.local', true)
) AS seeded(client_org_name, name, role_label, phone, email, is_primary)
JOIN public.client_orgs co
  ON co.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
 AND co.name = seeded.client_org_name
ON CONFLICT DO NOTHING;

INSERT INTO public.properties (
  id,
  tenant_id,
  name,
  line_1,
  city,
  state,
  postal_code,
  latitude,
  longitude,
  deleted_at,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Plot 42, Basavan Galli',
    'Basavan Galli',
    'Belgaum',
    'KA',
    '590001',
    NULL,
    NULL,
    NULL,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Mudhol Warehouse Site',
    'Industrial Road',
    'Mudhol',
    'KA',
    '587313',
    NULL,
    NULL,
    NULL,
    NOW(),
    NOW()
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.channels (
  id,
  tenant_id,
  owner_user_id,
  name,
  city,
  channel_type,
  commission_mode,
  commission_value,
  is_active,
  is_verified,
  reviewed_at,
  reviewed_by_user_id,
  deleted_at,
  created_at,
  updated_at
)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,
    'Belgaum Channel Desk',
    'Belgaum',
    'agent'::"ChannelType",
    'percent'::"CommissionMode",
    10.0,
    true,
    true,
    NOW(),
    '33333333-3333-3333-3333-333333333333'::uuid,
    NULL,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    '22222222-2222-2222-2222-222222222222'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,
    'Mudhol External Channel',
    'Mudhol',
    'other'::"ChannelType",
    'flat'::"CommissionMode",
    1500.0,
    true,
    true,
    NOW(),
    '33333333-3333-3333-3333-333333333333'::uuid,
    NULL,
    NOW(),
    NOW()
  )
ON CONFLICT (tenant_id, name, city) DO UPDATE
SET owner_user_id = EXCLUDED.owner_user_id,
    channel_type = EXCLUDED.channel_type,
    commission_mode = EXCLUDED.commission_mode,
    commission_value = EXCLUDED.commission_value,
    is_active = EXCLUDED.is_active,
    is_verified = EXCLUDED.is_verified,
    reviewed_at = EXCLUDED.reviewed_at,
    reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = NOW();

INSERT INTO public.channel_requests (
  id,
  tenant_id,
  channel_id,
  requested_by_user_id,
  assignment_id,
  borrower_name,
  phone,
  property_city,
  property_address,
  notes,
  status,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  ch.tenant_id,
  ch.id,
  ch.owner_user_id,
  NULL,
  'Demo Borrower',
  '+919999001111',
  ch.city,
  'Near Main Road',
  'Seeded request for portal channel flow',
  'submitted'::"ChannelRequestStatus",
  NULL,
  NOW(),
  NOW()
FROM public.channels ch
WHERE ch.tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
  AND ch.name = 'Mudhol External Channel'
ON CONFLICT DO NOTHING;
