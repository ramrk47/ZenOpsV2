import type { RepogenContract, RepogenReportType } from '@zenops/contracts';

export interface RepogenReadinessResult {
  completeness_score: number;
  missing_fields: string[];
  missing_evidence: string[];
  warnings: string[];
  required_evidence_minimums: Record<string, number>;
}

export interface RepogenEvidenceLike {
  evidence_type: 'DOCUMENT' | 'PHOTO' | 'SCREENSHOT' | 'GEO' | 'OTHER';
  doc_type?: string | null;
  tags?: Record<string, unknown> | null;
}

interface ReadinessConfig {
  requiredFields: Array<{
    key: string;
    predicate: (contract: RepogenContract) => boolean;
    message: string;
  }>;
  requiredEvidenceMinimums: Record<string, number>;
}

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const countEvidenceByKinds = (
  evidence: RepogenEvidenceLike[],
  kinds: Array<RepogenEvidenceLike['evidence_type']>
): number => evidence.filter((item) => kinds.includes(item.evidence_type)).length;

const countValuationPhotos = (evidence: RepogenEvidenceLike[]): number => {
  return evidence.filter((item) => {
    if (item.evidence_type !== 'PHOTO' && item.evidence_type !== 'GEO' && item.evidence_type !== 'SCREENSHOT') {
      return false;
    }
    return true;
  }).length;
};

const configs: Record<RepogenReportType, ReadinessConfig> = {
  VALUATION: {
    requiredFields: [
      {
        key: 'party.bank_name',
        predicate: (contract) => hasText(contract.party.bank_name) || hasText(contract.party.bank_branch_name),
        message: 'Bank name or branch name is required'
      },
      {
        key: 'property.address',
        predicate: (contract) => hasText(contract.property.address),
        message: 'Property address is required'
      },
      {
        key: 'property.land_area',
        predicate: (contract) => asNumber(contract.property.land_area?.value) !== null,
        message: 'Land area is required'
      },
      {
        key: 'valuation_inputs.rate',
        predicate: (contract) =>
          asNumber(contract.valuation_inputs.guideline_rate_per_sqm) !== null ||
          asNumber(contract.valuation_inputs.market_rate_input?.value) !== null,
        message: 'Guideline rate per sqm or market rate is required'
      }
    ],
    requiredEvidenceMinimums: {
      valuation_photos: 6
    }
  },
  DPR: {
    requiredFields: [
      {
        key: 'party.bank_name',
        predicate: (contract) => hasText(contract.party.bank_name) || hasText(contract.party.bank_branch_name),
        message: 'Bank name or branch name is required'
      },
      {
        key: 'project.summary',
        predicate: (contract) => hasText((contract.manual_fields as any)?.project_summary),
        message: 'Project summary placeholder is required'
      },
      {
        key: 'project.cost',
        predicate: (contract) => asNumber((contract.manual_fields as any)?.project_cost_total) !== null,
        message: 'Project cost placeholder is required'
      },
      {
        key: 'project.means_of_finance',
        predicate: (contract) => hasText((contract.manual_fields as any)?.means_of_finance),
        message: 'Means of finance placeholder is required'
      }
    ],
    requiredEvidenceMinimums: {
      dpr_photos_or_screenshots: 4
    }
  },
  REVALUATION: {
    requiredFields: [
      {
        key: 'party.bank_name',
        predicate: (contract) => hasText(contract.party.bank_name) || hasText(contract.party.bank_branch_name),
        message: 'Bank name or branch name is required'
      },
      {
        key: 'property.address',
        predicate: (contract) => hasText(contract.property.address),
        message: 'Property address is required'
      },
      {
        key: 'valuation_inputs.fmv_input_or_components',
        predicate: (contract) =>
          asNumber(contract.valuation_inputs.fmv_input) !== null ||
          asNumber(contract.valuation_inputs.land_value) !== null ||
          asNumber(contract.valuation_inputs.building_value) !== null,
        message: 'FMV input or land/building values are required'
      }
    ],
    requiredEvidenceMinimums: {
      revaluation_photos: 4
    }
  },
  STAGE_PROGRESS: {
    requiredFields: [
      {
        key: 'party.bank_name',
        predicate: (contract) => hasText(contract.party.bank_name) || hasText(contract.party.bank_branch_name),
        message: 'Bank name or branch name is required'
      },
      {
        key: 'property.address',
        predicate: (contract) => hasText(contract.property.address),
        message: 'Property address is required'
      },
      {
        key: 'manual_fields.stage_notes',
        predicate: (contract) => hasText((contract.manual_fields as any)?.stage_notes),
        message: 'Stage progress notes placeholder is required'
      }
    ],
    requiredEvidenceMinimums: {
      stage_progress_photos: 4
    }
  }
};

export const evaluateRepogenReadiness = (
  reportType: RepogenReportType,
  contract: RepogenContract,
  evidence: RepogenEvidenceLike[],
  warningsFromRules: string[] = []
): RepogenReadinessResult => {
  const config = configs[reportType];
  const missing_fields: string[] = [];
  const warnings = [...warningsFromRules];

  let satisfiedFieldChecks = 0;
  for (const field of config.requiredFields) {
    if (field.predicate(contract)) {
      satisfiedFieldChecks += 1;
      continue;
    }
    missing_fields.push(field.message);
  }

  const missing_evidence: string[] = [];
  let satisfiedEvidenceChecks = 0;

  for (const [key, minCount] of Object.entries(config.requiredEvidenceMinimums)) {
    let actual = 0;
    if (key === 'valuation_photos') {
      actual = countValuationPhotos(evidence);
    } else if (key === 'dpr_photos_or_screenshots') {
      actual = countEvidenceByKinds(evidence, ['PHOTO', 'SCREENSHOT']);
    } else if (key === 'revaluation_photos') {
      actual = countEvidenceByKinds(evidence, ['PHOTO', 'GEO', 'SCREENSHOT']);
    } else if (key === 'stage_progress_photos') {
      actual = countEvidenceByKinds(evidence, ['PHOTO', 'GEO']);
    }

    if (actual >= minCount) {
      satisfiedEvidenceChecks += 1;
    } else {
      missing_evidence.push(`${key}: need at least ${minCount}, found ${actual}`);
    }
  }

  if ((contract.annexures.items?.length ?? 0) === 0) {
    warnings.push('Annexure ordering metadata is empty (allowed in Phase 1 but review before render).');
  }

  const totalChecks = config.requiredFields.length + Object.keys(config.requiredEvidenceMinimums).length;
  const passedChecks = satisfiedFieldChecks + satisfiedEvidenceChecks;
  const completeness_score = totalChecks <= 0 ? 100 : Math.round((passedChecks / totalChecks) * 100);

  return {
    completeness_score,
    missing_fields,
    missing_evidence,
    warnings,
    required_evidence_minimums: config.requiredEvidenceMinimums
  };
};
