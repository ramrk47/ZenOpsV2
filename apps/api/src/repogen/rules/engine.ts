import type {
  RepogenBankType,
  RepogenContract,
  RepogenReportType,
  RepogenTemplateSelector,
  RepogenValueSlab
} from '@zenops/contracts';

export interface RepogenRulesWarning {
  code: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface RepogenRulesResult {
  contract: RepogenContract;
  derived: Record<string, unknown>;
  warnings: RepogenRulesWarning[];
  errors: string[];
  ruleset_version: string;
}

const SQFT_PER_SQM = 10.7639;
const FIVE_CR = 50_000_000;

const roundTo2 = (value: number): number => Number(value.toFixed(2));

const roundUpToStep = (value: number, step: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / step) * step;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const areaToSqm = (value: number, unit?: 'sqm' | 'sqft'): number => {
  if (unit === 'sqft') return roundTo2(value / SQFT_PER_SQM);
  return roundTo2(value);
};

const rateToPerSqm = (value: number, unit?: 'sqm' | 'sqft'): number => {
  if (unit === 'sqft') return roundTo2(value * SQFT_PER_SQM);
  return roundTo2(value);
};

const determineValueSlab = (candidateTotal: number | null): RepogenValueSlab => {
  if (candidateTotal === null || !Number.isFinite(candidateTotal) || candidateTotal <= 0) {
    return 'UNKNOWN';
  }
  return candidateTotal < FIVE_CR ? 'LT_5CR' : 'GT_5CR';
};

const determineTemplateSelector = (bankType: RepogenBankType | undefined, valueSlab: RepogenValueSlab): RepogenTemplateSelector => {
  if (bankType === 'COOP') return 'COOP_GENERIC';
  if (bankType === 'AGRI') return 'AGRI_GENERIC';
  if (valueSlab === 'LT_5CR') return 'SBI_FORMAT_A';
  if (valueSlab === 'GT_5CR') return 'BOI_PSU_GENERIC';
  return 'UNKNOWN';
};

export const computeRepogenContract = (
  inputContract: RepogenContract,
  rulesetVersion = 'm5.4-v1'
): RepogenRulesResult => {
  const warnings: RepogenRulesWarning[] = [];
  const errors: string[] = [];

  const contract: RepogenContract = JSON.parse(JSON.stringify(inputContract));
  contract.meta = contract.meta ?? {};
  contract.party = contract.party ?? {};
  contract.property = contract.property ?? { floors: [] };
  contract.valuation_inputs = contract.valuation_inputs ?? {};
  contract.computed_values = contract.computed_values ?? {};
  contract.annexures = contract.annexures ?? {
    items: [],
    image_grouping_default: { min_images_per_page: 2, max_images_per_page: 4 }
  };
  contract.manual_fields = contract.manual_fields ?? {};
  contract.audit = contract.audit ?? {};

  const inferredBankType: RepogenBankType | undefined = contract.party.bank_name?.toUpperCase().includes('SBI')
    ? 'SBI'
    : undefined;
  const bankType: RepogenBankType | undefined = contract.meta.bank_type ?? inferredBankType;
  const reportType = contract.meta.report_type;

  const landAreaValue = toNumber(contract.property.land_area?.value);
  const builtUpAreaValue = toNumber(contract.property.built_up_area?.value);
  const landAreaSqm =
    landAreaValue === null ? null : areaToSqm(landAreaValue, contract.property.land_area?.unit);
  const builtUpAreaSqm =
    builtUpAreaValue === null ? null : areaToSqm(builtUpAreaValue, contract.property.built_up_area?.unit);

  const guidelineRateInputVal = toNumber(contract.valuation_inputs.guideline_rate_input?.value);
  const marketRateInputVal = toNumber(contract.valuation_inputs.market_rate_input?.value);
  const adoptedRateInputVal = toNumber(contract.valuation_inputs.adopted_rate_input?.value);

  const guidelineRatePerSqm =
    toNumber(contract.valuation_inputs.guideline_rate_per_sqm) ??
    (guidelineRateInputVal === null
      ? null
      : rateToPerSqm(guidelineRateInputVal, contract.valuation_inputs.guideline_rate_input?.unit));
  const marketRatePerSqm =
    marketRateInputVal === null
      ? null
      : rateToPerSqm(marketRateInputVal, contract.valuation_inputs.market_rate_input?.unit);
  let adoptedRatePerSqm =
    adoptedRateInputVal === null
      ? null
      : rateToPerSqm(adoptedRateInputVal, contract.valuation_inputs.adopted_rate_input?.unit);

  if (guidelineRatePerSqm !== null && contract.valuation_inputs.guideline_rate_per_sqm === undefined) {
    contract.valuation_inputs.guideline_rate_per_sqm = guidelineRatePerSqm;
  }

  let coopMarketValue = toNumber(contract.valuation_inputs.market_total_value_input);
  let coopAdoptedValue = toNumber(contract.valuation_inputs.adopted_total_value_input);

  if (bankType === 'COOP') {
    if (coopAdoptedValue !== null && coopMarketValue === null) {
      coopMarketValue = roundTo2(coopAdoptedValue / 0.8);
      warnings.push({
        code: 'COOP_MARKET_INFERRED_FROM_ADOPTED',
        message: 'Computed co-op market value from adopted value using adopted = 80% of market.',
        level: 'info'
      });
    } else if (coopMarketValue !== null && coopAdoptedValue === null) {
      coopAdoptedValue = roundTo2(coopMarketValue * 0.8);
      warnings.push({
        code: 'COOP_ADOPTED_INFERRED_FROM_MARKET',
        message: 'Computed co-op adopted value from market value using adopted = 80% of market.',
        level: 'info'
      });
    }

    if (adoptedRatePerSqm !== null && marketRatePerSqm === null) {
      // Co-op inversion also applies to considered (adopted) vs market rates.
      const inferredMarketRatePerSqm = roundTo2(adoptedRatePerSqm / 0.8);
      contract.computed_values.standardized_rates = {
        ...(contract.computed_values.standardized_rates ?? {}),
        market_rate_per_sqm: inferredMarketRatePerSqm
      };
    } else if (adoptedRatePerSqm === null && marketRatePerSqm !== null) {
      adoptedRatePerSqm = roundTo2(marketRatePerSqm * 0.8);
    }
  }

  const landValue = toNumber(contract.valuation_inputs.land_value);
  const buildingValue = toNumber(contract.valuation_inputs.building_value);
  const fmvInput = toNumber(contract.valuation_inputs.fmv_input);
  const computedFmv =
    fmvInput ??
    (landValue !== null || buildingValue !== null
      ? roundTo2((landValue ?? 0) + (buildingValue ?? 0))
      : null);
  const realizable = computedFmv === null ? null : roundTo2(computedFmv * 0.95);
  const distress = computedFmv === null ? null : roundTo2(computedFmv * 0.8);

  const slabCandidate = computedFmv ?? coopAdoptedValue ?? coopMarketValue;
  const valueSlab = determineValueSlab(slabCandidate);
  const templateSelector = determineTemplateSelector(bankType, valueSlab);

  if (!contract.party.bank_name && !contract.party.bank_branch_name) {
    warnings.push({
      code: 'BANK_NAME_MISSING',
      message: 'Bank name / branch details are missing.',
      level: 'warn'
    });
  }
  if (guidelineRatePerSqm === null && marketRatePerSqm === null) {
    warnings.push({
      code: 'RATE_INPUT_MISSING',
      message: 'Neither guideline rate nor market rate is provided.',
      level: 'warn'
    });
  }
  if (marketRatePerSqm !== null && guidelineRatePerSqm !== null) {
    const ratio = guidelineRatePerSqm === 0 ? null : marketRatePerSqm / guidelineRatePerSqm;
    if (ratio !== null && (ratio > 10 || ratio < 0.1)) {
      warnings.push({
        code: 'RATE_MISMATCH_SUSPICIOUS',
        message: 'Market/guideline rate ratio looks suspicious. Check units and values.',
        level: 'warn'
      });
    }
  }
  if (contract.valuation_inputs.market_rate_input?.unit && contract.valuation_inputs.user_input_units) {
    if (contract.valuation_inputs.market_rate_input.unit !== contract.valuation_inputs.user_input_units) {
      warnings.push({
        code: 'UNIT_MISMATCH',
        message: 'user_input_units does not match market_rate_input.unit. Standardization applied in derived values.',
        level: 'info'
      });
    }
  }
  if (!contract.property.address) {
    warnings.push({
      code: 'PROPERTY_ADDRESS_MISSING',
      message: 'Property address is missing.',
      level: 'warn'
    });
  }

  contract.meta.report_type = reportType;
  contract.meta.bank_type = bankType;
  contract.meta.value_slab = valueSlab;
  contract.meta.template_selector = templateSelector;

  const roundedCoopMarket = bankType === 'COOP' && coopMarketValue !== null ? roundUpToStep(coopMarketValue, 500) : null;
  const roundedCoopAdopted = bankType === 'COOP' && coopAdoptedValue !== null ? roundUpToStep(coopAdoptedValue, 500) : null;
  const roundedToNext500 =
    roundedCoopMarket ?? roundedCoopAdopted ?? (bankType === 'COOP' && computedFmv !== null ? roundUpToStep(computedFmv, 500) : null);

  contract.computed_values = {
    ...(contract.computed_values ?? {}),
    FMV: computedFmv ?? undefined,
    realizable_value: realizable ?? undefined,
    distress_value: distress ?? undefined,
    coop_market_value: coopMarketValue ?? undefined,
    coop_adopted_value: coopAdoptedValue ?? undefined,
    rounded_to_next_500: roundedToNext500 ?? undefined,
    standardized_rates: {
      guideline_rate_per_sqm: guidelineRatePerSqm ?? undefined,
      market_rate_per_sqm:
        (contract.computed_values.standardized_rates?.market_rate_per_sqm as number | undefined) ?? marketRatePerSqm ?? undefined,
      adopted_rate_per_sqm: adoptedRatePerSqm ?? undefined
    },
    standardized_areas: {
      land_area_sqm: landAreaSqm ?? undefined,
      built_up_area_sqm: builtUpAreaSqm ?? undefined
    }
  };

  const derived: Record<string, unknown> = {
    ruleset_version: rulesetVersion,
    value_slab: valueSlab,
    template_selector: templateSelector,
    bank_type: bankType ?? 'OTHER',
    report_type: reportType ?? 'VALUATION',
    standardized: {
      area: {
        land_area_sqm: landAreaSqm,
        built_up_area_sqm: builtUpAreaSqm
      },
      rates: {
        guideline_rate_per_sqm: guidelineRatePerSqm,
        market_rate_per_sqm:
          (contract.computed_values.standardized_rates?.market_rate_per_sqm as number | undefined) ?? marketRatePerSqm,
        adopted_rate_per_sqm: adoptedRatePerSqm
      }
    },
    computed_values: {
      FMV: computedFmv,
      realizable_value: realizable,
      distress_value: distress,
      coop_market_value: coopMarketValue,
      coop_adopted_value: coopAdoptedValue,
      rounded_to_next_500: roundedToNext500
    },
    warnings
  };

  return {
    contract,
    derived,
    warnings,
    errors,
    ruleset_version: rulesetVersion
  };
};

export const repogenSqftToSqm = (valueSqft: number): number => areaToSqm(valueSqft, 'sqft');
export const repogenRateSqftToSqm = (ratePerSqft: number): number => rateToPerSqm(ratePerSqft, 'sqft');
export const repogenRoundUpTo500 = (value: number): number => roundUpToStep(value, 500);
