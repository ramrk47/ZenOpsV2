import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

const cfg = {
  root: process.env.TEST_DATABASE_URL_ROOT ?? process.env.DATABASE_URL_ROOT,
  web: process.env.TEST_DATABASE_URL_WEB ?? process.env.DATABASE_URL_WEB,
  portal: process.env.TEST_DATABASE_URL_PORTAL ?? process.env.DATABASE_URL_PORTAL,
  tenantInternal: process.env.TENANT_INTERNAL_UUID ?? '11111111-1111-1111-1111-111111111111',
  tenantExternal: process.env.TENANT_EXTERNAL_UUID ?? '22222222-2222-2222-2222-222222222222'
};

const ready = Boolean(cfg.root && cfg.web && cfg.portal);

const setupFixtures = async () => {
  if (!ready) return;
  const rootClient = new Client({ connectionString: cfg.root });
  await rootClient.connect();

  const userA = randomUUID();
  const userB = randomUUID();
  const internalWorkOrderId = randomUUID();
  const externalWorkOrderId = randomUUID();
  const portalWorkOrderA = randomUUID();
  const portalWorkOrderB = randomUUID();
  const internalAssignmentId = randomUUID();
  const externalAssignmentId = randomUUID();
  const internalInvoiceId = randomUUID();
  const externalInvoiceId = randomUUID();
  const internalContactId = randomUUID();
  const externalContactId = randomUUID();
  const internalOutboxId = randomUUID();
  const externalOutboxId = randomUUID();
  const internalDocId = randomUUID();
  const portalDocA = randomUUID();
  const portalDocB = randomUUID();
  const internalBankId = randomUUID();
  const externalBankId = randomUUID();
  const portalChannelA = randomUUID();
  const portalChannelB = randomUUID();
  const portalChannelRequestA = randomUUID();
  const portalChannelRequestB = randomUUID();
  const repogenWorkOrderInternal = randomUUID();
  const repogenWorkOrderExternal = randomUUID();
  const repogenInputSnapshotInternal = randomUUID();
  const repogenOutputSnapshotInternal = randomUUID();
  const repogenInputSnapshotExternal = randomUUID();
  const repogenOutputSnapshotExternal = randomUUID();
  const repogenEvidenceInternal = randomUUID();
  const repogenEvidenceExternal = randomUUID();
  const repogenRulesRunInternal = randomUUID();
  const repogenRulesRunExternal = randomUUID();
  const repogenCommentInternal = randomUUID();
  const repogenCommentExternal = randomUUID();

  await rootClient.query(
    `INSERT INTO users (id, email, name, created_at, updated_at)
     VALUES ($1, $2, 'Portal User A', NOW(), NOW()), ($3, $4, 'Portal User B', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [userA, `a-${userA}@example.com`, userB, `b-${userB}@example.com`]
  );

  await rootClient.query(
    `INSERT INTO work_orders (id, tenant_id, portal_user_id, source, status, title, created_at, updated_at)
     VALUES
      ($1, $3, $5, 'tenant', 'submitted', 'Tenant Internal WO', NOW(), NOW()),
      ($2, $4, $5, 'tenant', 'submitted', 'Tenant External WO', NOW(), NOW()),
      ($6, $4, $7, 'external', 'submitted', 'Portal A WO', NOW(), NOW()),
      ($8, $4, $9, 'external', 'submitted', 'Portal B WO', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      internalWorkOrderId,
      externalWorkOrderId,
      cfg.tenantInternal,
      cfg.tenantExternal,
      userA,
      portalWorkOrderA,
      userA,
      portalWorkOrderB,
      userB
    ]
  );

  await rootClient.query(
    `INSERT INTO documents (id, tenant_id, owner_user_id, source, storage_key, original_filename, content_type, size_bytes, status, metadata_json, created_at, updated_at)
     VALUES
      ($1, $2, NULL, 'tenant', $3, 'internal.pdf', 'application/pdf', 1024, 'uploaded', '{}'::jsonb, NOW(), NOW()),
      ($4, $5, $6, 'portal', $7, 'portal-a.pdf', 'application/pdf', 2048, 'uploaded', '{}'::jsonb, NOW(), NOW()),
      ($8, $5, $9, 'portal', $10, 'portal-b.pdf', 'application/pdf', 2048, 'uploaded', '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      internalDocId,
      cfg.tenantInternal,
      `fixtures/${internalDocId}.pdf`,
      portalDocA,
      cfg.tenantExternal,
      userA,
      `fixtures/${portalDocA}.pdf`,
      portalDocB,
      userB,
      `fixtures/${portalDocB}.pdf`
    ]
  );

  await rootClient.query(
    `INSERT INTO banks (id, tenant_id, name, is_verified, created_at, updated_at)
     VALUES
      ($1, $3, 'Internal Bank Fixture', true, NOW(), NOW()),
      ($2, $4, 'External Bank Fixture', true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [internalBankId, externalBankId, cfg.tenantInternal, cfg.tenantExternal]
  );

  await rootClient.query(
    `INSERT INTO channels (id, tenant_id, owner_user_id, name, city, channel_type, commission_mode, commission_value, is_active, is_verified, created_at, updated_at)
     VALUES
      ($1, $3, $5, 'Portal Channel A', 'Belgaum', 'agent', 'percent', 1, true, true, NOW(), NOW()),
      ($2, $4, $6, 'Portal Channel B', 'Mudhol', 'agent', 'percent', 1, true, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [portalChannelA, portalChannelB, cfg.tenantExternal, cfg.tenantExternal, userA, userB]
  );

  await rootClient.query(
    `INSERT INTO channel_requests (id, tenant_id, channel_id, requested_by_user_id, borrower_name, phone, property_city, property_address, status, created_at, updated_at)
     VALUES
      ($1, $3, $5, $7, 'Borrower A', '+919999000001', 'Belgaum', 'Address A', 'submitted', NOW(), NOW()),
      ($2, $4, $6, $8, 'Borrower B', '+919999000002', 'Mudhol', 'Address B', 'submitted', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [portalChannelRequestA, portalChannelRequestB, cfg.tenantExternal, cfg.tenantExternal, portalChannelA, portalChannelB, userA, userB]
  );

  await rootClient.query(
    `INSERT INTO repogen_work_orders (
      id, org_id, source_type, assignment_id, report_type, bank_name, bank_type, value_slab, template_selector, status, billing_hooks_json, created_at, updated_at
    ) VALUES
      ($1, $3, 'TENANT', $5, 'VALUATION', 'Internal Repogen Bank', 'SBI', 'LT_5CR', 'SBI_FORMAT_A', 'DRAFT', '{}'::jsonb, NOW(), NOW()),
      ($2, $4, 'TENANT', $6, 'DPR', 'External Repogen Bank', 'PSU_GENERIC', 'GT_5CR', 'BOI_PSU_GENERIC', 'EVIDENCE_PENDING', '{}'::jsonb, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`,
    [repogenWorkOrderInternal, repogenWorkOrderExternal, cfg.tenantInternal, cfg.tenantExternal, internalAssignmentId, externalAssignmentId]
  );

  await rootClient.query(
    `INSERT INTO repogen_contract_snapshots (
      id, org_id, work_order_id, version, contract_json, derived_json, readiness_json, created_at
    ) VALUES
      ($1, $7, $3, 1, $9::jsonb, '{}'::jsonb, '{}'::jsonb, NOW()),
      ($2, $7, $3, 2, $10::jsonb, '{"computed_values":{"FMV":1000}}'::jsonb, '{"completeness_score":80,"missing_fields":["x"],"missing_evidence":[],"warnings":[],"required_evidence_minimums":{"valuation_photos":6}}'::jsonb, NOW()),
      ($4, $8, $5, 1, $11::jsonb, '{}'::jsonb, '{}'::jsonb, NOW()),
      ($6, $8, $5, 2, $12::jsonb, '{"computed_values":{"FMV":2000}}'::jsonb, '{"completeness_score":60,"missing_fields":[],"missing_evidence":["y"],"warnings":[],"required_evidence_minimums":{"dpr_photos_or_screenshots":4}}'::jsonb, NOW())
    ON CONFLICT (id) DO NOTHING`,
    [
      repogenInputSnapshotInternal,
      repogenOutputSnapshotInternal,
      repogenWorkOrderInternal,
      repogenInputSnapshotExternal,
      repogenWorkOrderExternal,
      repogenOutputSnapshotExternal,
      cfg.tenantInternal,
      cfg.tenantExternal,
      '{"meta":{"report_type":"VALUATION","bank_type":"SBI"}}',
      '{"meta":{"report_type":"VALUATION","bank_type":"SBI","value_slab":"LT_5CR","template_selector":"SBI_FORMAT_A"}}',
      '{"meta":{"report_type":"DPR","bank_type":"PSU_GENERIC"}}',
      '{"meta":{"report_type":"DPR","bank_type":"PSU_GENERIC","value_slab":"GT_5CR","template_selector":"BOI_PSU_GENERIC"}}'
    ]
  );

  await rootClient.query(
    `INSERT INTO repogen_evidence_items (
      id, org_id, work_order_id, evidence_type, doc_type, document_id, annexure_order, tags, created_at, updated_at
    ) VALUES
      ($1, $3, $5, 'PHOTO', 'OTHER', $7, 1, '{}'::jsonb, NOW(), NOW()),
      ($2, $4, $6, 'DOCUMENT', 'PLAN', NULL, 1, '{}'::jsonb, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`,
    [repogenEvidenceInternal, repogenEvidenceExternal, cfg.tenantInternal, cfg.tenantExternal, repogenWorkOrderInternal, repogenWorkOrderExternal, internalDocId]
  );

  await rootClient.query(
    `INSERT INTO repogen_rules_runs (
      id, org_id, work_order_id, input_snapshot_id, output_snapshot_id, ruleset_version, warnings, errors, created_at
    ) VALUES
      ($1, $3, $5, $7, $9, 'm5.4-v1', '[]'::jsonb, '[]'::jsonb, NOW()),
      ($2, $4, $6, $8, $10, 'm5.4-v1', '[]'::jsonb, '[]'::jsonb, NOW())
    ON CONFLICT (id) DO NOTHING`,
    [
      repogenRulesRunInternal,
      repogenRulesRunExternal,
      cfg.tenantInternal,
      cfg.tenantExternal,
      repogenWorkOrderInternal,
      repogenWorkOrderExternal,
      repogenInputSnapshotInternal,
      repogenInputSnapshotExternal,
      repogenOutputSnapshotInternal,
      repogenOutputSnapshotExternal
    ]
  );

  await rootClient.query(
    `INSERT INTO repogen_comments (id, org_id, work_order_id, comment_type, body, created_at)
     VALUES
      ($1, $3, $5, 'NOTES', 'Internal repogen note', NOW()),
      ($2, $4, $6, 'NOTES', 'External repogen note', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [repogenCommentInternal, repogenCommentExternal, cfg.tenantInternal, cfg.tenantExternal, repogenWorkOrderInternal, repogenWorkOrderExternal]
  );

  await rootClient.query(
    `INSERT INTO assignments (id, tenant_id, source, work_order_id, title, summary, priority, status, created_by_user_id, created_at, updated_at)
     VALUES
      ($1, $3, 'tenant', $5, 'Internal Assignment', 'Internal lane test assignment', 'normal', 'requested', $7, NOW(), NOW()),
      ($2, $4, 'external_portal', $6, 'External Assignment', 'External lane test assignment', 'high', 'requested', $7, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [internalAssignmentId, externalAssignmentId, cfg.tenantInternal, cfg.tenantExternal, internalWorkOrderId, externalWorkOrderId, userA]
  );

  await rootClient.query(
    `INSERT INTO invoices (id, tenant_id, period_start, period_end, status, currency, subtotal_paise, tax_paise, total_paise, created_at, updated_at)
     VALUES
      ($1, $3, DATE '2026-02-01', DATE '2026-03-01', 'open', 'INR', 0, 0, 0, NOW(), NOW()),
      ($2, $4, DATE '2026-02-01', DATE '2026-03-01', 'open', 'INR', 0, 0, 0, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [internalInvoiceId, externalInvoiceId, cfg.tenantInternal, cfg.tenantExternal]
  );

  await rootClient.query(
    `INSERT INTO contact_points (id, tenant_id, user_id, kind, value, is_primary, is_verified, created_at, updated_at)
     VALUES
      ($1, $3, NULL, 'email', $5, true, true, NOW(), NOW()),
      ($2, $4, NULL, 'email', $6, true, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [internalContactId, externalContactId, cfg.tenantInternal, cfg.tenantExternal, 'rls-internal@zenops.local', 'rls-external@zenops.local']
  );

  await rootClient.query(
    `INSERT INTO notification_outbox (id, tenant_id, to_contact_point_id, channel, provider, template_key, payload_json, status, idempotency_key, queued_at, created_at, updated_at)
     VALUES
      ($1, $3, $5, 'email', 'noop', 'assignment_created', '{}'::jsonb, 'queued', 'rls:internal', NOW(), NOW(), NOW()),
      ($2, $4, $6, 'email', 'noop', 'assignment_created', '{}'::jsonb, 'queued', 'rls:external', NOW(), NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [internalOutboxId, externalOutboxId, cfg.tenantInternal, cfg.tenantExternal, internalContactId, externalContactId]
  );

  await rootClient.query(
    `INSERT INTO document_links (id, tenant_id, document_id, work_order_id, purpose, created_at)
     VALUES
      ($1, $2, $3, $4, 'reference', NOW()),
      ($5, $2, $6, $7, 'reference', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [randomUUID(), cfg.tenantExternal, portalDocA, portalWorkOrderA, randomUUID(), portalDocB, portalWorkOrderB]
  );

  await rootClient.end();

  process.env.TEST_PORTAL_USER_A = userA;
  process.env.TEST_PORTAL_USER_B = userB;
  process.env.TEST_PORTAL_DOC_A = portalDocA;
  process.env.TEST_PORTAL_DOC_B = portalDocB;
  process.env.TEST_INTERNAL_ASSIGNMENT = internalAssignmentId;
  process.env.TEST_EXTERNAL_ASSIGNMENT = externalAssignmentId;
  process.env.TEST_INTERNAL_INVOICE = internalInvoiceId;
  process.env.TEST_EXTERNAL_INVOICE = externalInvoiceId;
  process.env.TEST_INTERNAL_OUTBOX = internalOutboxId;
  process.env.TEST_EXTERNAL_OUTBOX = externalOutboxId;
  process.env.TEST_INTERNAL_BANK = internalBankId;
  process.env.TEST_EXTERNAL_BANK = externalBankId;
  process.env.TEST_PORTAL_CHANNEL_REQUEST_A = portalChannelRequestA;
  process.env.TEST_PORTAL_CHANNEL_REQUEST_B = portalChannelRequestB;
};

describe('RLS integration', () => {
  beforeAll(async () => {
    if (process.env.CI && !ready) {
      throw new Error(
        'RLS integration test env is missing TEST_DATABASE_URL_ROOT/WEB/PORTAL; refusing to skip in CI.'
      );
    }
    await setupFixtures();
  });

  it.skipIf(!ready)('enforces tenant isolation for zen_web', async () => {
    const webClient = new Client({ connectionString: cfg.web });
    await webClient.connect();

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantInternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const internal = await webClient.query('SELECT tenant_id FROM work_orders');
    await webClient.query('COMMIT');

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantExternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const external = await webClient.query('SELECT tenant_id FROM work_orders');
    await webClient.query('COMMIT');

    await webClient.end();

    expect(internal.rows.every((row) => row.tenant_id === cfg.tenantInternal)).toBe(true);
    expect(external.rows.every((row) => row.tenant_id === cfg.tenantExternal)).toBe(true);
  });

  it.skipIf(!ready)('returns zero rows when tenant context is missing', async () => {
    const webClient = new Client({ connectionString: cfg.web });
    await webClient.connect();

    const noContext = await webClient.query('SELECT id FROM work_orders');
    const noContextAssignments = await webClient.query('SELECT id FROM assignments');
    const noContextInvoices = await webClient.query('SELECT id FROM invoices');
    const noContextOutbox = await webClient.query('SELECT id FROM notification_outbox');
    await webClient.end();

    expect(noContext.rows.length).toBe(0);
    expect(noContextAssignments.rows.length).toBe(0);
    expect(noContextInvoices.rows.length).toBe(0);
    expect(noContextOutbox.rows.length).toBe(0);
  });

  it.skipIf(!ready)('enforces portal user isolation', async () => {
    const portalClient = new Client({ connectionString: cfg.portal });
    await portalClient.connect();

    await portalClient.query('BEGIN');
    await portalClient.query(`SELECT set_config('app.aud', 'portal', true)`);
    await portalClient.query(`SELECT set_config('app.user_id', $1, true)`, [process.env.TEST_PORTAL_USER_A]);
    const rowsA = await portalClient.query('SELECT portal_user_id FROM work_orders');
    await portalClient.query('COMMIT');

    await portalClient.query('BEGIN');
    await portalClient.query(`SELECT set_config('app.aud', 'portal', true)`);
    await portalClient.query(`SELECT set_config('app.user_id', $1, true)`, [process.env.TEST_PORTAL_USER_B]);
    const rowsB = await portalClient.query('SELECT portal_user_id FROM work_orders');
    await portalClient.query('COMMIT');

    await portalClient.end();

    expect(rowsA.rows.every((row) => row.portal_user_id === process.env.TEST_PORTAL_USER_A)).toBe(true);
    expect(rowsB.rows.every((row) => row.portal_user_id === process.env.TEST_PORTAL_USER_B)).toBe(true);
  });

  it.skipIf(!ready)('blocks portal user A from reading portal user B documents', async () => {
    const portalClient = new Client({ connectionString: cfg.portal });
    await portalClient.connect();

    await portalClient.query('BEGIN');
    await portalClient.query(`SELECT set_config('app.aud', 'portal', true)`);
    await portalClient.query(`SELECT set_config('app.user_id', $1, true)`, [process.env.TEST_PORTAL_USER_A]);
    const canReadOwn = await portalClient.query('SELECT id FROM documents WHERE id = $1', [process.env.TEST_PORTAL_DOC_A]);
    const canReadOther = await portalClient.query('SELECT id FROM documents WHERE id = $1', [process.env.TEST_PORTAL_DOC_B]);
    await portalClient.query('COMMIT');

    await portalClient.end();

    expect(canReadOwn.rows.length).toBe(1);
    expect(canReadOther.rows.length).toBe(0);
  });

  it.skipIf(!ready)('returns zero employee rows for zen_portal', async () => {
    const portalClient = new Client({ connectionString: cfg.portal });
    await portalClient.connect();

    await portalClient.query('BEGIN');
    await portalClient.query(`SELECT set_config('app.aud', 'portal', true)`);
    await portalClient.query(`SELECT set_config('app.user_id', $1, true)`, [process.env.TEST_PORTAL_USER_A]);
    const rows = await portalClient.query('SELECT id FROM employees');
    await portalClient.query('COMMIT');

    await portalClient.end();

    expect(rows.rows.length).toBe(0);
  });

  it.skipIf(!ready)('enforces tenant isolation for documents on zen_web', async () => {
    const webClient = new Client({ connectionString: cfg.web });
    await webClient.connect();

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantInternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const internal = await webClient.query('SELECT tenant_id FROM documents');
    await webClient.query('COMMIT');

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantExternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const external = await webClient.query('SELECT tenant_id FROM documents');
    await webClient.query('COMMIT');

    await webClient.end();

    expect(internal.rows.every((row) => row.tenant_id === cfg.tenantInternal)).toBe(true);
    expect(external.rows.every((row) => row.tenant_id === cfg.tenantExternal)).toBe(true);
  });

  it.skipIf(!ready)('enforces tenant isolation for repogen_* tables on zen_web', async () => {
    const webClient = new Client({ connectionString: cfg.web });
    await webClient.connect();

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantInternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const internalWorkOrders = await webClient.query('SELECT org_id FROM repogen_work_orders');
    const internalSnapshots = await webClient.query('SELECT org_id FROM repogen_contract_snapshots');
    const internalEvidence = await webClient.query('SELECT org_id FROM repogen_evidence_items');
    const internalRulesRuns = await webClient.query('SELECT org_id FROM repogen_rules_runs');
    const internalComments = await webClient.query('SELECT org_id FROM repogen_comments');
    await webClient.query('COMMIT');

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantExternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const externalWorkOrders = await webClient.query('SELECT org_id FROM repogen_work_orders');
    const externalSnapshots = await webClient.query('SELECT org_id FROM repogen_contract_snapshots');
    const externalEvidence = await webClient.query('SELECT org_id FROM repogen_evidence_items');
    const externalRulesRuns = await webClient.query('SELECT org_id FROM repogen_rules_runs');
    const externalComments = await webClient.query('SELECT org_id FROM repogen_comments');
    await webClient.query('COMMIT');

    await webClient.end();

    expect(internalWorkOrders.rows.length).toBeGreaterThan(0);
    expect(internalSnapshots.rows.length).toBeGreaterThan(0);
    expect(internalEvidence.rows.length).toBeGreaterThan(0);
    expect(internalRulesRuns.rows.length).toBeGreaterThan(0);
    expect(internalComments.rows.length).toBeGreaterThan(0);
    expect(externalWorkOrders.rows.length).toBeGreaterThan(0);
    expect(externalSnapshots.rows.length).toBeGreaterThan(0);
    expect(externalEvidence.rows.length).toBeGreaterThan(0);
    expect(externalRulesRuns.rows.length).toBeGreaterThan(0);
    expect(externalComments.rows.length).toBeGreaterThan(0);

    expect(internalWorkOrders.rows.every((row) => row.org_id === cfg.tenantInternal)).toBe(true);
    expect(internalSnapshots.rows.every((row) => row.org_id === cfg.tenantInternal)).toBe(true);
    expect(internalEvidence.rows.every((row) => row.org_id === cfg.tenantInternal)).toBe(true);
    expect(internalRulesRuns.rows.every((row) => row.org_id === cfg.tenantInternal)).toBe(true);
    expect(internalComments.rows.every((row) => row.org_id === cfg.tenantInternal)).toBe(true);

    expect(externalWorkOrders.rows.every((row) => row.org_id === cfg.tenantExternal)).toBe(true);
    expect(externalSnapshots.rows.every((row) => row.org_id === cfg.tenantExternal)).toBe(true);
    expect(externalEvidence.rows.every((row) => row.org_id === cfg.tenantExternal)).toBe(true);
    expect(externalRulesRuns.rows.every((row) => row.org_id === cfg.tenantExternal)).toBe(true);
    expect(externalComments.rows.every((row) => row.org_id === cfg.tenantExternal)).toBe(true);
  });

  it.skipIf(!ready)('enforces tenant isolation for assignments on zen_web', async () => {
    const webClient = new Client({ connectionString: cfg.web });
    await webClient.connect();

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantInternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const internal = await webClient.query('SELECT tenant_id FROM assignments');
    await webClient.query('COMMIT');

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantExternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const external = await webClient.query('SELECT tenant_id FROM assignments');
    await webClient.query('COMMIT');

    await webClient.end();

    expect(internal.rows.every((row) => row.tenant_id === cfg.tenantInternal)).toBe(true);
    expect(external.rows.every((row) => row.tenant_id === cfg.tenantExternal)).toBe(true);
  });

  it.skipIf(!ready)('enforces tenant isolation for invoices on zen_web', async () => {
    const webClient = new Client({ connectionString: cfg.web });
    await webClient.connect();

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantInternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const internal = await webClient.query('SELECT tenant_id FROM invoices');
    await webClient.query('COMMIT');

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantExternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const external = await webClient.query('SELECT tenant_id FROM invoices');
    await webClient.query('COMMIT');

    await webClient.end();

    expect(internal.rows.length).toBeGreaterThan(0);
    expect(external.rows.length).toBeGreaterThan(0);
    expect(internal.rows.every((row) => row.tenant_id === cfg.tenantInternal)).toBe(true);
    expect(external.rows.every((row) => row.tenant_id === cfg.tenantExternal)).toBe(true);
  });

  it.skipIf(!ready)('enforces tenant isolation for notification_outbox on zen_web', async () => {
    const webClient = new Client({ connectionString: cfg.web });
    await webClient.connect();

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantInternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const internal = await webClient.query('SELECT tenant_id FROM notification_outbox');
    await webClient.query('COMMIT');

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantExternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const external = await webClient.query('SELECT tenant_id FROM notification_outbox');
    await webClient.query('COMMIT');

    await webClient.end();

    expect(internal.rows.length).toBeGreaterThan(0);
    expect(external.rows.length).toBeGreaterThan(0);
    expect(internal.rows.every((row) => row.tenant_id === cfg.tenantInternal)).toBe(true);
    expect(external.rows.every((row) => row.tenant_id === cfg.tenantExternal)).toBe(true);
  });

  it.skipIf(!ready)('blocks web tenant from reading other-tenant master data rows', async () => {
    const webClient = new Client({ connectionString: cfg.web });
    await webClient.connect();

    await webClient.query('BEGIN');
    await webClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [cfg.tenantInternal]);
    await webClient.query(`SELECT set_config('app.user_id', '', true)`);
    await webClient.query(`SELECT set_config('app.aud', 'web', true)`);
    const own = await webClient.query('SELECT id FROM banks WHERE id = $1', [process.env.TEST_INTERNAL_BANK]);
    const other = await webClient.query('SELECT id FROM banks WHERE id = $1', [process.env.TEST_EXTERNAL_BANK]);
    await webClient.query('COMMIT');

    await webClient.end();

    expect(own.rows.length).toBe(1);
    expect(other.rows.length).toBe(0);
  });

  it.skipIf(!ready)('enforces portal ownership isolation for channel_requests', async () => {
    const portalClient = new Client({ connectionString: cfg.portal });
    await portalClient.connect();

    await portalClient.query('BEGIN');
    await portalClient.query(`SELECT set_config('app.aud', 'portal', true)`);
    await portalClient.query(`SELECT set_config('app.user_id', $1, true)`, [process.env.TEST_PORTAL_USER_A]);
    const own = await portalClient.query('SELECT id FROM channel_requests WHERE id = $1', [
      process.env.TEST_PORTAL_CHANNEL_REQUEST_A
    ]);
    const other = await portalClient.query('SELECT id FROM channel_requests WHERE id = $1', [
      process.env.TEST_PORTAL_CHANNEL_REQUEST_B
    ]);
    await portalClient.query('COMMIT');

    await portalClient.end();

    expect(own.rows.length).toBe(1);
    expect(other.rows.length).toBe(0);
  });
});
