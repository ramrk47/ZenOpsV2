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
  RepogenValueSlabSchema,
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

export const RepogenDeliverableReleaseBillingModeSchema = z.enum(['POSTPAID', 'CREDIT']);
export const RepogenDeliverableReleaseGateResultSchema = z.enum(['PAID', 'CREDIT_CONSUMED', 'OVERRIDE', 'BLOCKED']);

export const RepogenCreatePackRequestSchema = z.object({
  idempotency_key: z.string().min(1).optional()
});

export const RepogenDeliverablesReleaseRequestSchema = z.object({
  override: z.boolean().optional(),
  override_reason: z.string().min(1).optional(),
  idempotency_key: z.string().min(1)
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

export const RepogenReportPackArtifactSchema = z.object({
  id: RepogenUuidSchema,
  kind: z.string().min(1),
  filename: z.string().min(1),
  storage_ref: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  checksum_sha256: z.string().nullable(),
  metadata_json: z.record(z.any()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const RepogenFactoryReportPackSchema = z.object({
  id: RepogenUuidSchema,
  assignment_id: RepogenUuidSchema,
  work_order_id: RepogenUuidSchema.nullable(),
  template_key: z.string().min(1),
  report_family: z.string().min(1),
  version: z.number().int().positive(),
  status: z.string().min(1),
  warnings: z.array(z.record(z.any())).default([]),
  context_snapshot: z.record(z.any()).nullable(),
  generated_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  artifacts: z.array(RepogenReportPackArtifactSchema).default([])
});

export const RepogenFactoryGenerationJobSchema = z.object({
  id: RepogenUuidSchema,
  assignment_id: RepogenUuidSchema,
  report_pack_id: RepogenUuidSchema.nullable(),
  template_key: z.string().min(1),
  report_family: z.string().min(1),
  idempotency_key: z.string().min(1),
  status: z.string().min(1),
  attempts: z.number().int().nonnegative(),
  error_message: z.string().nullable(),
  worker_trace: z.string().nullable(),
  request_payload: z.record(z.any()),
  warnings: z.array(z.record(z.any())).default([]),
  queued_at: z.string().datetime().nullable(),
  started_at: z.string().datetime().nullable(),
  finished_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const RepogenDeliverableReleaseRecordSchema = z.object({
  id: RepogenUuidSchema,
  org_id: RepogenUuidSchema,
  work_order_id: RepogenUuidSchema,
  report_pack_id: RepogenUuidSchema,
  released_by_user_id: RepogenUuidSchema.nullable(),
  released_at: z.string().datetime(),
  billing_mode_at_release: RepogenDeliverableReleaseBillingModeSchema,
  billing_gate_result: RepogenDeliverableReleaseGateResultSchema,
  override_reason: z.string().nullable(),
  idempotency_key: z.string().min(1),
  metadata_json: z.record(z.any()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const RepogenWorkOrderPackLinkSchema = z.object({
  work_order_id: RepogenUuidSchema,
  work_order_status: RepogenWorkOrderStatusSchema,
  readiness_score: z.number().int().min(0).max(100).nullable(),
  value_slab: RepogenValueSlabSchema,
  template_selector: RepogenTemplateSelectorSchema,
  pack: RepogenFactoryReportPackSchema.nullable(),
  generation_job: RepogenFactoryGenerationJobSchema.nullable(),
  deliverable_releases: z.array(RepogenDeliverableReleaseRecordSchema).default([]),
  billing_gate_status: z
    .object({
      mode: RepogenDeliverableReleaseBillingModeSchema.nullable(),
      reservation_id_present: z.boolean(),
      service_invoice_id: z.string().uuid().nullable(),
      service_invoice_status: z.string().nullable(),
      service_invoice_is_paid: z.boolean().nullable(),
      releasable_without_override: z.boolean()
    })
    .nullable()
});

export const RepogenCreatePackResponseSchema = z.object({
  idempotent: z.boolean(),
  queue_enqueued: z.boolean(),
  pack_link: RepogenWorkOrderPackLinkSchema
});

export const RepogenReleaseDeliverablesResponseSchema = z.object({
  idempotent: z.boolean(),
  blocked: z.boolean(),
  pack_link: RepogenWorkOrderPackLinkSchema,
  release: RepogenDeliverableReleaseRecordSchema
});

export type RepogenWorkOrderCreate = z.infer<typeof RepogenWorkOrderCreateSchema>;
export type RepogenWorkOrderListQuery = z.infer<typeof RepogenWorkOrderListQuerySchema>;
export type RepogenContractPatchRequest = z.infer<typeof RepogenContractPatchRequestSchema>;
export type RepogenEvidenceLinkRequest = z.infer<typeof RepogenEvidenceLinkRequestSchema>;
export type RepogenStatusTransition = z.infer<typeof RepogenStatusTransitionSchema>;
export type RepogenCommentCreate = z.infer<typeof RepogenCommentCreateSchema>;
export type RepogenExportQuery = z.infer<typeof RepogenExportQuerySchema>;
export type RepogenCreatePackRequest = z.infer<typeof RepogenCreatePackRequestSchema>;
export type RepogenDeliverablesReleaseRequest = z.infer<typeof RepogenDeliverablesReleaseRequestSchema>;
export type RepogenWorkOrderPackLink = z.infer<typeof RepogenWorkOrderPackLinkSchema>;
export type RepogenCreatePackResponse = z.infer<typeof RepogenCreatePackResponseSchema>;
export type RepogenReleaseDeliverablesResponse = z.infer<typeof RepogenReleaseDeliverablesResponseSchema>;
