import { z } from 'zod';

export const RepogenUuidSchema = z.string().uuid();
export const RepogenDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RepogenReportTypeSchema = z.enum(['VALUATION', 'DPR', 'REVALUATION', 'STAGE_PROGRESS']);
export const RepogenBankTypeSchema = z.enum(['SBI', 'PSU_GENERIC', 'COOP', 'AGRI', 'OTHER']);
export const RepogenValueSlabSchema = z.enum(['LT_5CR', 'GT_5CR', 'UNKNOWN']);
export const RepogenTemplateSelectorSchema = z.enum([
  'SBI_FORMAT_A',
  'BOI_PSU_GENERIC',
  'COOP_GENERIC',
  'AGRI_GENERIC',
  'UNKNOWN'
]);
export const RepogenWorkOrderSourceTypeSchema = z.enum(['TENANT', 'EXTERNAL', 'CHANNEL']);
export const RepogenWorkOrderStatusSchema = z.enum([
  'DRAFT',
  'EVIDENCE_PENDING',
  'DATA_PENDING',
  'READY_FOR_RENDER',
  'CANCELLED',
  'CLOSED'
]);
export const RepogenEvidenceTypeSchema = z.enum(['DOCUMENT', 'PHOTO', 'SCREENSHOT', 'GEO', 'OTHER']);
export const RepogenEvidenceDocTypeSchema = z.enum([
  'SALE_DEED',
  'RTC',
  'EC',
  'KHATA',
  'TAX',
  'NA_ORDER',
  'PLAN',
  'ID_PROOF',
  'BANK_LETTER',
  'OTHER'
]);
export const RepogenCommentTypeSchema = z.enum(['JUSTIFICATION', 'ENCLOSURES', 'CHECKLIST', 'NOTES']);
export const RepogenUnitSchema = z.enum(['sqm', 'sqft']);

export const RepogenNumberWithUnitSchema = z.object({
  value: z.number().finite().nonnegative().optional(),
  unit: RepogenUnitSchema.optional()
});

export const RepogenContractMetaSchema = z.object({
  report_type: RepogenReportTypeSchema.optional(),
  bank_type: RepogenBankTypeSchema.optional(),
  value_slab: RepogenValueSlabSchema.optional(),
  template_selector: RepogenTemplateSelectorSchema.optional()
});

export const RepogenContractPartySchema = z.object({
  borrower_name: z.string().min(1).optional(),
  owner_name: z.string().min(1).optional(),
  client_name: z.string().min(1).optional(),
  bank_name: z.string().min(1).optional(),
  bank_branch_name: z.string().min(1).optional(),
  bank_branch_code: z.string().min(1).optional(),
  valuer_id: z.string().min(1).optional(),
  engineer_id: z.string().min(1).optional()
});

export const RepogenContractPropertySchema = z.object({
  address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  taluk: z.string().min(1).optional(),
  village: z.string().min(1).optional(),
  survey_no: z.string().min(1).optional(),
  cts_no: z.string().min(1).optional(),
  khata_no: z.string().min(1).optional(),
  land_area: RepogenNumberWithUnitSchema.optional(),
  built_up_area: RepogenNumberWithUnitSchema.optional(),
  floors: z
    .array(
      z.object({
        label: z.string().min(1),
        area: RepogenNumberWithUnitSchema.optional()
      })
    )
    .default([])
});

export const RepogenContractValuationInputsSchema = z.object({
  guideline_rate_per_sqm: z.number().finite().nonnegative().optional(),
  guideline_rate_input: RepogenNumberWithUnitSchema.optional(),
  market_rate_input: RepogenNumberWithUnitSchema.optional(),
  adopted_rate_input: RepogenNumberWithUnitSchema.optional(),
  land_value: z.number().finite().nonnegative().optional(),
  building_value: z.number().finite().nonnegative().optional(),
  fmv_input: z.number().finite().nonnegative().optional(),
  market_total_value_input: z.number().finite().nonnegative().optional(),
  adopted_total_value_input: z.number().finite().nonnegative().optional(),
  user_input_units: RepogenUnitSchema.optional(),
  depreciation_percent: z.number().finite().min(0).max(100).optional(),
  guideline_screenshot_present: z.boolean().optional(),
  inspection_date: RepogenDateOnlySchema.optional()
});

export const RepogenContractComputedValuesSchema = z.object({
  FMV: z.number().finite().nonnegative().optional(),
  realizable_value: z.number().finite().nonnegative().optional(),
  distress_value: z.number().finite().nonnegative().optional(),
  coop_market_value: z.number().finite().nonnegative().optional(),
  coop_adopted_value: z.number().finite().nonnegative().optional(),
  rounded_to_next_500: z.number().finite().nonnegative().optional(),
  standardized_rates: z
    .object({
      guideline_rate_per_sqm: z.number().finite().nonnegative().optional(),
      market_rate_per_sqm: z.number().finite().nonnegative().optional(),
      adopted_rate_per_sqm: z.number().finite().nonnegative().optional()
    })
    .optional(),
  standardized_areas: z
    .object({
      land_area_sqm: z.number().finite().nonnegative().optional(),
      built_up_area_sqm: z.number().finite().nonnegative().optional()
    })
    .optional()
});

export const RepogenContractAnnexureItemSchema = z.object({
  evidence_item_id: RepogenUuidSchema,
  label: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  sort_order: z.number().int().nonnegative().default(0),
  group_hint: z
    .object({
      min_images_per_page: z.number().int().min(1).max(4).default(2),
      max_images_per_page: z.number().int().min(2).max(4).default(4),
      preferred_images_per_page: z.number().int().min(2).max(4).default(2)
    })
    .optional()
});

export const RepogenContractAnnexuresSchema = z.object({
  items: z.array(RepogenContractAnnexureItemSchema).default([]),
  image_grouping_default: z
    .object({
      min_images_per_page: z.number().int().min(1).max(4).default(2),
      max_images_per_page: z.number().int().min(2).max(4).default(4)
    })
    .default({
      min_images_per_page: 2,
      max_images_per_page: 4
    })
});

export const RepogenContractManualFieldsSchema = z.object({
  enclosures_text: z.string().optional(),
  checklist_json: z.record(z.any()).optional(),
  justification_text: z.string().optional()
});

export const RepogenContractAuditSchema = z.object({
  snapshot_version: z.number().int().positive().optional(),
  created_by: RepogenUuidSchema.optional(),
  created_at: z.string().datetime().optional()
});

export const RepogenContractSchema = z.object({
  meta: RepogenContractMetaSchema.default({}),
  party: RepogenContractPartySchema.default({}),
  property: RepogenContractPropertySchema.default({ floors: [] }),
  valuation_inputs: RepogenContractValuationInputsSchema.default({}),
  computed_values: RepogenContractComputedValuesSchema.default({}),
  annexures: RepogenContractAnnexuresSchema.default({
    items: [],
    image_grouping_default: {
      min_images_per_page: 2,
      max_images_per_page: 4
    }
  }),
  manual_fields: RepogenContractManualFieldsSchema.default({}),
  audit: RepogenContractAuditSchema.default({})
});

export const RepogenContractPatchSchema = RepogenContractSchema.deepPartial();

export type RepogenReportType = z.infer<typeof RepogenReportTypeSchema>;
export type RepogenBankType = z.infer<typeof RepogenBankTypeSchema>;
export type RepogenValueSlab = z.infer<typeof RepogenValueSlabSchema>;
export type RepogenTemplateSelector = z.infer<typeof RepogenTemplateSelectorSchema>;
export type RepogenWorkOrderSourceType = z.infer<typeof RepogenWorkOrderSourceTypeSchema>;
export type RepogenWorkOrderStatus = z.infer<typeof RepogenWorkOrderStatusSchema>;
export type RepogenEvidenceType = z.infer<typeof RepogenEvidenceTypeSchema>;
export type RepogenEvidenceDocType = z.infer<typeof RepogenEvidenceDocTypeSchema>;
export type RepogenCommentType = z.infer<typeof RepogenCommentTypeSchema>;
export type RepogenContract = z.infer<typeof RepogenContractSchema>;
export type RepogenContractPatch = z.infer<typeof RepogenContractPatchSchema>;
