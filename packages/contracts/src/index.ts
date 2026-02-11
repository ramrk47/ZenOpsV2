import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LoginRequestSchema = z.object({
  aud: z.enum(['web', 'studio', 'portal']),
  tenant_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid(),
  sub: z.string().uuid(),
  roles: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([])
});

export const LoginResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer')
});

export const SoftDeleteResponseSchema = z.object({
  id: z.string().uuid(),
  deleted_at: z.string().datetime()
});

export const TenantCreateSchema = z.object({
  slug: z.string().min(2),
  name: z.string().min(2),
  lane: z.enum(['internal', 'external', 'tenant']).default('tenant')
});

export const UserCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
});

export const WorkOrderCreateSchema = z.object({
  tenant_id: UuidSchema,
  portal_user_id: UuidSchema.optional(),
  source: z.enum(['tenant', 'external', 'partner', 'internal']).default('tenant'),
  title: z.string().min(1),
  description: z.string().optional()
});

export const AssignmentSourceSchema = z.enum(['tenant', 'external_portal', 'partner']);
export const AssignmentPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const AssignmentStatusSchema = z.enum([
  'requested',
  'assigned',
  'in_progress',
  'awaiting_docs',
  'draft_in_progress',
  'under_review',
  'finalized',
  'delivered',
  'cancelled'
]);
export const AssignmentAssigneeRoleSchema = z.enum(['lead', 'assistant', 'reviewer', 'field']);
export const AssignmentTaskStatusSchema = z.enum(['todo', 'doing', 'done', 'blocked']);
export const AssignmentActivityTypeSchema = z.enum([
  'created',
  'status_changed',
  'assignee_added',
  'assignee_removed',
  'task_added',
  'task_done',
  'message_posted',
  'document_attached',
  'report_queued',
  'report_finalized'
]);

export const AssignmentListQuerySchema = z.object({
  status: AssignmentStatusSchema.optional(),
  priority: AssignmentPrioritySchema.optional(),
  assignee_user_id: UuidSchema.optional(),
  due_date: DateOnlySchema.optional(),
  search: z.string().min(1).optional()
});

export const AssignmentCreateSchema = z.object({
  source: AssignmentSourceSchema.default('tenant'),
  work_order_id: UuidSchema.optional(),
  title: z.string().min(1),
  summary: z.string().optional(),
  priority: AssignmentPrioritySchema.default('normal'),
  status: AssignmentStatusSchema.default('requested'),
  due_date: DateOnlySchema.optional()
});

export const AssignmentUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  priority: AssignmentPrioritySchema.optional(),
  status: AssignmentStatusSchema.optional(),
  due_date: DateOnlySchema.nullable().optional()
});

export const AssignmentAssigneeAddSchema = z.object({
  user_id: UuidSchema,
  role: AssignmentAssigneeRoleSchema.default('assistant')
});

export const AssignmentFloorCreateSchema = z.object({
  name: z.string().min(1),
  sort_order: z.number().int().nonnegative().default(0)
});

export const AssignmentTaskCreateSchema = z.object({
  title: z.string().min(1),
  floor_id: UuidSchema.optional(),
  status: AssignmentTaskStatusSchema.default('todo'),
  assigned_to_user_id: UuidSchema.optional(),
  due_date: DateOnlySchema.optional()
});

export const AssignmentTaskUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  floor_id: UuidSchema.nullable().optional(),
  status: AssignmentTaskStatusSchema.optional(),
  assigned_to_user_id: UuidSchema.nullable().optional(),
  due_date: DateOnlySchema.nullable().optional()
});

export const AssignmentMessageCreateSchema = z.object({
  body: z.string().min(1)
});

export const ReportRequestCreateSchema = z.object({
  tenant_id: UuidSchema,
  assignment_id: UuidSchema.optional(),
  work_order_id: UuidSchema.optional(),
  template_version_id: UuidSchema.optional(),
  title: z.string().min(1)
});

export const DocumentPurposeSchema = z.enum(['evidence', 'reference', 'photo', 'annexure', 'other']);

export const FilePresignUploadRequestSchema = z.object({
  purpose: DocumentPurposeSchema.default('other'),
  work_order_id: UuidSchema.optional(),
  assignment_id: UuidSchema.optional(),
  report_request_id: UuidSchema.optional(),
  filename: z.string().min(1),
  content_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
  sha256: z.string().min(1).optional()
});

export const FilePresignUploadResponseSchema = z.object({
  document_id: UuidSchema,
  storage_key: z.string().min(1),
  upload: z.object({
    url: z.string().url(),
    method: z.literal('PUT'),
    headers: z.record(z.string()),
    expiresAt: z.string().datetime()
  })
});

export const FileConfirmUploadRequestSchema = z.object({
  document_id: UuidSchema
});

export const FilePresignDownloadResponseSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string().datetime()
});

export const AssignmentAttachDocumentSchema = z.object({
  document_id: UuidSchema,
  purpose: DocumentPurposeSchema.default('reference')
});

export const DocumentMetadataPatchSchema = z.object({
  metadata_json: z.record(z.any())
});

export const DocumentTagsUpsertSchema = z.object({
  tags: z.array(
    z.object({
      key: z.string().min(1),
      value: z.string().min(1).optional()
    })
  ).min(1)
});

export const DocumentListQuerySchema = z.object({
  tag_key: z.string().min(1).optional(),
  tag_value: z.string().min(1).optional(),
  purpose: DocumentPurposeSchema.optional(),
  work_order_id: UuidSchema.optional(),
  assignment_id: UuidSchema.optional(),
  report_request_id: UuidSchema.optional(),
  filename: z.string().min(1).optional()
});

export const ReportDataBundlePatchSchema = z.object({
  payload_merge: z.record(z.any()),
  schema_name: z.string().min(1).optional(),
  schema_version: z.number().int().positive().optional(),
  expected_schema_version: z.number().int().positive().optional()
});

export const BillingInvoiceMarkPaidSchema = z.object({
  amount_paise: z.number().int().positive().optional(),
  reference: z.string().min(1).optional(),
  notes: z.string().min(1).optional()
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type TenantCreate = z.infer<typeof TenantCreateSchema>;
export type UserCreate = z.infer<typeof UserCreateSchema>;
export type WorkOrderCreate = z.infer<typeof WorkOrderCreateSchema>;
export type AssignmentListQuery = z.infer<typeof AssignmentListQuerySchema>;
export type AssignmentCreate = z.infer<typeof AssignmentCreateSchema>;
export type AssignmentUpdate = z.infer<typeof AssignmentUpdateSchema>;
export type AssignmentAssigneeAdd = z.infer<typeof AssignmentAssigneeAddSchema>;
export type AssignmentFloorCreate = z.infer<typeof AssignmentFloorCreateSchema>;
export type AssignmentTaskCreate = z.infer<typeof AssignmentTaskCreateSchema>;
export type AssignmentTaskUpdate = z.infer<typeof AssignmentTaskUpdateSchema>;
export type AssignmentMessageCreate = z.infer<typeof AssignmentMessageCreateSchema>;
export type ReportRequestCreate = z.infer<typeof ReportRequestCreateSchema>;
export type FilePresignUploadRequest = z.infer<typeof FilePresignUploadRequestSchema>;
export type FileConfirmUploadRequest = z.infer<typeof FileConfirmUploadRequestSchema>;
export type AssignmentAttachDocument = z.infer<typeof AssignmentAttachDocumentSchema>;
export type DocumentMetadataPatch = z.infer<typeof DocumentMetadataPatchSchema>;
export type DocumentTagsUpsert = z.infer<typeof DocumentTagsUpsertSchema>;
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;
export type ReportDataBundlePatch = z.infer<typeof ReportDataBundlePatchSchema>;
export type BillingInvoiceMarkPaid = z.infer<typeof BillingInvoiceMarkPaidSchema>;
