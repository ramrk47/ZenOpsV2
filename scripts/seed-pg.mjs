import pg from 'pg';

const { Client } = pg;
const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:55432/zenops'
});

async function main() {
    await client.connect();

    const tenantId = '11111111-1111-1111-1111-111111111111';
    const orgResult = await client.query(`SELECT id FROM public.client_orgs WHERE name LIKE 'SBI%' LIMIT 1`);
    if (orgResult.rows.length === 0) throw new Error('Bank branch not found');
    const orgId = orgResult.rows[0].id;

    await client.query(`
    INSERT INTO public.work_orders (
      id, tenant_id, external_ref_id, status, is_cancelled, created_at, updated_at
    ) VALUES (
      'wrk-test-1', $1, 'REF-TEST-001', 'INITIAL_EVIDENCE_LINKING', false, NOW(), NOW()
    ) ON CONFLICT (id) DO NOTHING;
  `, [tenantId]);

    await client.query(`
    INSERT INTO public.contracts (
      id, tenant_id, work_order_id, contract_type, contract_party, property_type,
      borrower_name, bank_branch_id, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1, 'wrk-test-1', 'VALUATION', 'SBI', 'RESIDENTIAL',
      'John Doe', $2, NOW(), NOW()
    ) ON CONFLICT DO NOTHING;
  `, [tenantId, orgId]);

    await client.query(`
    INSERT INTO public.repogen_evidence_items (
      id, tenant_id, work_order_id, evidence_type, doc_type, tags, annexure_order,
      source_type, status, created_at, updated_at
    ) VALUES 
      ('ev-site', $1, 'wrk-test-1', 'PHOTO', 'OTHER', '{"section_key": "site"}', 1, 'TENANT', 'LINKED', NOW(), NOW()),
      ('ev-guide', $1, 'wrk-test-1', 'DOCUMENT', 'OTHER', '{"section_key": "guideline"}', 2, 'TENANT', 'LINKED', NOW(), NOW()),
      ('ev-map', $1, 'wrk-test-1', 'PHOTO', 'OTHER', '{"section_key": "map"}', 3, 'TENANT', 'LINKED', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `, [tenantId]);

    await client.query(`
    INSERT INTO public.documents (
      id, tenant_id, file_path, original_filename, created_by_user_id,
      size_bytes, mime_type, status, classification, source, created_at, updated_at
    ) VALUES 
      ('doc-site', $1, 'mock/site.jpg', 'site.jpg', '33333333-3333-3333-3333-333333333333', 1000, 'image/jpeg', 'AVAILABLE', 'UNKNOWN', 'TENANT', NOW(), NOW()),
      ('doc-guide', $1, 'mock/guide.pdf', 'guide.pdf', '33333333-3333-3333-3333-333333333333', 2000, 'application/pdf', 'AVAILABLE', 'UNKNOWN', 'TENANT', NOW(), NOW()),
      ('doc-map', $1, 'mock/map.jpg', 'map.jpg', '33333333-3333-3333-3333-333333333333', 1500, 'image/jpeg', 'AVAILABLE', 'UNKNOWN', 'TENANT', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `, [tenantId]);

    await client.query(`
    INSERT INTO public.repogen_evidence_document_links (
      item_id, document_id, tenant_id, link_order, created_at, updated_at
    ) VALUES 
      ('ev-site', 'doc-site', $1, 1, NOW(), NOW()),
      ('ev-guide', 'doc-guide', $1, 1, NOW(), NOW()),
      ('ev-map', 'doc-map', $1, 1, NOW(), NOW())
    ON CONFLICT ON CONSTRAINT repogen_evidence_document_links_item_id_document_id_key DO NOTHING;
  `, [tenantId]);

    console.log('Seed via pg complete!');
    await client.end();
}

main().catch(console.error);
