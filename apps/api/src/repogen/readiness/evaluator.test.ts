import { describe, expect, it } from 'vitest';
import { RepogenContractSchema } from '@zenops/contracts';
import { evaluateRepogenReadiness } from './evaluator.js';

describe('evaluateRepogenReadiness', () => {
  it('detects missing valuation fields and evidence requirements', () => {
    const contract = RepogenContractSchema.parse({});
    contract.meta.report_type = 'VALUATION';
    contract.party.bank_name = 'SBI';

    const result = evaluateRepogenReadiness('VALUATION', contract, []);

    expect(result.completeness_score).toBeLessThan(100);
    expect(result.missing_fields.some((item) => item.includes('Property address'))).toBe(true);
    expect(result.missing_fields.some((item) => item.includes('Land area'))).toBe(true);
    expect(result.missing_evidence.some((item) => item.includes('valuation_photos'))).toBe(true);
  });

  it('passes valuation readiness when mandatory fields and minimum photos exist', () => {
    const contract = RepogenContractSchema.parse({});
    contract.meta.report_type = 'VALUATION';
    contract.party.bank_name = 'SBI';
    contract.property.address = 'Fixture address';
    contract.property.land_area = { value: 100, unit: 'sqm' };
    contract.valuation_inputs.guideline_rate_per_sqm = 10_000;

    const evidence = Array.from({ length: 6 }, () => ({
      evidence_type: 'PHOTO' as const,
      doc_type: null,
      tags: null
    }));

    const result = evaluateRepogenReadiness('VALUATION', contract, evidence, ['RULE_WARN: sample']);

    expect(result.completeness_score).toBe(100);
    expect(result.missing_fields).toEqual([]);
    expect(result.missing_evidence).toEqual([]);
    expect(result.warnings).toContain('RULE_WARN: sample');
  });

  it('checks DPR placeholder fields and screenshot/photo evidence', () => {
    const contract = RepogenContractSchema.parse({});
    contract.meta.report_type = 'DPR';
    contract.party.bank_name = 'BOI';
    (contract.manual_fields as Record<string, unknown>).project_summary = 'Project summary';
    (contract.manual_fields as Record<string, unknown>).project_cost_total = 5000000;

    const result = evaluateRepogenReadiness(
      'DPR',
      contract,
      [
        { evidence_type: 'PHOTO', doc_type: null, tags: null },
        { evidence_type: 'SCREENSHOT', doc_type: null, tags: null }
      ]
    );

    expect(result.missing_fields.some((item) => item.includes('Means of finance'))).toBe(true);
    expect(result.missing_evidence.some((item) => item.includes('dpr_photos_or_screenshots'))).toBe(true);
  });
});
