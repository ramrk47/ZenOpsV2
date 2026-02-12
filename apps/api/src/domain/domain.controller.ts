import {
  BadRequestException,
  Body,
  Controller,
  Patch,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req
} from '@nestjs/common';
import {
  AssignmentAssigneeAddSchema,
  type AssignmentAssigneeAdd,
  AssignmentAttachDocumentSchema,
  type AssignmentAttachDocument,
  AssignmentCreateSchema,
  type AssignmentCreate,
  AssignmentListQuerySchema,
  type AssignmentListQuery,
  AssignmentMessageCreateSchema,
  type AssignmentMessageCreate,
  AssignmentTaskCreateSchema,
  type AssignmentTaskCreate,
  AssignmentTaskUpdateSchema,
  type AssignmentTaskUpdate,
  AssignmentUpdateSchema,
  type AssignmentUpdate,
  AttendanceMarkSchema,
  type AttendanceMark,
  BillingInvoiceMarkPaidSchema,
  type BillingInvoiceMarkPaid,
  DocumentListQuerySchema,
  type DocumentListQuery,
  DocumentMetadataPatchSchema,
  type DocumentMetadataPatch,
  DocumentTagsUpsertSchema,
  type DocumentTagsUpsert,
  FileConfirmUploadRequestSchema,
  type FileConfirmUploadRequest,
  FilePresignUploadRequestSchema,
  type FilePresignUploadRequest,
  NotificationRouteCreateSchema,
  type NotificationRouteCreate,
  PayrollItemCreateSchema,
  type PayrollItemCreate,
  PayrollPeriodCreateSchema,
  type PayrollPeriodCreate,
  ReportRequestCreateSchema,
  type ReportRequestCreate,
  ReportDataBundlePatchSchema,
  type ReportDataBundlePatch,
  EmployeeCreateSchema,
  type EmployeeCreate,
  SoftDeleteResponseSchema,
  TenantCreateSchema,
  type TenantCreate,
  UserCreateSchema,
  type UserCreate,
  WorkOrderCreateSchema,
  type WorkOrderCreate
} from '@zenops/contracts';
import type { AuthenticatedRequest } from '../types.js';
import { Claims } from '../auth/claims.decorator.js';
import type { JwtClaims } from '@zenops/auth';
import { RequestContextService } from '../db/request-context.service.js';
import { DomainService } from './domain.service.js';
import { ReportQueueService } from '../queue/report-queue.service.js';
import { RequireAudience, RequireCapabilities } from '../auth/public.decorator.js';
import type { LaunchModeConfig } from '../common/launch-mode.js';
import { Capabilities } from '../auth/rbac.js';

const parseOrThrow = <T>(parser: { safeParse: (input: unknown) => any }, body: unknown): T => {
  const parsed = parser.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error);
  }
  return parsed.data as T;
};

@Controller()
export class DomainController {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly domainService: DomainService,
    private readonly queueService: ReportQueueService,
    @Inject('LAUNCH_MODE_CONFIG') private readonly launchMode: LaunchModeConfig
  ) {}

  @Get('tenants')
  async listTenants(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listTenants(tx));
  }

  @Post('tenants')
  async createTenant(@Claims() claims: JwtClaims, @Body() body: unknown) {
    if (!this.launchMode.multiTenantEnabled) {
      throw new ForbiddenException('MULTI_TENANT_DISABLED');
    }
    const input = parseOrThrow<TenantCreate>(TenantCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.createTenant(tx, input));
  }

  @Delete('tenants/:id')
  async deleteTenant(@Claims() claims: JwtClaims, @Param('id') id: string) {
    const deleted = await this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.softDeleteTenant(tx, id)
    );
    return SoftDeleteResponseSchema.parse({ id: deleted.id, deleted_at: deleted.deletedAt?.toISOString() });
  }

  @Get('users')
  async listUsers(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listUsers(tx));
  }

  @Post('users')
  async createUser(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<UserCreate>(UserCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.createUser(tx, input));
  }

  @Get('employees')
  @RequireCapabilities(Capabilities.employeesRead)
  async listEmployees(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listEmployees(tx, claims));
  }

  @Post('employees')
  @RequireCapabilities(Capabilities.employeesWrite)
  async createEmployee(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<EmployeeCreate>(EmployeeCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.createEmployee(tx, claims, input));
  }

  @Post('attendance/checkin')
  @RequireCapabilities(Capabilities.attendanceWrite)
  async attendanceCheckin(@Claims() claims: JwtClaims, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseOrThrow<AttendanceMark>(AttendanceMarkSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.markAttendance(tx, claims, req.requestId, 'checkin', input)
    );
  }

  @Post('attendance/checkout')
  @RequireCapabilities(Capabilities.attendanceWrite)
  async attendanceCheckout(@Claims() claims: JwtClaims, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseOrThrow<AttendanceMark>(AttendanceMarkSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.markAttendance(tx, claims, req.requestId, 'checkout', input)
    );
  }

  @Get('payroll/periods')
  @RequireCapabilities(Capabilities.payrollRead)
  async listPayrollPeriods(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listPayrollPeriods(tx, claims));
  }

  @Post('payroll/periods')
  @RequireCapabilities(Capabilities.payrollWrite)
  async createPayrollPeriod(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<PayrollPeriodCreate>(PayrollPeriodCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.createPayrollPeriod(tx, claims, input)
    );
  }

  @Post('payroll/periods/:id/run')
  @RequireCapabilities(Capabilities.payrollRun)
  async runPayrollPeriod(@Claims() claims: JwtClaims, @Param('id') id: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.runPayrollPeriod(tx, claims, id));
  }

  @Get('payroll/periods/:id/items')
  @RequireCapabilities(Capabilities.payrollRead)
  async listPayrollItems(@Claims() claims: JwtClaims, @Param('id') id: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listPayrollItems(tx, claims, id));
  }

  @Post('payroll/periods/:id/items')
  @RequireCapabilities(Capabilities.payrollWrite)
  async createPayrollItem(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<PayrollItemCreate>(PayrollItemCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.createPayrollItem(tx, claims, id, input)
    );
  }

  @Post('notifications/routes')
  @RequireCapabilities(Capabilities.notificationsRoutesWrite)
  async createNotificationRoute(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<NotificationRouteCreate>(NotificationRouteCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.createNotificationRoute(tx, claims, input)
    );
  }

  @Get('notifications/routes')
  @RequireCapabilities(Capabilities.notificationsRoutesRead)
  async listNotificationRoutes(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.listNotificationRoutes(tx, claims)
    );
  }

  @Delete('users/:id')
  async deleteUser(@Claims() claims: JwtClaims, @Param('id') id: string) {
    const deleted = await this.requestContext.runWithClaims(claims, (tx) => this.domainService.softDeleteUser(tx, id));
    return SoftDeleteResponseSchema.parse({ id: deleted.id, deleted_at: deleted.deletedAt?.toISOString() });
  }

  @Get('work-orders')
  async listWorkOrders(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listWorkOrders(tx));
  }

  @Post('work-orders')
  async createWorkOrder(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<WorkOrderCreate>(WorkOrderCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.createWorkOrder(tx, input));
  }

  @Delete('work-orders/:id')
  async deleteWorkOrder(@Claims() claims: JwtClaims, @Param('id') id: string) {
    const deleted = await this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.softDeleteWorkOrder(tx, id)
    );
    return SoftDeleteResponseSchema.parse({ id: deleted.id, deleted_at: deleted.deletedAt?.toISOString() });
  }

  @Get('assignments')
  async listAssignments(@Claims() claims: JwtClaims, @Query() query: Record<string, string | undefined>) {
    const parsed = AssignmentListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error);
    }
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.listAssignments(tx, claims, parsed.data as AssignmentListQuery)
    );
  }

  @Post('assignments')
  async createAssignment(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<AssignmentCreate>(AssignmentCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.createAssignment(tx, claims, input));
  }

  @Get('assignments/:id')
  async getAssignment(@Claims() claims: JwtClaims, @Param('id') id: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.getAssignmentDetail(tx, claims, id));
  }

  @Patch('assignments/:id')
  async patchAssignment(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<AssignmentUpdate>(AssignmentUpdateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.patchAssignment(tx, claims, id, input)
    );
  }

  @Delete('assignments/:id')
  async deleteAssignment(@Claims() claims: JwtClaims, @Param('id') id: string) {
    const deleted = await this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.softDeleteAssignment(tx, claims, id)
    );
    return SoftDeleteResponseSchema.parse({ id: deleted.id, deleted_at: deleted.deletedAt?.toISOString() });
  }

  @Post('assignments/:id/assignees')
  async addAssignee(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<AssignmentAssigneeAdd>(AssignmentAssigneeAddSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.addAssignmentAssignee(tx, claims, id, input)
    );
  }

  @Delete('assignments/:id/assignees/:user_id')
  async removeAssignee(@Claims() claims: JwtClaims, @Param('id') id: string, @Param('user_id') userId: string) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.removeAssignmentAssignee(tx, claims, id, userId)
    );
  }

  @Get('assignments/:id/tasks')
  async listTasks(@Claims() claims: JwtClaims, @Param('id') id: string) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.listAssignmentTasks(tx, claims, id)
    );
  }

  @Post('assignments/:id/tasks')
  async createTask(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<AssignmentTaskCreate>(AssignmentTaskCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.createAssignmentTask(tx, claims, id, input)
    );
  }

  @Patch('assignments/:id/tasks/:task_id')
  async patchTask(
    @Claims() claims: JwtClaims,
    @Param('id') id: string,
    @Param('task_id') taskId: string,
    @Body() body: unknown
  ) {
    const input = parseOrThrow<AssignmentTaskUpdate>(AssignmentTaskUpdateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.patchAssignmentTask(tx, claims, id, taskId, input)
    );
  }

  @Delete('assignments/:id/tasks/:task_id')
  async deleteTask(@Claims() claims: JwtClaims, @Param('id') id: string, @Param('task_id') taskId: string) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.deleteAssignmentTask(tx, claims, id, taskId)
    );
  }

  @Post('assignments/:id/messages')
  async postMessage(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<AssignmentMessageCreate>(AssignmentMessageCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.postAssignmentMessage(tx, claims, id, input)
    );
  }

  @Get('assignments/:id/activities')
  async listActivities(@Claims() claims: JwtClaims, @Param('id') id: string) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.listAssignmentActivities(tx, claims, id)
    );
  }

  @Post('assignments/:id/attach-document')
  async attachDocument(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<AssignmentAttachDocument>(AssignmentAttachDocumentSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.attachDocumentToAssignment(tx, claims, id, input)
    );
  }

  @Get('report-requests')
  async listReportRequests(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listReportRequests(tx));
  }

  @Post('report-requests')
  async createReportRequest(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<ReportRequestCreate>(ReportRequestCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.createReportRequest(tx, input));
  }

  @Delete('report-requests/:id')
  async deleteReportRequest(@Claims() claims: JwtClaims, @Param('id') id: string) {
    const deleted = await this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.softDeleteReportRequest(tx, id)
    );
    return SoftDeleteResponseSchema.parse({ id: deleted.id, deleted_at: deleted.deletedAt?.toISOString() });
  }

  @Post('report-requests/:id/queue-draft')
  async queueDraft(
    @Claims() claims: JwtClaims,
    @Param('id') reportRequestId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const queueResult = await this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.queueDraft(tx, reportRequestId, claims.user_id)
    );

    await this.queueService.enqueueDraft({
      reportRequestId: queueResult.reportRequestId,
      reportJobId: queueResult.reportJobId,
      tenantId: queueResult.tenantId,
      requestId: req.requestId
    });

    return queueResult;
  }

  @Post('report-requests/:id/finalize')
  async finalize(@Claims() claims: JwtClaims, @Param('id') reportRequestId: string) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.finalize(tx, reportRequestId, claims.user_id)
    );
  }

  @Get('report-jobs')
  async listReportJobs(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listReportJobs(tx));
  }

  @Get('billing/me')
  @RequireCapabilities(Capabilities.invoicesRead)
  async billingMe(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.getBillingMe(tx, claims));
  }

  @Get('billing/invoices')
  @RequireCapabilities(Capabilities.invoicesRead)
  async listBillingInvoices(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.listBillingInvoices(tx, claims)
    );
  }

  @Get('billing/invoices/:id')
  @RequireCapabilities(Capabilities.invoicesRead)
  async getBillingInvoice(@Claims() claims: JwtClaims, @Param('id') id: string) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.getBillingInvoice(tx, claims, id)
    );
  }

  @Post('billing/invoices/:id/mark-paid')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.invoicesWrite)
  async markBillingInvoicePaid(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<BillingInvoiceMarkPaid>(BillingInvoiceMarkPaidSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.markBillingInvoicePaid(tx, claims, id, input)
    );
  }

  @Post('files/presign-upload')
  async presignUpload(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<FilePresignUploadRequest>(FilePresignUploadRequestSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.presignUpload(tx, claims, input)
    );
  }

  @Post('files/confirm-upload')
  async confirmUpload(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<FileConfirmUploadRequest>(FileConfirmUploadRequestSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.confirmUpload(tx, claims, input)
    );
  }

  @Get('files/:id/presign-download')
  async presignDownload(@Claims() claims: JwtClaims, @Param('id') id: string) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.presignDownload(tx, id)
    );
  }

  @Patch('documents/:id/metadata')
  async patchDocumentMetadata(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<DocumentMetadataPatch>(DocumentMetadataPatchSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.patchDocumentMetadata(tx, id, input)
    );
  }

  @Post('documents/:id/tags')
  async upsertDocumentTags(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<DocumentTagsUpsert>(DocumentTagsUpsertSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.upsertDocumentTags(tx, id, input)
    );
  }

  @Get('documents')
  async listDocuments(@Claims() claims: JwtClaims, @Query() query: Record<string, string | undefined>) {
    const parsed = DocumentListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error);
    }
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.listDocuments(tx, parsed.data as DocumentListQuery)
    );
  }

  @Get('report-requests/:id/data-bundle')
  async getDataBundle(@Claims() claims: JwtClaims, @Param('id') id: string) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.getDataBundle(tx, id)
    );
  }

  @Patch('report-requests/:id/data-bundle')
  async patchDataBundle(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<ReportDataBundlePatch>(ReportDataBundlePatchSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.patchDataBundle(tx, id, input)
    );
  }

  @Get('studio/report-jobs')
  @RequireAudience('studio')
  async listStudioReportJobs(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listReportJobs(tx));
  }
}
