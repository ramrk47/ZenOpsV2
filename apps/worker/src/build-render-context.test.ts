import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRenderContext } from '@zenops/common';

const fixturesDir = join(__dirname, '../test/fixtures/repogen');
const sbiFixture = JSON.parse(readFileSync(join(fixturesDir, 'sbi_lb_lt5cr.json'), 'utf8'));
const boiFixture = JSON.parse(readFileSync(join(fixturesDir, 'boi_lb_gt5cr.json'), 'utf8'));
const coopFixture = JSON.parse(readFileSync(join(fixturesDir, 'coop_lb.json'), 'utf8'));

function fixtureToBundle(fixture: any) {
    return {
        assignmentId: 'test-assignment',
        templateKey: fixture.templateKey,
        bankName: fixture.bankName,
        branchName: fixture.branchName,
        reportFamily: fixture.reportFamily,
        fieldValues: fixture.fieldValues,
        evidenceLinks: fixture.evidenceLinks,
        exportHash: 'test-export-hash',
        templateHash: 'test-template-hash'
    };
}

describe('buildRenderContext', () => {
    it('computes FMV, realizable, and distress values for SBI fixture', () => {
        const ctx = buildRenderContext(fixtureToBundle(sbiFixture));
        expect(ctx.valuation.fmv).toBe(4000000);         // 2500000 + 1500000
        expect(ctx.valuation.realizableValue).toBe(3800000); // 95% of 4M
        expect(ctx.valuation.distressValue).toBe(3200000);   // 80% of 4M
        expect(ctx.isSbi).toBe(true);
        expect(ctx.isCoop).toBe(false);
    });

    it('computes depreciation percentage correctly', () => {
        const ctx = buildRenderContext(fixtureToBundle(sbiFixture));
        expect(ctx.depreciation.depreciationPct).toBeCloseTo(16.67, 1); // 10/60 * 100
    });

    it('converts sqft rates to sqm', () => {
        const ctx = buildRenderContext(fixtureToBundle(sbiFixture));
        expect(ctx.rates.marketRateSqm).toBeGreaterThan(8000); // 800 / 0.092903
        expect(ctx.rates.adoptedRateSqm).toBeGreaterThan(7000);
    });

    it('detects co-op bank and rounds to next 500', () => {
        const ctx = buildRenderContext(fixtureToBundle(coopFixture));
        expect(ctx.isCoop).toBe(true);
        expect(ctx.valuation.coopRoundedTotal).toBe(2700000); // 2700000 is already a multiple of 500
    });

    it('sets BOI flag correctly', () => {
        const ctx = buildRenderContext(fixtureToBundle(boiFixture));
        expect(ctx.isBoi).toBe(true);
        expect(ctx.isSbi).toBe(false);
        expect(ctx.valuation.fmv).toBe(60000000); // 35M + 25M
    });

    it('sorts photos in correct order (exterior → interior → surroundings → GPS)', () => {
        const ctx = buildRenderContext(fixtureToBundle(sbiFixture));
        expect(ctx.evidence.photos.length).toBe(3);
        expect(ctx.evidence.photos[0].type).toBe('exterior');
        expect(ctx.evidence.photos[1].type).toBe('interior');
        expect(ctx.evidence.photos[2].type).toBe('gps');
    });

    it('separates annexures from photos by content type', () => {
        const ctx = buildRenderContext(fixtureToBundle(sbiFixture));
        expect(ctx.evidence.annexures.length).toBe(1);
        expect(ctx.evidence.annexures[0].filename).toBe('sale_deed.pdf');
    });
});
