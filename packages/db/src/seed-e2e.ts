import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const ASSIGNMENT_ID = '50000000-0000-0000-0000-000000000001';
const WORK_ORDER_ID = '10000000-0000-0000-0000-000000000001';
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/tmp/zenops-artifacts';

async function main() {
    console.log('Seeding E2E Repogen Test Data...');

    // 1. Tenant
    await prisma.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: {
            id: TENANT_ID,
            slug: 'smoke-test-tenant',
            name: 'Smoke Test Tenant',
        },
    });

    // 2. Role (Ensure FACTORY_OPERATOR exists)
    const factorOpRole = await prisma.role.upsert({
        where: { name: 'FACTORY_OPERATOR' },
        update: {},
        create: { name: 'FACTORY_OPERATOR' },
    });

    // 3. User with FACTORY_OPERATOR via Membership
    await prisma.user.upsert({
        where: { id: USER_ID },
        update: {
            name: 'Smoke Tester',
        },
        create: {
            id: USER_ID,
            email: 'smoke@zenops.local',
            name: 'Smoke Tester',
            memberships: {
                create: {
                    tenantId: TENANT_ID,
                    roleId: factorOpRole.id
                }
            }
        },
    });

    // 3. Assignment
    await prisma.assignment.upsert({
        where: { id: ASSIGNMENT_ID },
        update: {
            status: 'requested',
        },
        create: {
            id: ASSIGNMENT_ID,
            tenantId: TENANT_ID,
            title: 'Chetankumar Gani Valuation',
            status: 'requested',
            stage: 'draft_created',
            createdByUserId: USER_ID,
            source: 'tenant'
        },
    });

    // 5. Work Order 
    // We explicitly set it to READY_FOR_RENDER and link the assignment
    await prisma.repogenWorkOrder.upsert({
        where: { id: WORK_ORDER_ID },
        update: {
            status: 'READY_FOR_RENDER',
            assignmentId: ASSIGNMENT_ID,
            reportType: 'VALUATION',
            bankName: 'SBI',
            bankType: 'PSU_GENERIC',
            valueSlab: 'LT_5CR',
            templateSelector: 'SBI_FORMAT_A',
            reportPackId: null // Clear any old packs so button forms
        },
        create: {
            id: WORK_ORDER_ID,
            orgId: TENANT_ID,
            sourceType: 'TENANT',
            reportType: 'VALUATION',
            bankName: 'SBI',
            bankType: 'PSU_GENERIC',
            valueSlab: 'LT_5CR',
            status: 'READY_FOR_RENDER',
            assignmentId: ASSIGNMENT_ID,
            templateSelector: 'SBI_FORMAT_A',
        },
    });

    // 5. Baseline Documents (Mocking Chetankumar Gani Samples from fixtures)
    const fixturesDir = path.resolve(__dirname, '../../../apps/worker/test/fixtures/e2e/evidence');
    const mockDir = path.join(ARTIFACTS_DIR, 'mock');

    // Ensure mock dir exists
    if (!fs.existsSync(mockDir)) {
        fs.mkdirSync(mockDir, { recursive: true });
    }

    const docs = [
        { id: 'd0000000-0000-0000-0000-000000000001', name: 'site1.png', sk: 'site' },
        { id: 'd0000000-0000-0000-0000-000000000002', name: 'guideline.pdf', sk: 'guideline' },
        { id: 'd0000000-0000-0000-0000-000000000003', name: 'map.png', sk: 'map' },
        { id: 'd0000000-0000-0000-0000-000000000004', name: 'site2.png', sk: 'site' },
    ];

    for (const doc of docs) {
        // Copy fixture to ARTIFACTS_DIR/mock
        const fixturePath = path.join(fixturesDir, doc.name);
        const destPath = path.join(mockDir, doc.name);
        if (fs.existsSync(fixturePath)) {
            fs.copyFileSync(fixturePath, destPath);
        } else {
            console.warn(`WARNING: Fixture file not found: ${fixturePath}`);
        }

        await prisma.document.upsert({
            where: { id: doc.id },
            update: {},
            create: {
                id: doc.id,
                tenantId: TENANT_ID,
                originalFilename: doc.name,
                storageKey: `mock/${doc.name}`,
                contentType: doc.name.endsWith('pdf') ? 'application/pdf' : 'image/png',
                sizeBytes: fs.existsSync(fixturePath) ? fs.statSync(fixturePath).size : 15000,
                status: 'uploaded',
                classification: 'other',
                source: 'desktop_upload',
            },
        });

        const evidenceId = doc.id.replace('d', 'e');
        await prisma.repogenEvidenceItem.upsert({
            where: { id: evidenceId },
            update: {
                tags: { section_key: doc.sk },
                annexureOrder: docs.indexOf(doc) + 1
            },
            create: {
                id: evidenceId,
                orgId: TENANT_ID,
                workOrderId: WORK_ORDER_ID,
                evidenceType: doc.name.endsWith('pdf') ? 'DOCUMENT' : 'PHOTO',
                docType: 'OTHER',
                documentId: doc.id,
                tags: { section_key: doc.sk },
                annexureOrder: docs.indexOf(doc) + 1
            },
        });
    }

    // 6. Contract Snapshot (To fulfill readiness completeness)
    await prisma.repogenContractSnapshot.create({
        data: {
            orgId: TENANT_ID,
            workOrderId: WORK_ORDER_ID,
            version: 1,
            createdByUserId: USER_ID,
            derivedJson: {
                borrower: { name: "Chetankumar Gani" },
                property: { address: "Plot No 42, ABC Layout" }
            },
            contractJson: {
                borrower_name: "Chetankumar Gani",
                property_address: "Plot No 42, ABC Layout",
                land_area_sqft: 2400
            },
            readinessJson: {}
        }
    });

    console.log('✅ Seed Complete. Work Order is READY_FOR_RENDER with 100 score.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
