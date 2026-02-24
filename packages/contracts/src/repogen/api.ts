import { z } from 'zod';
import {
  RepogenBankTypeSchema,
  RepogenCommentTypeSchema,
  RepogenContractPatchSchema,
  RepogenDateOnlySchema,
  RepogenEvidenceDocTypeSchema,
  RepogenEvidenceTypeSchema,
  RepogenReportTypeSchema,
  RepogenTemplateSelectorSchema,
  RepogenUuidSchema,
  RepogenWorkOrderSourceTypeSchema,
  RepogenWorkOrderStatusSchema
} from './contract.js';

export const RepogenWorkOrderCreateSchema = z.object({
  source_type: RepogenWorkOrderSourceTypeSchema,
  source_ref_id: RepogenUuidSchema.optional(),
  assignment_id: RepogenUuidSchema.optional(),
  report_type: RepogenReportTypeSchema,
  bank_name: z.string().min(1),
  bank_type: RepogenBankTypeSchema.optional()
});

export const RepogenWorkOrderListQuerySchema = z.object({
  status: RepogenWorkOrderStatusSchema.optional(),
  report_type: RepogenReportTypeSchema.optional(),
  bank_type: RepogenBankTypeSchema.optional(),
  template_selector: RepogenTemplateSelectorSchema.optional(),
  source_type: RepogenWorkOrderSourceTypeSchema.optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

export const RepogenContractPatchRequestSchema = z.object({
  patch: RepogenContractPatchSchema,
  ruleset_version: z.string().min(1).default('m5.4-v1')
});

export const RepogenEvidenceLinkRequestSchema = z.object({
  items: z
    .array(
      z.object({
        id: RepogenUuidSchema.optional(),
        evidence_type: RepogenEvidenceTypeSchema,
        doc_type: RepogenEvidenceDocTypeSchema.optional(),
        classification: z
          .enum(['bank_kyc', 'site_photo', 'approval_plan', 'tax_receipt', 'legal', 'invoice', 'other'])
          .optional(),
        sensitivity: z.enum(['public', 'internal', 'pii', 'confidential']).optional(),
        source: z
          .enum([
            'portal',
            'tenant',
            'internal',
            'mobile_camera',
            'mobile_gallery',
            'desktop_upload',
            'email_ingest',
            'portal_upload'
          ])
          .optional(),
        document_id: RepogenUuidSchema.optional(),
        file_ref: z.string().min(1).optional(),
        captured_by_employee_id: RepogenUuidSchema.optional(),
        captured_at: z.string().datetime().optional(),
        annexure_order: z.number().int().nonnegative().nullable().optional(),
        tags: z.record(z.any()).optional()
      })
    )
    .min(1)
});

export const RepogenStatusTransitionSchema = z.object({
  status: RepogenWorkOrderStatusSchema,
  note: z.string().min(1).optional()
});

export const RepogenCommentCreateSchema = z.object({
  comment_type: RepogenCommentTypeSchema,
  body: z.string().min(1)
});

export const RepogenExportQuerySchema = z.object({
  snapshot_version: z.coerce.number().int().positive().optional()
});

export const RepogenReadinessSummarySchema = z.object({
  completeness_score: z.number().int().min(0).max(100),
  missing_fields: z.array(z.string()),
  missing_evidence: z.array(z.string()),
  warnings: z.array(z.string()),
  required_evidence_minimums: z.record(z.number().int().nonnegative()).default({})
});

export const RepogenWorkOrderStatusHistoryEntrySchema = z.object({
  status: RepogenWorkOrderStatusSchema,
  at: z.string().datetime(),
  by_user_id: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional()
});

export const RepogenDemoSeedContractSchema = z.object({
  report_date: RepogenDateOnlySchema.optional()
});

export type RepogenWorkOrderCreate = z.infer<typeof RepogenWorkOrderCreateSchema>;
export type RepogenWorkOrderListQuery = z.infer<typeof RepogenWorkOrderListQuerySchema>;
export type RepogenContractPatchRequest = z.infer<typeof RepogenContractPatchRequestSchema>;
export type RepogenEvidenceLinkRequest = z.infer<typeof RepogenEvidenceLinkRequestSchema>;
export type RepogenStatusTransition = z.infer<typeof RepogenStatusTransitionSchema>;
export type RepogenCommentCreate = z.infer<typeof RepogenCommentCreateSchema>;
export type RepogenExportQuery = z.infer<typeof RepogenExportQuerySchema>;
