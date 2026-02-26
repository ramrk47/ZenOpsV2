import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: {
        db: { url: 'postgresql://postgres:postgres@localhost:55432/zenops' }
    }
});

async function main() {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const userId = '33333333-3333-3333-3333-333333333333';
    const workOrderId = 'wrk-test-1';

    console.log('Fetching bank branch org...');
    const org = await prisma.clientOrg.findFirst({
        where: { name: { startsWith: 'SBI' } }
    });

    if (!org) throw new Error('Bank branch not found - did seed run?');

    console.log('Creating work order...');
    await prisma.workOrder.upsert({
        where: { id: workOrderId },
        update: { status: 'INITIAL_EVIDENCE_LINKING' },
        create: {
            id: workOrderId,
            tenant_id: tenantId,
            external_ref_id: 'REF-TEST-001',
            status: 'INITIAL_EVIDENCE_LINKING',
            is_cancelled: false,
            source: 'TENANT',
            title: 'Test Valuation'
        }
    });

    console.log('Creating contract...');
    await prisma.contract.create({
        data: {
            tenant_id: tenantId,
            work_order_id: workOrderId,
            contract_type: 'VALUATION',
            contract_party: 'SBI',
            property_type: 'RESIDENTIAL',
            borrower_name: 'John Doe',
            bank_branch_id: org.id
        }
    });

    console.log('Creating documents & evidence items...');

    const docs = [
        { id: 'doc-site', name: 'site.jpg', type: 'image/jpeg', size: 1000 },
        { id: 'doc-guide', name: 'guide.pdf', type: 'application/pdf', size: 2000 },
        { id: 'doc-map', name: 'map.jpg', type: 'image/jpeg', size: 1500 }
    ];

    for (const doc of docs) {
        await prisma.document.upsert({
            where: { id: doc.id },
            update: {},
            create: {
                id: doc.id,
                tenant_id: tenantId,
                file_path: `mock/${doc.name}`,
                original_filename: doc.name,
                created_by_user_id: userId,
                size_bytes: doc.size,
                mime_type: doc.type,
                status: 'AVAILABLE',
                classification: 'UNKNOWN',
                source: 'TENANT'
            }
        });
    }

    const items = [
        { id: 'ev-site', e_type: 'PHOTO', d_type: 'OTHER', tag: 'site', ann: 1, doc_id: 'doc-site' },
        { id: 'ev-guide', e_type: 'DOCUMENT', d_type: 'OTHER', tag: 'guideline', ann: 2, doc_id: 'doc-guide' },
        { id: 'ev-map', e_type: 'PHOTO', d_type: 'OTHER', tag: 'map', ann: 3, doc_id: 'doc-map' }
    ];

    for (const item of items) {
        await prisma.repogenEvidenceItem.upsert({
            where: { id: item.id },
            update: { status: 'LINKED', tags: { section_key: item.tag } },
            create: {
                id: item.id,
                tenant_id: tenantId,
                work_order_id: workOrderId,
                evidence_type: item.e_type,
                doc_type: item.d_type,
                tags: { section_key: item.tag },
                annexure_order: item.ann,
                source_type: 'TENANT',
                status: 'LINKED'
            }
        });

        await prisma.repogenEvidenceDocumentLink.upsert({
            where: { item_id_document_id: { item_id: item.id, document_id: item.doc_id } },
            update: {},
            create: {
                item_id: item.id,
                document_id: item.doc_id,
                tenant_id: tenantId,
                link_order: 1
            }
        });
    }

    console.log('Seed complete!');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
