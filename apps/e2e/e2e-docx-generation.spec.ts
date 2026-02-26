import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/tmp/zenops-artifacts';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// User and Tenant IDs must match the seed-e2e.ts
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const WORK_ORDER_ID = '10000000-0000-0000-0000-000000000001';

// Generate a valid dev JWT for our seeded user
const generateToken = () => {
    return jwt.sign(
        {
            sub: 'e2e-test',
            tenant_id: TENANT_ID,
            user_id: USER_ID,
            aud: 'web',
            roles: ['admin', 'factory_ops'],
            capabilities: ['*']
        },
        JWT_SECRET,
        { expiresIn: '1h' }
    );
};

test.describe('End-to-End DOCX Generation Pipeline', () => {

    test('should trigger DOCX generation and verify artifacts', async ({ page, request }) => {
        test.setTimeout(120000); // Allow 2 minutes for full pipeline (OCR + generation)

        const token = generateToken();

        console.log('1. Navigating to /repogen...');
        await page.goto('http://localhost:5173/repogen', { waitUntil: 'networkidle' });

        console.log('2. Supplying JWT...');
        const tokenInput = await page.$('input[placeholder*="token"]');
        if (tokenInput) {
            await tokenInput.fill(token);
        }

        console.log('3. Clicking Refresh...');
        const refreshBtn = await page.getByRole('button', { name: 'Refresh', exact: true });
        if (refreshBtn) {
            await refreshBtn.click();
            await page.waitForTimeout(2000);
        }

        console.log('4. Selecting Work Order...');
        // Find the work order card. We know it says "Chetankumar Gani" or "SBI"
        const workOrderRow = page.locator(`button:has-text("SBI")`).first();
        await expect(workOrderRow).toBeVisible();
        await workOrderRow.click();

        console.log('5. Navigating to Pack & Release tab...');
        const packTabBtn = page.locator('button:has-text("Pack & Release")').first();
        await packTabBtn.click();

        console.log('6. Clicking Create Pack...');
        const createPackBtn = page.getByRole('button', { name: 'Create Pack' });
        await expect(createPackBtn).toBeEnabled();
        await createPackBtn.click();

        console.log('7. Waiting for pack generation (polling API)...');
        let packId: string | null = null;
        let isComplete = false;

        // Poll for work order to update with a reportPackId and then wait for completion
        const maxRetries = 30; // 30 * 2000ms = 60s
        for (let i = 0; i < maxRetries; i++) {
            const woResponse = await request.get(`http://localhost:3000/v1/repogen/work-orders/${WORK_ORDER_ID}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (woResponse.ok()) {
                const data = await woResponse.json();
                const currentPackId = data.work_order?.report_pack_id;

                if (currentPackId) {
                    packId = currentPackId;

                    // Now check the pack status
                    const packResponse = await request.get(`http://localhost:3000/v1/repogen/packs/${packId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (packResponse.ok()) {
                        const packData = await packResponse.json();
                        if (packData.pack?.status === 'COMPLETED' || packData.pack?.status === 'ready') {
                            isComplete = true;
                            break;
                        }
                    }
                }
            }
            // wait and check again
            await page.waitForTimeout(2000);
        }

        expect(isComplete).toBeTruthy();
        expect(packId).not.toBeNull();

        console.log(`Pack ID ${packId} generated successfully.`);

        console.log('8. Verifying ZIP contents...');
        const generatedZipName = `${WORK_ORDER_ID}_${packId}.zip`;
        const generatedZipPath = path.join(ARTIFACTS_DIR, 'packs', generatedZipName);

        // Ensure that ZIP file exists
        expect(fs.existsSync(generatedZipPath)).toBe(true);
        console.log(`✅ ZIP Artifact found at: ${generatedZipPath}`);

        const stats = fs.statSync(generatedZipPath);
        expect(stats.size).toBeGreaterThan(10000); // At least 10KB
        console.log(`✅ ZIP file size: ${stats.size} bytes`);

        // Use adm-zip to inspect contents
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(generatedZipPath);
        const zipEntries = zip.getEntries();
        const fileNames = zipEntries.map((e: any) => e.entryName);

        console.log('Files in ZIP:', fileNames);

        expect(fileNames).toContain('meta.json');
        expect(fileNames).toContain('report.docx');

        const enablePdfConv = process.env.ENABLE_PDF_CONVERSION === '1';
        if (enablePdfConv) {
            console.log('PDF conversion enabled, checking for report.pdf...');
            expect(fileNames).toContain('report.pdf');
        } else {
            console.log('PDF conversion strictly disabled or not required, skipping report.pdf check.');
        }

        console.log('✅ End-to-End Test Completed Successfully.');
    });
});
