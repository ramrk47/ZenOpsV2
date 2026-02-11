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
      randomUUID(),
      randomUUID(),
      cfg.tenantInternal,
      cfg.tenantExternal,
      userA,
      randomUUID(),
      userA,
      randomUUID(),
      userB
    ]
  );

  await rootClient.end();

  process.env.TEST_PORTAL_USER_A = userA;
  process.env.TEST_PORTAL_USER_B = userB;
};

describe('RLS integration', () => {
  beforeAll(async () => {
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
    await webClient.end();

    expect(noContext.rows.length).toBe(0);
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
});
