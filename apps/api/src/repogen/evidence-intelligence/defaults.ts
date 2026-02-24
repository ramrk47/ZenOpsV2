import { Prisma, type TxClient } from '@zenops/db';

type FieldDefSeed = {
  field_key: string;
  label: string;
  data_type: string;
  required_by_default: boolean;
  unit?: string | null;
  metadata_json?: Record<string, unknown>;
};

type ProfileItemSeed = {
  evidence_type: 'DOCUMENT' | 'PHOTO' | 'SCREENSHOT' | 'GEO' | 'OTHER';
  doc_type?: string;
  min_count: number;
  is_required: boolean;
  tags_json?: Record<string, unknown> | null;
  order_hint?: number | null;
  label?: string | null;
  field_key_hint?: string | null;
};

type ProfileSeed = {
  report_type: 'VALUATION' | 'DPR' | 'REVALUATION' | 'STAGE_PROGRESS';
  bank_type: 'SBI' | 'PSU_GENERIC' | 'COOP' | 'AGRI' | 'OTHER';
  value_slab: 'LT_5CR' | 'GT_5CR' | 'UNKNOWN';
  name: string;
  is_default: boolean;
  metadata_json?: Record<string, unknown>;
  items: ProfileItemSeed[];
};

const FIELD_DEF_SEEDS: FieldDefSeed[] = [
  { field_key: 'party.bank_name', label: 'Bank Name', data_type: 'text', required_by_default: true },
  { field_key: 'party.bank_branch_name', label: 'Bank Branch', data_type: 'text', required_by_default: false },
  { field_key: 'property.address', label: 'Property Address', data_type: 'text', required_by_default: true },
  { field_key: 'property.land_area', label: 'Land Area', data_type: 'unit_number', required_by_default: true, unit: 'sqm' },
  { field_key: 'property.built_up_area', label: 'Built-up Area', data_type: 'unit_number', required_by_default: false, unit: 'sqm' },
  { field_key: 'valuation_inputs.guideline_rate_per_sqm', label: 'Guideline Rate / sqm', data_type: 'number', required_by_default: false, unit: 'sqm' },
  { field_key: 'valuation_inputs.market_rate_input', label: 'Market Rate Input', data_type: 'unit_number', required_by_default: false },
  { field_key: 'valuation_inputs.rate', label: 'Valuation Rate Input', data_type: 'number', required_by_default: true },
  { field_key: 'valuation_inputs.land_value', label: 'Land Value', data_type: 'number', required_by_default: false },
  { field_key: 'valuation_inputs.building_value', label: 'Building Value', data_type: 'number', required_by_default: false },
  { field_key: 'manual_fields.project_summary', label: 'Project Summary', data_type: 'text', required_by_default: false },
  { field_key: 'manual_fields.project_cost_total', label: 'Project Cost Total', data_type: 'number', required_by_default: false },
  { field_key: 'manual_fields.means_of_finance', label: 'Means of Finance', data_type: 'text', required_by_default: false },
  { field_key: 'manual_fields.stage_notes', label: 'Stage Notes', data_type: 'text', required_by_default: false },
  { field_key: 'manual_fields.justification_text', label: 'Justification', data_type: 'text', required_by_default: false }
];

const valuationDocs: ProfileItemSeed[] = [
  { evidence_type: 'DOCUMENT', doc_type: 'SALE_DEED', min_count: 1, is_required: true, order_hint: 10, label: 'Sale Deed', field_key_hint: 'property.address' },
  { evidence_type: 'DOCUMENT', doc_type: 'RTC', min_count: 1, is_required: true, order_hint: 20, label: 'RTC / Ownership Extract', field_key_hint: 'property.address' },
  { evidence_type: 'DOCUMENT', doc_type: 'EC', min_count: 1, is_required: true, order_hint: 30, label: 'Encumbrance Certificate', field_key_hint: 'property.address' },
  { evidence_type: 'DOCUMENT', doc_type: 'KHATA', min_count: 1, is_required: true, order_hint: 40, label: 'Khata / Assessment', field_key_hint: 'property.address' },
  { evidence_type: 'DOCUMENT', doc_type: 'TAX', min_count: 1, is_required: true, order_hint: 50, label: 'Tax Receipt', field_key_hint: 'property.address' },
  { evidence_type: 'DOCUMENT', doc_type: 'PLAN', min_count: 1, is_required: true, order_hint: 60, label: 'Plan / Approval Drawing', field_key_hint: 'property.built_up_area' }
];

const valuationPhotos: ProfileItemSeed[] = [
  { evidence_type: 'PHOTO', min_count: 2, is_required: true, tags_json: { category: 'exterior' }, order_hint: 100, label: 'Exterior Photos', field_key_hint: 'property.address' },
  { evidence_type: 'PHOTO', min_count: 2, is_required: true, tags_json: { category: 'interior' }, order_hint: 110, label: 'Interior Photos', field_key_hint: 'property.built_up_area' },
  { evidence_type: 'PHOTO', min_count: 1, is_required: true, tags_json: { category: 'surroundings' }, order_hint: 120, label: 'Surroundings Photo', field_key_hint: 'property.address' },
  { evidence_type: 'GEO', min_count: 1, is_required: true, tags_json: { category: 'gps' }, order_hint: 130, label: 'GPS Photo', field_key_hint: 'property.address' },
  { evidence_type: 'SCREENSHOT', min_count: 1, is_required: true, tags_json: { category: 'google_map' }, order_hint: 140, label: 'Google Map Screenshot', field_key_hint: 'property.address' },
  { evidence_type: 'SCREENSHOT', min_count: 1, is_required: true, tags_json: { category: 'route_map' }, order_hint: 150, label: 'Route Map Screenshot', field_key_hint: 'property.address' }
];

const PROFILE_SEEDS: ProfileSeed[] = [
  {
    report_type: 'VALUATION',
    bank_type: 'SBI',
    value_slab: 'LT_5CR',
    name: 'Valuation SBI <5Cr Baseline',
    is_default: true,
    items: [...valuationDocs, ...valuationPhotos]
  },
  {
    report_type: 'VALUATION',
    bank_type: 'PSU_GENERIC',
    value_slab: 'GT_5CR',
    name: 'Valuation PSU >5Cr Baseline',
    is_default: true,
    items: [...valuationDocs, ...valuationPhotos]
  },
  {
    report_type: 'VALUATION',
    bank_type: 'COOP',
    value_slab: 'UNKNOWN',
    name: 'Valuation Co-op Baseline',
    is_default: true,
    metadata_json: { notes: ['Co-op adopted/market inversion applies', 'Round-up to next 500 review'] },
    items: [
      ...valuationDocs,
      ...valuationPhotos,
      {
        evidence_type: 'OTHER',
        doc_type: 'OTHER',
        min_count: 1,
        is_required: false,
        tags_json: { kind: 'checklist', checklist_key: 'coop_rounding_review' },
        order_hint: 200,
        label: 'Co-op Rounding Checklist (metadata only)',
        field_key_hint: 'valuation_inputs.market_rate_input'
      }
    ]
  },
  {
    report_type: 'VALUATION',
    bank_type: 'AGRI',
    value_slab: 'UNKNOWN',
    name: 'Valuation Agri Baseline',
    is_default: true,
    metadata_json: { agri_format_profile: true },
    items: [
      { evidence_type: 'DOCUMENT', doc_type: 'SALE_DEED', min_count: 1, is_required: true, order_hint: 10, label: 'Sale Deed / Title', field_key_hint: 'property.address' },
      { evidence_type: 'DOCUMENT', doc_type: 'RTC', min_count: 1, is_required: true, order_hint: 20, label: 'RTC / Land Record', field_key_hint: 'property.address' },
      { evidence_type: 'PHOTO', min_count: 4, is_required: true, tags_json: { category: 'site' }, order_hint: 100, label: 'Site Photos', field_key_hint: 'property.address' },
      { evidence_type: 'GEO', min_count: 1, is_required: true, tags_json: { category: 'gps' }, order_hint: 110, label: 'GPS Photo', field_key_hint: 'property.address' }
    ]
  },
  {
    report_type: 'REVALUATION',
    bank_type: 'OTHER',
    value_slab: 'UNKNOWN',
    name: 'Revaluation Baseline',
    is_default: true,
    items: [...valuationDocs.slice(0, 4), ...valuationPhotos.slice(0, 4)]
  },
  {
    report_type: 'DPR',
    bank_type: 'OTHER',
    value_slab: 'UNKNOWN',
    name: 'DPR Baseline',
    is_default: true,
    items: [
      { evidence_type: 'DOCUMENT', doc_type: 'PLAN', min_count: 1, is_required: true, order_hint: 10, label: 'Plan / Layout', field_key_hint: 'manual_fields.project_summary' },
      { evidence_type: 'DOCUMENT', doc_type: 'BANK_LETTER', min_count: 1, is_required: true, order_hint: 20, label: 'Bank Letter', field_key_hint: 'party.bank_name' },
      { evidence_type: 'PHOTO', min_count: 2, is_required: true, tags_json: { category: 'site' }, order_hint: 100, label: 'Site Photos', field_key_hint: 'manual_fields.project_summary' },
      { evidence_type: 'SCREENSHOT', min_count: 2, is_required: true, tags_json: { category: 'dpr_reference' }, order_hint: 110, label: 'Reference Screenshots', field_key_hint: 'manual_fields.project_cost_total' }
    ]
  },
  {
    report_type: 'STAGE_PROGRESS',
    bank_type: 'OTHER',
    value_slab: 'UNKNOWN',
    name: 'Stage Progress Baseline',
    is_default: true,
    items: [
      { evidence_type: 'PHOTO', min_count: 4, is_required: true, tags_json: { category: 'stage_progress' }, order_hint: 100, label: 'Stage Progress Photos', field_key_hint: 'manual_fields.stage_notes' },
      { evidence_type: 'GEO', min_count: 1, is_required: false, tags_json: { category: 'gps' }, order_hint: 110, label: 'GPS Photo', field_key_hint: 'property.address' }
    ]
  }
];

export const ensureRepogenEvidenceIntelDefaults = async (tx: TxClient, orgId: string): Promise<void> => {
  const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

  const existingFieldDefs = await tx.repogenFieldDef.findMany({
    where: { orgId },
    select: { fieldKey: true }
  });
  const existingFieldKeys = new Set(existingFieldDefs.map((row) => row.fieldKey));

  for (const seed of FIELD_DEF_SEEDS) {
    if (existingFieldKeys.has(seed.field_key)) {
      continue;
    }
    await tx.repogenFieldDef.create({
      data: {
        orgId,
        fieldKey: seed.field_key,
        label: seed.label,
        dataType: seed.data_type,
        requiredByDefault: seed.required_by_default,
        unit: seed.unit ?? null,
        metadataJson: asJson(seed.metadata_json ?? {})
      }
    });
  }

  for (const profileSeed of PROFILE_SEEDS) {
    let profile = await tx.repogenEvidenceProfile.findFirst({
      where: {
        orgId,
        reportType: profileSeed.report_type,
        bankType: profileSeed.bank_type,
        valueSlab: profileSeed.value_slab,
        name: profileSeed.name
      },
      select: { id: true }
    });

    if (!profile) {
      profile = await tx.repogenEvidenceProfile.create({
        data: {
          orgId,
          reportType: profileSeed.report_type,
          bankType: profileSeed.bank_type,
          valueSlab: profileSeed.value_slab,
          name: profileSeed.name,
          isDefault: profileSeed.is_default,
          metadataJson: asJson(profileSeed.metadata_json ?? {})
        },
        select: { id: true }
      });
    }

    const existingItems = await tx.repogenEvidenceProfileItem.findMany({
      where: { profileId: profile.id },
      select: { id: true }
    });
    if (existingItems.length > 0) {
      continue;
    }

    for (const item of profileSeed.items) {
      await tx.repogenEvidenceProfileItem.create({
        data: {
          orgId,
          profileId: profile.id,
          evidenceType: item.evidence_type,
          docType: (item.doc_type as any) ?? null,
          minCount: item.min_count,
          isRequired: item.is_required,
          tagsJson: item.tags_json ? asJson(item.tags_json) : Prisma.JsonNull,
          orderHint: item.order_hint ?? null,
          label: item.label ?? null,
          fieldKeyHint: item.field_key_hint ?? null
        }
      });
    }
  }
};

type WorkOrderProfileSelector = {
  id: string;
  orgId: string;
  reportType: string;
  bankType: string;
  valueSlab: string;
};

export const chooseDefaultRepogenEvidenceProfile = async (
  tx: TxClient,
  workOrder: WorkOrderProfileSelector
) => {
  await ensureRepogenEvidenceIntelDefaults(tx, workOrder.orgId);

  const candidates = await tx.repogenEvidenceProfile.findMany({
    where: {
      orgId: workOrder.orgId,
      isDefault: true,
      reportType: workOrder.reportType as any
    },
    orderBy: [{ createdAt: 'asc' }],
    include: {
      items: {
        orderBy: [{ orderHint: 'asc' }, { createdAt: 'asc' }]
      }
    }
  });

  if (candidates.length === 0) {
    return null;
  }

  const score = (row: { bankType: string; valueSlab: string }) => {
    let total = 0;
    if (row.bankType === workOrder.bankType) total += 10;
    else if (row.bankType === 'OTHER') total += 2;
    if (row.valueSlab === workOrder.valueSlab) total += 5;
    else if (row.valueSlab === 'UNKNOWN') total += 1;
    return total;
  };

  return candidates
    .slice()
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0] ?? null;
};
