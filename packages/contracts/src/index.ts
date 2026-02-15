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
export const AssignmentSourceTypeSchema = z.enum(['bank', 'direct', 'channel']);
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
export const AssignmentStageSchema = z.enum([
  'draft_created',
  'data_collected',
  'qc_pending',
  'qc_changes_requested',
  'qc_approved',
  'finalized',
  'sent_to_client',
  'billed',
  'paid',
  'closed'
]);
export const AssignmentLifecycleStatusSchema = z.enum([
  'DRAFT',
  'COLLECTING',
  'QC_PENDING',
  'CHANGES_REQUESTED',
  'QC_APPROVED',
  'DELIVERED',
  'BILLED',
  'PAID',
  'CLOSED'
]);
export const AssignmentAssigneeRoleSchema = z.enum(['lead', 'assistant', 'reviewer', 'field']);
export const AssignmentTaskStatusSchema = z.enum(['todo', 'doing', 'done', 'blocked']);
export const AssignmentActivityTypeSchema = z.enum([
  'created',
  'status_changed',
  'stage_transitioned',
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
  stage: AssignmentStageSchema.optional(),
  priority: AssignmentPrioritySchema.optional(),
  assignee_user_id: UuidSchema.optional(),
  due_date: DateOnlySchema.optional(),
  search: z.string().min(1).optional()
});

export const AssignmentCreateSchema = z.object({
  source: AssignmentSourceSchema.default('tenant'),
  source_type: AssignmentSourceTypeSchema.default('direct'),
  source_ref_id: UuidSchema.optional(),
  channel_id: UuidSchema.optional(),
  work_order_id: UuidSchema.optional(),
  bank_id: UuidSchema.optional(),
  bank_branch_id: UuidSchema.optional(),
  client_org_id: UuidSchema.optional(),
  property_id: UuidSchema.optional(),
  primary_contact_id: UuidSchema.optional(),
  title: z.string().min(1),
  summary: z.string().optional(),
  fee_paise: z.number().int().positive().optional(),
  priority: AssignmentPrioritySchema.default('normal'),
  status: AssignmentStatusSchema.default('requested'),
  due_date: DateOnlySchema.optional()
});

export const AssignmentUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  priority: AssignmentPrioritySchema.optional(),
  status: AssignmentStatusSchema.optional(),
  bank_id: UuidSchema.nullable().optional(),
  bank_branch_id: UuidSchema.nullable().optional(),
  client_org_id: UuidSchema.nullable().optional(),
  property_id: UuidSchema.nullable().optional(),
  channel_id: UuidSchema.nullable().optional(),
  source_type: AssignmentSourceTypeSchema.optional(),
  primary_contact_id: UuidSchema.nullable().optional(),
  fee_paise: z.number().int().positive().nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  due_date: DateOnlySchema.nullable().optional()
});

export const AssignmentTransitionSchema = z.object({
  to_stage: AssignmentStageSchema,
  reason: z.string().min(1).optional()
});

export const AssignmentStatusChangeSchema = z.object({
  to_status: AssignmentLifecycleStatusSchema,
  note: z.string().min(1).optional()
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
export const DocumentSourceSchema = z.enum([
  'portal',
  'tenant',
  'internal',
  'mobile_camera',
  'mobile_gallery',
  'desktop_upload',
  'email_ingest',
  'portal_upload'
]);
export const DocumentClassificationSchema = z.enum([
  'bank_kyc',
  'site_photo',
  'approval_plan',
  'tax_receipt',
  'legal',
  'invoice',
  'other'
]);
export const DocumentSensitivitySchema = z.enum(['public', 'internal', 'pii', 'confidential']);

export const FilePresignUploadRequestSchema = z.object({
  purpose: DocumentPurposeSchema.default('other'),
  work_order_id: UuidSchema.optional(),
  assignment_id: UuidSchema.optional(),
  report_request_id: UuidSchema.optional(),
  employee_id: UuidSchema.optional(),
  filename: z.string().min(1),
  content_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
  sha256: z.string().min(1).optional(),
  source: DocumentSourceSchema.optional(),
  classification: DocumentClassificationSchema.default('other'),
  sensitivity: DocumentSensitivitySchema.default('internal'),
  captured_at: z.string().datetime().optional(),
  captured_by_employee_id: UuidSchema.optional(),
  remarks: z.string().min(1).optional(),
  taken_on_site: z.boolean().optional()
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
  employee_id: UuidSchema.optional(),
  source: DocumentSourceSchema.optional(),
  classification: DocumentClassificationSchema.optional(),
  sensitivity: DocumentSensitivitySchema.optional(),
  filename: z.string().min(1).optional()
});

export const EmployeeRoleTemplateSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  employee_role: z.enum([
    'admin',
    'manager',
    'assistant_valuer',
    'field_valuer',
    'hr',
    'finance',
    'operations'
  ]),
  capabilities: z.array(z.string())
});

export const EmployeeRoleAssignSchema = z.object({
  role: z.enum(['admin', 'manager', 'assistant_valuer', 'field_valuer', 'hr', 'finance', 'operations'])
});

export const RoleContactPointUpsertSchema = z.object({
  role: z.enum(['admin', 'manager', 'assistant_valuer', 'field_valuer', 'hr', 'finance', 'operations']),
  channel: z.enum(['email', 'whatsapp']),
  value: z.string().min(3),
  is_primary: z.boolean().default(true),
  is_active: z.boolean().default(true)
});

export const ManualWhatsappOutboxCreateSchema = z.object({
  tenant_id: UuidSchema.optional(),
  to: z.string().min(3),
  message: z.string().min(1),
  assignment_id: UuidSchema.optional(),
  report_request_id: UuidSchema.optional()
});

export const ManualWhatsappOutboxMarkSentSchema = z.object({
  sent_by: z.string().min(1)
});

export const MasterDataSearchQuerySchema = z.object({
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(50).default(20)
});

export const BankCreateSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(16).optional()
});

export const BankBranchCreateSchema = z.object({
  bank_id: UuidSchema,
  branch_name: z.string().min(2),
  city: z.string().min(2),
  state: z.string().min(2).optional(),
  ifsc: z.string().min(4).max(16).optional(),
  client_org_id: UuidSchema.optional()
});

export const ClientOrgCreateSchema = z.object({
  name: z.string().min(2),
  city: z.string().min(2),
  type: z.string().min(2).optional()
});

export const ContactCreateSchema = z.object({
  client_org_id: UuidSchema,
  name: z.string().min(2),
  role_label: z.string().min(2).optional(),
  phone: z.string().min(3).optional(),
  email: z.string().email().optional(),
  is_primary: z.boolean().default(false)
});

export const PropertyCreateSchema = z.object({
  name: z.string().min(2),
  line_1: z.string().min(2).optional(),
  city: z.string().min(2).optional(),
  state: z.string().min(2).optional(),
  postal_code: z.string().min(4).optional()
});

export const ChannelCreateSchema = z.object({
  name: z.string().min(2),
  city: z.string().min(2).optional(),
  channel_type: z.enum(['AGENT', 'ADVOCATE', 'BUILDER', 'OTHER']).default('OTHER'),
  commission_mode: z.enum(['PERCENT', 'FLAT']).default('PERCENT'),
  commission_value: z.number().nonnegative().default(0),
  is_active: z.boolean().default(true)
});

export const BranchContactCreateSchema = z.object({
  branch_id: UuidSchema,
  name: z.string().min(2),
  phone: z.string().min(3).optional(),
  email: z.string().email().optional(),
  role: z.string().min(2).optional()
});

export const VerifyMasterDataSchema = z.object({
  verified: z.boolean().default(true)
});

export const TaskStatusSchema = z.enum(['OPEN', 'DONE', 'BLOCKED']);
export const TaskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const TaskCreateSchema = z.object({
  assignment_id: UuidSchema.optional(),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  status: TaskStatusSchema.default('OPEN'),
  priority: TaskPrioritySchema.default('MEDIUM'),
  due_at: z.string().datetime().optional(),
  assigned_to_user_id: UuidSchema.optional()
});

export const TaskUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).nullable().optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  due_at: z.string().datetime().nullable().optional(),
  assigned_to_user_id: UuidSchema.nullable().optional()
});

export const TaskListQuerySchema = z.object({
  assignment_id: UuidSchema.optional(),
  assigned_to_me: z.coerce.boolean().optional(),
  status: TaskStatusSchema.optional(),
  due_soon: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional()
});

export const ChannelRequestStatusSchema = z.enum(['SUBMITTED', 'ACCEPTED', 'REJECTED']);

export const ChannelRequestCreateSchema = z.object({
  channel_id: UuidSchema,
  borrower_name: z.string().min(1),
  phone: z.string().min(3),
  property_city: z.string().min(1),
  property_address: z.string().min(1),
  notes: z.string().min(1).optional()
});

export const ChannelRequestUpdateSchema = z.object({
  status: ChannelRequestStatusSchema,
  note: z.string().min(1).optional()
});

export const AnalyticsOverviewSchema = z.object({
  assignments_total: z.number().int().nonnegative(),
  assignments_open: z.number().int().nonnegative(),
  tasks_open: z.number().int().nonnegative(),
  tasks_overdue: z.number().int().nonnegative(),
  channel_requests_submitted: z.number().int().nonnegative(),
  outbox_failed: z.number().int().nonnegative(),
  outbox_dead: z.number().int().nonnegative()
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

export const EmployeeRoleSchema = z.enum([
  'admin',
  'manager',
  'assistant_valuer',
  'field_valuer',
  'hr',
  'finance',
  'operations'
]);
export const EmployeeStatusSchema = z.enum(['active', 'inactive']);
export const AttendanceEventKindSchema = z.enum(['checkin', 'checkout']);
export const AttendanceEventSourceSchema = z.enum(['web', 'mobile', 'system']);
export const PayrollPeriodStatusSchema = z.enum(['draft', 'running', 'completed']);
export const PayrollItemKindSchema = z.enum(['earning', 'deduction']);
export const NotificationEventTypeSchema = z.enum([
  'assignment_created',
  'report_draft_ready',
  'report_finalized',
  'invoice_created',
  'invoice_paid'
]);
export const NotificationChannelSchema = z.enum(['email', 'whatsapp']);

export const EmployeeCreateSchema = z.object({
  user_id: UuidSchema.optional(),
  name: z.string().min(1),
  phone: z.string().min(3).optional(),
  email: z.string().email().optional(),
  role: EmployeeRoleSchema.default('operations'),
  status: EmployeeStatusSchema.default('active')
});

export const AttendanceMarkSchema = z.object({
  employee_id: UuidSchema,
  happened_at: z.string().datetime().optional(),
  source: AttendanceEventSourceSchema.default('web'),
  meta_json: z.record(z.any()).optional()
});

export const PayrollPeriodCreateSchema = z.object({
  month_start: DateOnlySchema,
  month_end: DateOnlySchema,
  status: PayrollPeriodStatusSchema.default('draft')
});

export const PayrollItemCreateSchema = z.object({
  employee_id: UuidSchema,
  kind: PayrollItemKindSchema,
  label: z.string().min(1),
  amount_paise: z.number().int()
});

export const NotificationRouteCreateSchema = z.object({
  group_key: z.string().min(2),
  group_name: z.string().min(2),
  channel: NotificationChannelSchema,
  to_contact_point_id: UuidSchema,
  is_active: z.boolean().default(true)
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type TenantCreate = z.infer<typeof TenantCreateSchema>;
export type UserCreate = z.infer<typeof UserCreateSchema>;
export type WorkOrderCreate = z.infer<typeof WorkOrderCreateSchema>;
export type AssignmentListQuery = z.infer<typeof AssignmentListQuerySchema>;
export type AssignmentCreate = z.infer<typeof AssignmentCreateSchema>;
export type AssignmentUpdate = z.infer<typeof AssignmentUpdateSchema>;
export type AssignmentTransition = z.infer<typeof AssignmentTransitionSchema>;
export type AssignmentLifecycleStatus = z.infer<typeof AssignmentLifecycleStatusSchema>;
export type AssignmentStatusChange = z.infer<typeof AssignmentStatusChangeSchema>;
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
export type EmployeeRoleTemplate = z.infer<typeof EmployeeRoleTemplateSchema>;
export type EmployeeRoleAssign = z.infer<typeof EmployeeRoleAssignSchema>;
export type RoleContactPointUpsert = z.infer<typeof RoleContactPointUpsertSchema>;
export type ManualWhatsappOutboxCreate = z.infer<typeof ManualWhatsappOutboxCreateSchema>;
export type ManualWhatsappOutboxMarkSent = z.infer<typeof ManualWhatsappOutboxMarkSentSchema>;
export type MasterDataSearchQuery = z.infer<typeof MasterDataSearchQuerySchema>;
export type BankCreate = z.infer<typeof BankCreateSchema>;
export type BankBranchCreate = z.infer<typeof BankBranchCreateSchema>;
export type ClientOrgCreate = z.infer<typeof ClientOrgCreateSchema>;
export type ContactCreate = z.infer<typeof ContactCreateSchema>;
export type PropertyCreate = z.infer<typeof PropertyCreateSchema>;
export type ChannelCreate = z.infer<typeof ChannelCreateSchema>;
export type BranchContactCreate = z.infer<typeof BranchContactCreateSchema>;
export type VerifyMasterData = z.infer<typeof VerifyMasterDataSchema>;
export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type ChannelRequestCreate = z.infer<typeof ChannelRequestCreateSchema>;
export type ChannelRequestUpdate = z.infer<typeof ChannelRequestUpdateSchema>;
export type AnalyticsOverview = z.infer<typeof AnalyticsOverviewSchema>;
export type ReportDataBundlePatch = z.infer<typeof ReportDataBundlePatchSchema>;
export type BillingInvoiceMarkPaid = z.infer<typeof BillingInvoiceMarkPaidSchema>;
export type EmployeeCreate = z.infer<typeof EmployeeCreateSchema>;
export type AttendanceMark = z.infer<typeof AttendanceMarkSchema>;
export type PayrollPeriodCreate = z.infer<typeof PayrollPeriodCreateSchema>;
export type PayrollItemCreate = z.infer<typeof PayrollItemCreateSchema>;
export type NotificationRouteCreate = z.infer<typeof NotificationRouteCreateSchema>;
