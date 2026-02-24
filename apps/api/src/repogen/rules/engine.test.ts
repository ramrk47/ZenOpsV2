import { describe, expect, it } from 'vitest';
import { RepogenContractSchema } from '@zenops/contracts';
import { computeRepogenContract, repogenRoundUpTo500, repogenSqftToSqm } from './engine.js';

const baseValuationContract = () => {
  const contract = RepogenContractSchema.parse({});
  contract.meta.report_type = 'VALUATION';
  contract.meta.bank_type = 'SBI';
  contract.party.bank_name = 'State Bank of India';
  contract.property.address = 'Fixture property';
  return contract;
};

describe('computeRepogenContract', () => {
  it('computes FMV, realizable (95%) and distress (80%)', () => {
    const contract = baseValuationContract();
    contract.valuation_inputs.land_value = 2_000_000;
    contract.valuation_inputs.building_value = 3_000_000;

    const result = computeRepogenContract(contract);

    expect(result.contract.computed_values.FMV).toBe(5_000_000);
    expect(result.contract.computed_values.realizable_value).toBe(4_750_000);
    expect(result.contract.computed_values.distress_value).toBe(4_000_000);
  });

  it('applies co-op adopted/market inversion and rounds to next 500', () => {
    const contract = RepogenContractSchema.parse({});
    contract.meta.report_type = 'VALUATION';
    contract.meta.bank_type = 'COOP';
    contract.party.bank_name = 'Co-op Bank';
    contract.property.address = 'Co-op site';
    contract.valuation_inputs.adopted_total_value_input = 12_345;

    const result = computeRepogenContract(contract);

    expect(result.contract.computed_values.coop_market_value).toBeCloseTo(15_431.25, 2);
    expect(result.contract.computed_values.rounded_to_next_500).toBe(15_500);
    expect(result.contract.meta.template_selector).toBe('COOP_GENERIC');
  });

  it('converts sqft inputs to sqm for standardized areas and rates', () => {
    const contract = baseValuationContract();
    contract.property.land_area = { value: 1076.39, unit: 'sqft' };
    contract.valuation_inputs.market_rate_input = { value: 1000, unit: 'sqft' };

    const result = computeRepogenContract(contract);

    expect(result.contract.computed_values.standardized_areas?.land_area_sqm).toBeCloseTo(100, 2);
    expect(result.contract.computed_values.standardized_rates?.market_rate_per_sqm).toBeCloseTo(10_763.9, 2);
  });

  it('selects SBI format under 5Cr and PSU generic above/equal 5Cr', () => {
    const under5 = baseValuationContract();
    under5.valuation_inputs.fmv_input = 49_999_999;
    const underResult = computeRepogenContract(under5);

    const over5 = baseValuationContract();
    over5.valuation_inputs.fmv_input = 50_000_000;
    const overResult = computeRepogenContract(over5);

    expect(underResult.contract.meta.value_slab).toBe('LT_5CR');
    expect(underResult.contract.meta.template_selector).toBe('SBI_FORMAT_A');
    expect(overResult.contract.meta.value_slab).toBe('GT_5CR');
    expect(overResult.contract.meta.template_selector).toBe('BOI_PSU_GENERIC');
  });
});

describe('repogen helpers', () => {
  it('rounds co-op totals to next 500', () => {
    expect(repogenRoundUpTo500(400)).toBe(500);
    expect(repogenRoundUpTo500(600)).toBe(1000);
    expect(repogenRoundUpTo500(1000)).toBe(1000);
  });

  it('converts sqft to sqm helper', () => {
    expect(repogenSqftToSqm(1076.39)).toBeCloseTo(100, 2);
  });
});
