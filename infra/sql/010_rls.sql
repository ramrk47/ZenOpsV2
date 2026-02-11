-- Tenant-owned tables
DO $$
DECLARE
  t text;
  tables_with_deleted_at text[] := ARRAY[
    'partners',
    'work_orders',
    'assignments',
    'report_requests',
    'report_jobs',
    'report_artifacts',
    'artifact_versions',
    'report_templates',
    'template_versions',
    'plans',
    'credits_ledger'
  ];
BEGIN
  FOREACH t IN ARRAY tables_with_deleted_at
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  EXECUTE 'ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY';
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zen_web, zen_studio, zen_portal, zen_worker;

-- Baseline tenant policy for web users
DROP POLICY IF EXISTS tenant_web_select ON public.partners;
CREATE POLICY tenant_web_select ON public.partners
  FOR SELECT TO zen_web
  USING (tenant_id = app.current_tenant_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS tenant_web_modify ON public.partners;
CREATE POLICY tenant_web_modify ON public.partners
  FOR ALL TO zen_web
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'work_orders',
    'assignments',
    'report_requests',
    'report_jobs',
    'report_artifacts',
    'artifact_versions',
    'report_templates',
    'template_versions',
    'plans',
    'credits_ledger'
  ];
BEGIN
  FOREACH t IN ARRAY targets
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_web_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_web_select ON public.%I FOR SELECT TO zen_web USING (tenant_id = app.current_tenant_id() AND deleted_at IS NULL)',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_web_modify ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_web_modify ON public.%I FOR ALL TO zen_web USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS tenant_web_select ON public.audit_events;
CREATE POLICY tenant_web_select ON public.audit_events
  FOR SELECT TO zen_web
  USING (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_web_modify ON public.audit_events;
CREATE POLICY tenant_web_modify ON public.audit_events
  FOR INSERT TO zen_web
  WITH CHECK (tenant_id = app.current_tenant_id());

-- Portal isolation policy for work orders
DROP POLICY IF EXISTS portal_work_orders_select ON public.work_orders;
CREATE POLICY portal_work_orders_select ON public.work_orders
  FOR SELECT TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND portal_user_id = app.current_user_id()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS portal_work_orders_modify ON public.work_orders;
CREATE POLICY portal_work_orders_modify ON public.work_orders
  FOR ALL TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND portal_user_id = app.current_user_id()
  )
  WITH CHECK (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND portal_user_id = app.current_user_id()
  );

-- Studio read policies across tenants with aud check
DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'partners',
    'work_orders',
    'assignments',
    'report_requests',
    'report_jobs',
    'report_artifacts',
    'artifact_versions',
    'report_templates',
    'template_versions',
    'plans',
    'credits_ledger'
  ];
BEGIN
  FOREACH t IN ARRAY targets
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS studio_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY studio_read ON public.%I FOR SELECT TO zen_studio USING (current_setting(''app.aud'', true) = ''studio'' AND deleted_at IS NULL)',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS studio_read ON public.audit_events;
CREATE POLICY studio_read ON public.audit_events
  FOR SELECT TO zen_studio
  USING (current_setting('app.aud', true) = 'studio');

-- Worker policies: explicit aud with tenant context for read/write
DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'partners',
    'work_orders',
    'assignments',
    'report_requests',
    'report_jobs',
    'report_artifacts',
    'artifact_versions',
    'report_templates',
    'template_versions',
    'plans',
    'credits_ledger'
  ];
BEGIN
  FOREACH t IN ARRAY targets
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS worker_rw ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY worker_rw ON public.%I FOR ALL TO zen_worker USING (current_setting(''app.aud'', true) IN (''worker'', ''service'') AND tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS worker_rw ON public.audit_events;
CREATE POLICY worker_rw ON public.audit_events
  FOR ALL TO zen_worker
  USING (current_setting('app.aud', true) IN ('worker', 'service') AND tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

-- Enforce one active reservation per report request
CREATE UNIQUE INDEX IF NOT EXISTS credits_ledger_one_active_reservation_idx
  ON public.credits_ledger (report_request_id)
  WHERE status = 'reserved'::"CreditsLedgerStatus" AND deleted_at IS NULL;
