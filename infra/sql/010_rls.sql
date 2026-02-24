-- Tenant-owned tables
DO $$
DECLARE
  t text;
  tables_with_deleted_at text[] := ARRAY[
    'partners',
    'work_orders',
    'assignments',
    'banks',
    'bank_branches',
    'client_orgs',
    'contacts',
    'branch_contacts',
    'properties',
    'channels',
    'channel_requests',
    'report_requests',
    'report_jobs',
    'report_artifacts',
    'artifact_versions',
    'report_templates',
    'template_versions',
    'plans',
    'credits_ledger',
    'documents',
    'employees',
    'tasks'
  ];
  tables_without_deleted_at text[] := ARRAY[
    'document_links',
    'document_tag_keys',
    'document_tag_values',
    'document_tag_map',
    'billing_plans',
    'tenant_billing',
    'usage_events',
    'invoices',
    'invoice_lines',
    'payments',
    'assignment_assignees',
    'assignment_floors',
    'assignment_tasks',
    'assignment_messages',
    'assignment_activities',
    'report_inputs',
    'report_packs',
    'report_pack_artifacts',
    'report_field_values',
    'report_evidence_links',
    'report_generation_jobs',
    'report_audit_logs',
    'extraction_runs',
    'contact_points',
    'notification_templates',
    'notification_outbox',
    'notification_attempts',
    'webhook_events',
    'attendance_events',
    'payroll_periods',
    'payroll_items',
    'notification_target_groups',
    'notification_targets',
    'notification_subscriptions',
    'assignment_sources',
    'assignment_stage_transitions',
    'assignment_signals',
    'assignment_status_history'
  ];
BEGIN
  FOREACH t IN ARRAY tables_with_deleted_at
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  FOREACH t IN ARRAY tables_without_deleted_at
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  EXECUTE 'ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY';
END $$;

-- ============================================================================
-- M5.4 Repogen Spine v1 (org_id-based RLS)
-- ============================================================================

DO $$
DECLARE
  t text;
  repogen_tables text[] := ARRAY[
    'repogen_work_orders',
    'repogen_contract_snapshots',
    'repogen_evidence_items',
    'repogen_rules_runs',
    'repogen_comments',
    'repogen_deliverable_releases'
  ];
BEGIN
  FOREACH t IN ARRAY repogen_tables
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  repogen_tables text[] := ARRAY[
    'repogen_work_orders',
    'repogen_contract_snapshots',
    'repogen_evidence_items',
    'repogen_rules_runs',
    'repogen_comments',
    'repogen_deliverable_releases'
  ];
BEGIN
  FOREACH t IN ARRAY repogen_tables
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS repogen_web_rw ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY repogen_web_rw ON public.%I FOR ALL TO zen_web USING (org_id = app.current_tenant_id()) WITH CHECK (org_id = app.current_tenant_id())',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS repogen_studio_rw ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY repogen_studio_rw ON public.%I FOR ALL TO zen_studio USING (current_setting(''app.aud'', true) = ''studio'' AND org_id = app.current_tenant_id()) WITH CHECK (current_setting(''app.aud'', true) = ''studio'' AND org_id = app.current_tenant_id())',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS repogen_worker_rw ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY repogen_worker_rw ON public.%I FOR ALL TO zen_worker USING (current_setting(''app.aud'', true) IN (''worker'', ''service'') AND org_id = app.current_tenant_id()) WITH CHECK (current_setting(''app.aud'', true) IN (''worker'', ''service'') AND org_id = app.current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- Portal users can create/view only their own channel-sourced repogen work orders.
DROP POLICY IF EXISTS repogen_portal_select ON public.repogen_work_orders;
CREATE POLICY repogen_portal_select ON public.repogen_work_orders
  FOR SELECT TO zen_portal
  USING (
    org_id = app.current_tenant_id()
    AND source_type = 'CHANNEL'::"RepogenWorkOrderSourceType"
    AND source_ref_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.channel_requests cr
      JOIN public.channels ch ON ch.id = cr.channel_id
      WHERE cr.id = repogen_work_orders.source_ref_id
        AND cr.tenant_id = repogen_work_orders.org_id
        AND ch.id = cr.channel_id
        AND ch.tenant_id = cr.tenant_id
        AND ch.owner_user_id = app.current_user_id()
        AND ch.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS repogen_portal_insert ON public.repogen_work_orders;
CREATE POLICY repogen_portal_insert ON public.repogen_work_orders
  FOR INSERT TO zen_portal
  WITH CHECK (
    org_id = app.current_tenant_id()
    AND source_type = 'CHANNEL'::"RepogenWorkOrderSourceType"
    AND source_ref_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.channel_requests cr
      JOIN public.channels ch ON ch.id = cr.channel_id
      WHERE cr.id = repogen_work_orders.source_ref_id
        AND cr.tenant_id = repogen_work_orders.org_id
        AND ch.id = cr.channel_id
        AND ch.tenant_id = cr.tenant_id
        AND ch.owner_user_id = app.current_user_id()
        AND ch.deleted_at IS NULL
    )
  );

-- ============================================================================
-- M4.7 Billing control plane + service invoicing RLS policies
-- ============================================================================

DO $$
DECLARE
  t text;
  tenant_scoped text[] := ARRAY[
    'billing_accounts',
    'billing_credit_balances',
    'billing_policies',
    'billing_subscriptions',
    'billing_subscription_events',
    'billing_credit_reservations',
    'billing_credit_ledger',
    'billing_usage_events',
    'payment_customers',
    'payment_orders',
    'payment_events',
    'invoice_payment_links',
    'service_invoice_sequences',
    'service_invoices',
    'service_invoice_items',
    'service_invoice_payments',
    'service_invoice_adjustments',
    'service_invoice_attachments',
    'service_invoice_audit_logs',
    'service_idempotency_keys'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_scoped
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

ALTER TABLE public.billing_plan_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_plan_catalog FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tenant_scoped text[] := ARRAY[
    'billing_accounts',
    'billing_credit_balances',
    'billing_policies',
    'billing_subscriptions',
    'billing_subscription_events',
    'billing_credit_reservations',
    'billing_credit_ledger',
    'billing_usage_events',
    'payment_customers',
    'payment_orders',
    'payment_events',
    'invoice_payment_links',
    'service_invoice_sequences',
    'service_invoices',
    'service_invoice_items',
    'service_invoice_payments',
    'service_invoice_adjustments',
    'service_invoice_attachments',
    'service_invoice_audit_logs',
    'service_idempotency_keys'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_scoped
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_web_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_web_select ON public.%I FOR SELECT TO zen_web USING (tenant_id = app.current_tenant_id())',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_web_modify ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_web_modify ON public.%I FOR ALL TO zen_web USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t
    );
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  portal_read_tables text[] := ARRAY[
    'billing_accounts',
    'billing_policies',
    'payment_orders',
    'invoice_payment_links',
    'service_invoices',
    'service_invoice_items',
    'service_invoice_payments',
    'service_invoice_adjustments',
    'service_invoice_attachments'
  ];
BEGIN
  FOREACH t IN ARRAY portal_read_tables
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS portal_billing_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY portal_billing_read ON public.%I FOR SELECT TO zen_portal USING (tenant_id = app.current_tenant_id())',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS portal_billing_attachments_write ON public.service_invoice_attachments;
CREATE POLICY portal_billing_attachments_write ON public.service_invoice_attachments
  FOR INSERT TO zen_portal
  WITH CHECK (tenant_id = app.current_tenant_id() AND kind = 'payment_proof'::"ServiceInvoiceAttachmentKind");

DO $$
DECLARE
  t text;
  studio_worker_tables text[] := ARRAY[
    'billing_accounts',
    'billing_credit_balances',
    'billing_policies',
    'billing_plan_catalog',
    'billing_subscriptions',
    'billing_subscription_events',
    'billing_credit_reservations',
    'billing_credit_ledger',
    'billing_usage_events',
    'payment_customers',
    'payment_orders',
    'payment_events',
    'invoice_payment_links',
    'service_invoice_sequences',
    'service_invoices',
    'service_invoice_items',
    'service_invoice_payments',
    'service_invoice_adjustments',
    'service_invoice_attachments',
    'service_invoice_audit_logs',
    'service_idempotency_keys'
  ];
BEGIN
  FOREACH t IN ARRAY studio_worker_tables
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS studio_billing_rw ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY studio_billing_rw ON public.%I FOR ALL TO zen_studio USING (current_setting(''app.aud'', true) = ''studio'') WITH CHECK (current_setting(''app.aud'', true) = ''studio'')',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS worker_billing_rw ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY worker_billing_rw ON public.%I FOR ALL TO zen_worker USING (current_setting(''app.aud'', true) IN (''worker'', ''service'')) WITH CHECK (current_setting(''app.aud'', true) IN (''worker'', ''service''))',
      t
    );
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS billing_credit_reservations_active_ref_idx
  ON public.billing_credit_reservations (account_id, ref_type, ref_id)
  WHERE status = 'active'::"CreditReservationStatus";

CREATE UNIQUE INDEX IF NOT EXISTS billing_credit_ledger_account_idempotency_idx
  ON public.billing_credit_ledger (account_id, idempotency_key);

CREATE INDEX IF NOT EXISTS billing_credit_reservations_expiry_idx
  ON public.billing_credit_reservations (status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_id_idx
  ON public.payment_events (provider, event_id);

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_idempotency_idx
  ON public.payment_orders (provider, idempotency_key);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'billing_credit_balances') THEN
    ALTER TABLE public.billing_credit_balances
      DROP CONSTRAINT IF EXISTS billing_credit_balances_invariant_check;
    ALTER TABLE public.billing_credit_balances
      ADD CONSTRAINT billing_credit_balances_invariant_check
      CHECK (
        wallet_balance >= 0
        AND reserved_balance >= 0
        AND available_balance >= 0
        AND wallet_balance - reserved_balance = available_balance
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_orders') THEN
    ALTER TABLE public.payment_orders
      DROP CONSTRAINT IF EXISTS payment_orders_amount_positive_check;
    ALTER TABLE public.payment_orders
      ADD CONSTRAINT payment_orders_amount_positive_check
      CHECK (amount > 0 AND (credits_amount IS NULL OR credits_amount >= 0));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoice_payment_links') THEN
    ALTER TABLE public.invoice_payment_links
      DROP CONSTRAINT IF EXISTS invoice_payment_links_amount_non_negative_check;
    ALTER TABLE public.invoice_payment_links
      ADD CONSTRAINT invoice_payment_links_amount_non_negative_check
      CHECK (amount >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS service_invoice_sequences_fy_idx
  ON public.service_invoice_sequences (tenant_id, account_id, financial_year);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zen_web, zen_studio, zen_portal, zen_worker;

-- Baseline tenant policy for web users
DO $$
DECLARE
  t text;
  targets_with_deleted_at text[] := ARRAY[
    'partners',
    'work_orders',
    'assignments',
    'banks',
    'bank_branches',
    'client_orgs',
    'contacts',
    'branch_contacts',
    'properties',
    'channels',
    'channel_requests',
    'report_requests',
    'report_jobs',
    'report_artifacts',
    'artifact_versions',
    'report_templates',
    'template_versions',
    'plans',
    'credits_ledger',
    'documents',
    'employees',
    'tasks'
  ];
  targets_without_deleted_at text[] := ARRAY[
    'document_links',
    'document_tag_keys',
    'document_tag_values',
    'document_tag_map',
    'billing_plans',
    'tenant_billing',
    'usage_events',
    'invoices',
    'invoice_lines',
    'payments',
    'assignment_assignees',
    'assignment_floors',
    'assignment_tasks',
    'assignment_messages',
    'assignment_activities',
    'report_inputs',
    'report_packs',
    'report_pack_artifacts',
    'report_field_values',
    'report_evidence_links',
    'report_generation_jobs',
    'report_audit_logs',
    'extraction_runs',
    'contact_points',
    'notification_templates',
    'notification_outbox',
    'notification_attempts',
    'webhook_events',
    'attendance_events',
    'payroll_periods',
    'payroll_items',
    'notification_target_groups',
    'notification_targets',
    'notification_subscriptions',
    'assignment_sources',
    'assignment_stage_transitions',
    'assignment_signals',
    'assignment_status_history'
  ];
BEGIN
  FOREACH t IN ARRAY targets_with_deleted_at
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

  FOREACH t IN ARRAY targets_without_deleted_at
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_web_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_web_select ON public.%I FOR SELECT TO zen_web USING (tenant_id = app.current_tenant_id())',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_web_modify ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_web_modify ON public.%I FOR ALL TO zen_web USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS tenant_web_select ON public.tasks;
CREATE POLICY tenant_web_select ON public.tasks
  FOR SELECT TO zen_web
  USING (
    tenant_id = app.current_tenant_id()
    AND deleted_at IS NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.roles r ON r.id = m.role_id
        WHERE m.tenant_id = tasks.tenant_id
          AND m.user_id = app.current_user_id()
          AND r.name IN ('super_admin', 'admin', 'ops_manager')
      )
      OR assigned_to_user_id = app.current_user_id()
      OR created_by_user_id = app.current_user_id()
    )
  );

DROP POLICY IF EXISTS tenant_web_modify ON public.tasks;
CREATE POLICY tenant_web_modify ON public.tasks
  FOR ALL TO zen_web
  USING (
    tenant_id = app.current_tenant_id()
    AND (
      EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.roles r ON r.id = m.role_id
        WHERE m.tenant_id = tasks.tenant_id
          AND m.user_id = app.current_user_id()
          AND r.name IN ('super_admin', 'admin', 'ops_manager')
      )
      OR assigned_to_user_id = app.current_user_id()
      OR created_by_user_id = app.current_user_id()
    )
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND (
      EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.roles r ON r.id = m.role_id
        WHERE m.tenant_id = tasks.tenant_id
          AND m.user_id = app.current_user_id()
          AND r.name IN ('super_admin', 'admin', 'ops_manager')
      )
      OR created_by_user_id = app.current_user_id()
    )
  );

DROP POLICY IF EXISTS tenant_web_select ON public.assignment_status_history;
CREATE POLICY tenant_web_select ON public.assignment_status_history
  FOR SELECT TO zen_web
  USING (
    tenant_id = app.current_tenant_id()
    AND (
      EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.roles r ON r.id = m.role_id
        WHERE m.tenant_id = assignment_status_history.tenant_id
          AND m.user_id = app.current_user_id()
          AND r.name IN ('super_admin', 'admin', 'ops_manager')
      )
      OR EXISTS (
        SELECT 1
        FROM public.assignments a
        WHERE a.id = assignment_status_history.assignment_id
          AND a.tenant_id = assignment_status_history.tenant_id
          AND a.created_by_user_id = app.current_user_id()
          AND a.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.assignment_assignees aa
        WHERE aa.assignment_id = assignment_status_history.assignment_id
          AND aa.tenant_id = assignment_status_history.tenant_id
          AND aa.user_id = app.current_user_id()
      )
    )
  );

DROP POLICY IF EXISTS tenant_web_modify ON public.assignment_status_history;
CREATE POLICY tenant_web_modify ON public.assignment_status_history
  FOR ALL TO zen_web
  USING (
    tenant_id = app.current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.memberships m
      JOIN public.roles r ON r.id = m.role_id
      WHERE m.tenant_id = assignment_status_history.tenant_id
        AND m.user_id = app.current_user_id()
        AND r.name IN ('super_admin', 'admin', 'ops_manager')
    )
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.memberships m
      JOIN public.roles r ON r.id = m.role_id
      WHERE m.tenant_id = assignment_status_history.tenant_id
        AND m.user_id = app.current_user_id()
        AND r.name IN ('super_admin', 'admin', 'ops_manager')
    )
  );

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

DROP POLICY IF EXISTS portal_documents_select ON public.documents;
CREATE POLICY portal_documents_select ON public.documents
  FOR SELECT TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND deleted_at IS NULL
    AND (
      owner_user_id = app.current_user_id()
      OR EXISTS (
        SELECT 1
        FROM public.document_links dl
        JOIN public.work_orders wo ON wo.id = dl.work_order_id
        WHERE dl.document_id = documents.id
          AND dl.tenant_id = documents.tenant_id
          AND wo.tenant_id = documents.tenant_id
          AND wo.portal_user_id = app.current_user_id()
          AND wo.deleted_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS portal_documents_modify ON public.documents;
CREATE POLICY portal_documents_modify ON public.documents
  FOR ALL TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND owner_user_id = app.current_user_id()
  )
  WITH CHECK (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND owner_user_id = app.current_user_id()
  );

DROP POLICY IF EXISTS portal_document_links_select ON public.document_links;
CREATE POLICY portal_document_links_select ON public.document_links
  FOR SELECT TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND work_order_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = document_links.work_order_id
        AND wo.tenant_id = document_links.tenant_id
        AND wo.portal_user_id = app.current_user_id()
        AND wo.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS portal_document_links_modify ON public.document_links;
CREATE POLICY portal_document_links_modify ON public.document_links
  FOR ALL TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND work_order_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = document_links.work_order_id
        AND wo.tenant_id = document_links.tenant_id
        AND wo.portal_user_id = app.current_user_id()
        AND wo.deleted_at IS NULL
    )
  )
  WITH CHECK (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND work_order_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = document_links.work_order_id
        AND wo.tenant_id = document_links.tenant_id
        AND wo.portal_user_id = app.current_user_id()
        AND wo.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.id = document_links.document_id
        AND d.tenant_id = document_links.tenant_id
        AND d.owner_user_id = app.current_user_id()
        AND d.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS portal_document_tag_keys_select ON public.document_tag_keys;
CREATE POLICY portal_document_tag_keys_select ON public.document_tag_keys
  FOR SELECT TO zen_portal
  USING (tenant_id = '22222222-2222-2222-2222-222222222222'::uuid);

DROP POLICY IF EXISTS portal_document_tag_keys_modify ON public.document_tag_keys;
CREATE POLICY portal_document_tag_keys_modify ON public.document_tag_keys
  FOR ALL TO zen_portal
  USING (tenant_id = '22222222-2222-2222-2222-222222222222'::uuid)
  WITH CHECK (tenant_id = '22222222-2222-2222-2222-222222222222'::uuid);

DROP POLICY IF EXISTS portal_document_tag_values_select ON public.document_tag_values;
CREATE POLICY portal_document_tag_values_select ON public.document_tag_values
  FOR SELECT TO zen_portal
  USING (tenant_id = '22222222-2222-2222-2222-222222222222'::uuid);

DROP POLICY IF EXISTS portal_document_tag_values_modify ON public.document_tag_values;
CREATE POLICY portal_document_tag_values_modify ON public.document_tag_values
  FOR ALL TO zen_portal
  USING (tenant_id = '22222222-2222-2222-2222-222222222222'::uuid)
  WITH CHECK (tenant_id = '22222222-2222-2222-2222-222222222222'::uuid);

DROP POLICY IF EXISTS portal_document_tag_map_select ON public.document_tag_map;
CREATE POLICY portal_document_tag_map_select ON public.document_tag_map
  FOR SELECT TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.id = document_tag_map.document_id
        AND d.tenant_id = document_tag_map.tenant_id
        AND d.deleted_at IS NULL
        AND (
          d.owner_user_id = app.current_user_id()
          OR EXISTS (
            SELECT 1
            FROM public.document_links dl
            JOIN public.work_orders wo ON wo.id = dl.work_order_id
            WHERE dl.document_id = d.id
              AND dl.tenant_id = d.tenant_id
              AND wo.tenant_id = d.tenant_id
              AND wo.portal_user_id = app.current_user_id()
              AND wo.deleted_at IS NULL
          )
        )
    )
  );

DROP POLICY IF EXISTS portal_document_tag_map_modify ON public.document_tag_map;
CREATE POLICY portal_document_tag_map_modify ON public.document_tag_map
  FOR ALL TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.id = document_tag_map.document_id
        AND d.tenant_id = document_tag_map.tenant_id
        AND d.owner_user_id = app.current_user_id()
        AND d.deleted_at IS NULL
    )
  )
  WITH CHECK (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.id = document_tag_map.document_id
        AND d.tenant_id = document_tag_map.tenant_id
        AND d.owner_user_id = app.current_user_id()
        AND d.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS portal_channels_select ON public.channels;
CREATE POLICY portal_channels_select ON public.channels
  FOR SELECT TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND owner_user_id = app.current_user_id()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS portal_channels_modify ON public.channels;
CREATE POLICY portal_channels_modify ON public.channels
  FOR ALL TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND owner_user_id = app.current_user_id()
  )
  WITH CHECK (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND owner_user_id = app.current_user_id()
  );

DROP POLICY IF EXISTS portal_channel_requests_select ON public.channel_requests;
CREATE POLICY portal_channel_requests_select ON public.channel_requests
  FOR SELECT TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.channels ch
      WHERE ch.id = channel_requests.channel_id
        AND ch.tenant_id = channel_requests.tenant_id
        AND ch.owner_user_id = app.current_user_id()
        AND ch.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS portal_channel_requests_modify ON public.channel_requests;
CREATE POLICY portal_channel_requests_modify ON public.channel_requests
  FOR ALL TO zen_portal
  USING (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND EXISTS (
      SELECT 1
      FROM public.channels ch
      WHERE ch.id = channel_requests.channel_id
        AND ch.tenant_id = channel_requests.tenant_id
        AND ch.owner_user_id = app.current_user_id()
        AND ch.deleted_at IS NULL
    )
  )
  WITH CHECK (
    tenant_id = '22222222-2222-2222-2222-222222222222'::uuid
    AND EXISTS (
      SELECT 1
      FROM public.channels ch
      WHERE ch.id = channel_requests.channel_id
        AND ch.tenant_id = channel_requests.tenant_id
        AND ch.owner_user_id = app.current_user_id()
        AND ch.deleted_at IS NULL
    )
  );

-- Studio read policies across tenants with aud check
DO $$
DECLARE
  t text;
  targets_with_deleted_at text[] := ARRAY[
    'partners',
    'work_orders',
    'assignments',
    'banks',
    'bank_branches',
    'client_orgs',
    'contacts',
    'branch_contacts',
    'properties',
    'channels',
    'channel_requests',
    'report_requests',
    'report_jobs',
    'report_artifacts',
    'artifact_versions',
    'report_templates',
    'template_versions',
    'plans',
    'credits_ledger',
    'documents',
    'employees',
    'tasks'
  ];
  targets_without_deleted_at text[] := ARRAY[
    'document_links',
    'document_tag_keys',
    'document_tag_values',
    'document_tag_map',
    'billing_plans',
    'tenant_billing',
    'usage_events',
    'invoices',
    'invoice_lines',
    'payments',
    'assignment_assignees',
    'assignment_floors',
    'assignment_tasks',
    'assignment_messages',
    'assignment_activities',
    'report_inputs',
    'report_packs',
    'report_pack_artifacts',
    'report_field_values',
    'report_evidence_links',
    'report_generation_jobs',
    'report_audit_logs',
    'extraction_runs',
    'contact_points',
    'notification_templates',
    'notification_outbox',
    'notification_attempts',
    'webhook_events',
    'attendance_events',
    'payroll_periods',
    'payroll_items',
    'notification_target_groups',
    'notification_targets',
    'notification_subscriptions',
    'assignment_sources',
    'assignment_stage_transitions',
    'assignment_signals',
    'assignment_status_history'
  ];
BEGIN
  FOREACH t IN ARRAY targets_with_deleted_at
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS studio_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY studio_read ON public.%I FOR SELECT TO zen_studio USING (current_setting(''app.aud'', true) = ''studio'' AND deleted_at IS NULL)',
      t
    );
  END LOOP;

  FOREACH t IN ARRAY targets_without_deleted_at
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS studio_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY studio_read ON public.%I FOR SELECT TO zen_studio USING (current_setting(''app.aud'', true) = ''studio'')',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS studio_read ON public.audit_events;
CREATE POLICY studio_read ON public.audit_events
  FOR SELECT TO zen_studio
  USING (current_setting('app.aud', true) = 'studio');

DROP POLICY IF EXISTS studio_billing_write_invoices ON public.invoices;
CREATE POLICY studio_billing_write_invoices ON public.invoices
  FOR UPDATE TO zen_studio
  USING (current_setting('app.aud', true) = 'studio')
  WITH CHECK (current_setting('app.aud', true) = 'studio');

DROP POLICY IF EXISTS studio_billing_write_payments ON public.payments;
CREATE POLICY studio_billing_write_payments ON public.payments
  FOR ALL TO zen_studio
  USING (current_setting('app.aud', true) = 'studio')
  WITH CHECK (current_setting('app.aud', true) = 'studio');

DROP POLICY IF EXISTS studio_notifications_write_contact_points ON public.contact_points;
CREATE POLICY studio_notifications_write_contact_points ON public.contact_points
  FOR ALL TO zen_studio
  USING (current_setting('app.aud', true) = 'studio')
  WITH CHECK (current_setting('app.aud', true) = 'studio');

DROP POLICY IF EXISTS studio_notifications_write_templates ON public.notification_templates;
CREATE POLICY studio_notifications_write_templates ON public.notification_templates
  FOR ALL TO zen_studio
  USING (current_setting('app.aud', true) = 'studio')
  WITH CHECK (current_setting('app.aud', true) = 'studio');

DROP POLICY IF EXISTS studio_notifications_write_outbox ON public.notification_outbox;
CREATE POLICY studio_notifications_write_outbox ON public.notification_outbox
  FOR ALL TO zen_studio
  USING (current_setting('app.aud', true) = 'studio')
  WITH CHECK (current_setting('app.aud', true) = 'studio');

DROP POLICY IF EXISTS studio_notifications_write_attempts ON public.notification_attempts;
CREATE POLICY studio_notifications_write_attempts ON public.notification_attempts
  FOR ALL TO zen_studio
  USING (current_setting('app.aud', true) = 'studio')
  WITH CHECK (current_setting('app.aud', true) = 'studio');

DROP POLICY IF EXISTS studio_notifications_write_webhooks ON public.webhook_events;
CREATE POLICY studio_notifications_write_webhooks ON public.webhook_events
  FOR ALL TO zen_studio
  USING (current_setting('app.aud', true) = 'studio')
  WITH CHECK (current_setting('app.aud', true) = 'studio');

-- Worker policies: explicit aud with tenant context for read/write
DO $$
DECLARE
  t text;
  targets_with_deleted_at text[] := ARRAY[
    'partners',
    'work_orders',
    'assignments',
    'banks',
    'bank_branches',
    'client_orgs',
    'contacts',
    'branch_contacts',
    'properties',
    'channels',
    'channel_requests',
    'report_requests',
    'report_jobs',
    'report_artifacts',
    'artifact_versions',
    'report_templates',
    'template_versions',
    'plans',
    'credits_ledger',
    'documents',
    'employees',
    'tasks'
  ];
  targets_without_deleted_at text[] := ARRAY[
    'document_links',
    'document_tag_keys',
    'document_tag_values',
    'document_tag_map',
    'billing_plans',
    'tenant_billing',
    'usage_events',
    'invoices',
    'invoice_lines',
    'payments',
    'assignment_assignees',
    'assignment_floors',
    'assignment_tasks',
    'assignment_messages',
    'assignment_activities',
    'report_inputs',
    'report_packs',
    'report_pack_artifacts',
    'report_field_values',
    'report_evidence_links',
    'report_generation_jobs',
    'report_audit_logs',
    'extraction_runs',
    'contact_points',
    'notification_templates',
    'notification_outbox',
    'notification_attempts',
    'webhook_events',
    'attendance_events',
    'payroll_periods',
    'payroll_items',
    'notification_target_groups',
    'notification_targets',
    'notification_subscriptions',
    'assignment_sources',
    'assignment_stage_transitions',
    'assignment_signals',
    'assignment_status_history'
  ];
BEGIN
  FOREACH t IN ARRAY targets_with_deleted_at
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS worker_rw ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY worker_rw ON public.%I FOR ALL TO zen_worker USING (current_setting(''app.aud'', true) IN (''worker'', ''service'') AND tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t
    );
  END LOOP;

  FOREACH t IN ARRAY targets_without_deleted_at
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

-- Enforce one active assignment per work_order_id (idempotent create-from-work-order)
CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_active_work_order_idx
  ON public.assignments (work_order_id)
  WHERE work_order_id IS NOT NULL AND deleted_at IS NULL;

-- Enforce finalize billing idempotency surfaces
CREATE UNIQUE INDEX IF NOT EXISTS usage_events_idempotency_idx
  ON public.usage_events (tenant_id, event_type, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS usage_events_finalize_once_idx
  ON public.usage_events (report_request_id, event_type)
  WHERE report_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_usage_once_idx
  ON public.invoice_lines (invoice_id, usage_event_id)
  WHERE usage_event_id IS NOT NULL;

-- Enforce notifications idempotency surfaces
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_tenant_idempotency_idx
  ON public.notification_outbox (tenant_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_event_idx
  ON public.webhook_events (provider, provider_event_id);

-- Enforce one flag-style tag entry per (document,key) when value is null
CREATE UNIQUE INDEX IF NOT EXISTS document_tag_map_one_flag_value_idx
  ON public.document_tag_map (document_id, key_id)
  WHERE value_id IS NULL;

CREATE INDEX IF NOT EXISTS documents_tenant_classification_created_idx
  ON public.documents (tenant_id, classification, created_at DESC);

CREATE INDEX IF NOT EXISTS document_links_employee_id_idx
  ON public.document_links (employee_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'document_links_one_target_check'
      AND conrelid = 'public.document_links'::regclass
  ) THEN
    ALTER TABLE public.document_links DROP CONSTRAINT document_links_one_target_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'document_links_one_target_check'
  ) THEN
    ALTER TABLE public.document_links
      ADD CONSTRAINT document_links_one_target_check
      CHECK (num_nonnulls(work_order_id, assignment_id, report_request_id, employee_id) >= 1);
  END IF;
END $$;
