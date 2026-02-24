import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  RepogenCommentCreateSchema,
  RepogenContractPatchRequestSchema,
  RepogenEvidenceLinkRequestSchema,
  RepogenExportQuerySchema,
  RepogenStatusTransitionSchema,
  RepogenWorkOrderCreateSchema,
  RepogenWorkOrderListQuerySchema,
  type RepogenCommentCreate,
  type RepogenContractPatchRequest,
  type RepogenEvidenceLinkRequest,
  type RepogenExportQuery,
  type RepogenStatusTransition,
  type RepogenWorkOrderCreate,
  type RepogenWorkOrderListQuery
} from '@zenops/contracts';
import type { JwtClaims } from '@zenops/auth';
import { Claims } from '../auth/claims.decorator.js';
import { RequestContextService } from '../db/request-context.service.js';
import type { AuthenticatedRequest } from '../types.js';
import { RepogenComputeSnapshotQueueService } from '../queue/repogen-compute-queue.service.js';
import { RepogenSpineService } from './repogen-spine.service.js';

const parseOrThrow = <T>(schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: unknown } }, input: unknown): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error);
  }
  return parsed.data as T;
};

const requireUserId = (claims: JwtClaims): string => {
  if (!claims.user_id) {
    throw new BadRequestException('USER_CONTEXT_REQUIRED');
  }
  return claims.user_id;
};

@Controller('repogen')
export class RepogenSpineController {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly repogenSpineService: RepogenSpineService,
    private readonly repogenComputeSnapshotQueueService: RepogenComputeSnapshotQueueService
  ) {}

  @Get('work-orders')
  async listWorkOrders(@Claims() claims: JwtClaims, @Query() query: unknown) {
    const parsed = parseOrThrow<RepogenWorkOrderListQuery>(RepogenWorkOrderListQuerySchema, query);
    return this.requestContext.runWithClaims(claims, (tx) => this.repogenSpineService.listWorkOrders(tx, parsed));
  }

  @Post('work-orders')
  async createWorkOrder(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const parsed = parseOrThrow<RepogenWorkOrderCreate>(RepogenWorkOrderCreateSchema, body);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new BadRequestException('TENANT_CONTEXT_REQUIRED');
    }
    const userId = requireUserId(claims);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenSpineService.createWorkOrder(tx, tenantId, userId, parsed)
    );
  }

  @Get('work-orders/:id')
  async getWorkOrder(@Claims() claims: JwtClaims, @Param('id') workOrderId: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.repogenSpineService.getWorkOrderDetail(tx, workOrderId));
  }

  @Patch('work-orders/:id/contract')
  async patchContract(
    @Claims() claims: JwtClaims,
    @Param('id') workOrderId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = parseOrThrow<RepogenContractPatchRequest>(RepogenContractPatchRequestSchema, body);
    const userId = requireUserId(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new BadRequestException('TENANT_CONTEXT_REQUIRED');
    }
    const result = await this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenSpineService.patchContract(tx, workOrderId, userId, parsed)
    );
    const snapshotVersion = result.output_snapshot?.version;
    if (typeof snapshotVersion === 'number' && Number.isFinite(snapshotVersion)) {
      await this.repogenComputeSnapshotQueueService.enqueueSnapshotCompute({
        workOrderId,
        snapshotVersion,
        tenantId,
        requestId: req.requestId
      });
    }
    return result;
  }

  @Post('work-orders/:id/evidence/link')
  async linkEvidence(@Claims() claims: JwtClaims, @Param('id') workOrderId: string, @Body() body: unknown) {
    const parsed = parseOrThrow<RepogenEvidenceLinkRequest>(RepogenEvidenceLinkRequestSchema, body);
    const userId = requireUserId(claims);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenSpineService.upsertEvidenceLinks(tx, workOrderId, userId, parsed)
    );
  }

  @Get('work-orders/:id/export')
  async exportWorkOrder(@Claims() claims: JwtClaims, @Param('id') workOrderId: string, @Query() query: unknown) {
    const parsed = parseOrThrow<RepogenExportQuery>(RepogenExportQuerySchema, query);
    return this.requestContext.runWithClaims(claims, (tx) => this.repogenSpineService.exportWorkOrder(tx, workOrderId, parsed));
  }

  @Post('work-orders/:id/status')
  async transitionStatus(@Claims() claims: JwtClaims, @Param('id') workOrderId: string, @Body() body: unknown) {
    const parsed = parseOrThrow<RepogenStatusTransition>(RepogenStatusTransitionSchema, body);
    const userId = requireUserId(claims);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenSpineService.transitionStatus(tx, workOrderId, userId, parsed)
    );
  }

  @Get('work-orders/:id/comments')
  async listComments(@Claims() claims: JwtClaims, @Param('id') workOrderId: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.repogenSpineService.listComments(tx, workOrderId));
  }

  @Post('work-orders/:id/comments')
  async createComment(@Claims() claims: JwtClaims, @Param('id') workOrderId: string, @Body() body: unknown) {
    const parsed = parseOrThrow<RepogenCommentCreate>(RepogenCommentCreateSchema, body);
    const userId = requireUserId(claims);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenSpineService.createComment(tx, workOrderId, userId, parsed)
    );
  }
}
