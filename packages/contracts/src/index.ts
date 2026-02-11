import { z } from 'zod';

export const UuidSchema = z.string().uuid();

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

export const AssignmentCreateSchema = z.object({
  tenant_id: UuidSchema,
  work_order_id: UuidSchema,
  source_work_order_id: UuidSchema.optional(),
  assignee_user_id: UuidSchema.optional()
});

export const ReportRequestCreateSchema = z.object({
  tenant_id: UuidSchema,
  assignment_id: UuidSchema.optional(),
  work_order_id: UuidSchema.optional(),
  template_version_id: UuidSchema.optional(),
  title: z.string().min(1)
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type TenantCreate = z.infer<typeof TenantCreateSchema>;
export type UserCreate = z.infer<typeof UserCreateSchema>;
export type WorkOrderCreate = z.infer<typeof WorkOrderCreateSchema>;
export type AssignmentCreate = z.infer<typeof AssignmentCreateSchema>;
export type ReportRequestCreate = z.infer<typeof ReportRequestCreateSchema>;
