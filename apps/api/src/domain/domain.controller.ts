import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import {
  AssignmentCreateSchema,
  type AssignmentCreate,
  ReportRequestCreateSchema,
  type ReportRequestCreate,
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
import { RequireAudience } from '../auth/public.decorator.js';

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
    private readonly queueService: ReportQueueService
  ) {}

  @Get('tenants')
  async listTenants(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listTenants(tx));
  }

  @Post('tenants')
  async createTenant(@Claims() claims: JwtClaims, @Body() body: unknown) {
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
  async listAssignments(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listAssignments(tx));
  }

  @Post('assignments')
  async createAssignment(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<AssignmentCreate>(AssignmentCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.createAssignment(tx, input));
  }

  @Delete('assignments/:id')
  async deleteAssignment(@Claims() claims: JwtClaims, @Param('id') id: string) {
    const deleted = await this.requestContext.runWithClaims(claims, (tx) =>
      this.domainService.softDeleteAssignment(tx, id)
    );
    return SoftDeleteResponseSchema.parse({ id: deleted.id, deleted_at: deleted.deletedAt?.toISOString() });
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
      this.domainService.queueDraft(tx, reportRequestId)
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
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.finalize(tx, reportRequestId));
  }

  @Get('report-jobs')
  async listReportJobs(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listReportJobs(tx));
  }

  @Get('studio/report-jobs')
  @RequireAudience('studio')
  async listStudioReportJobs(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.domainService.listReportJobs(tx));
  }
}
