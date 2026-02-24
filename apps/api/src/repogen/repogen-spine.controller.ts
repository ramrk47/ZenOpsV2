import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  RepogenCommentCreateSchema,
  RepogenCreatePackRequestSchema,
  RepogenContractPatchRequestSchema,
  RepogenDeliverablesReleaseRequestSchema,
  RepogenEvidenceLinkRequestSchema,
  RepogenExportQuerySchema,
  RepogenStatusTransitionSchema,
  RepogenWorkOrderCreateSchema,
  RepogenWorkOrderListQuerySchema,
  type RepogenCommentCreate,
  type RepogenCreatePackRequest,
  type RepogenContractPatchRequest,
  type RepogenDeliverablesReleaseRequest,
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
import { RepogenQueueService } from '../queue/repogen-queue.service.js';
import { RepogenSpineService } from './repogen-spine.service.js';
import { RepogenFactoryService } from './factory/repogen-factory.service.js';

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
    private readonly repogenComputeSnapshotQueueService: RepogenComputeSnapshotQueueService,
    private readonly repogenQueueService: RepogenQueueService,
    private readonly repogenFactoryService: RepogenFactoryService
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

  private canOperateFactory(claims: JwtClaims): boolean {
    if (claims.aud === 'studio') return true;
    if (claims.aud === 'portal') return false;
    const tags = new Set([...(claims.roles ?? []), ...(claims.capabilities ?? [])].map((value) => value.toLowerCase()));
    if (tags.size === 0 && claims.aud === 'web') {
      // Dev/local fallback: many test tokens are minted without explicit role claims.
      return true;
    }
    const allowTags = ['admin', 'owner', 'ops', 'repogen_factory', 'factory_ops', 'deliverables_release'];
    return allowTags.some((tag) => tags.has(tag));
  }

  private requireFactoryOperator(claims: JwtClaims): void {
    if (!this.canOperateFactory(claims)) {
      throw new BadRequestException('FACTORY_OPERATOR_ROLE_REQUIRED');
    }
  }

  @Post('work-orders/:id/status')
  async transitionStatus(
    @Claims() claims: JwtClaims,
    @Param('id') workOrderId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = parseOrThrow<RepogenStatusTransition>(RepogenStatusTransitionSchema, body);
    const userId = requireUserId(claims);
    const result = await this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenSpineService.transitionStatus(tx, workOrderId, userId, parsed)
    );

    if (parsed.status !== 'READY_FOR_RENDER') {
      return result;
    }

    const bridgeResult = await this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenFactoryService.ensureReportPackForWorkOrder(tx, {
        work_order_id: workOrderId,
        actor_user_id: userId,
        request_id: req.requestId
      })
    );

    if (!bridgeResult.idempotent && bridgeResult.queue_payload) {
      await this.repogenQueueService.enqueueGeneration(bridgeResult.queue_payload);
    }

    return {
      ...result,
      pack_link: bridgeResult.pack_link
    };
  }

  @Post('work-orders/:id/create-pack')
  async createPack(
    @Claims() claims: JwtClaims,
    @Param('id') workOrderId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = parseOrThrow<RepogenCreatePackRequest>(RepogenCreatePackRequestSchema, body ?? {});
    this.requireFactoryOperator(claims);
    const userId = requireUserId(claims);
    const result = await this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenFactoryService.ensureReportPackForWorkOrder(tx, {
        work_order_id: workOrderId,
        actor_user_id: userId,
        request_id: req.requestId,
        requested_idempotency_key: parsed.idempotency_key
      })
    );
    if (!result.idempotent && result.queue_payload) {
      await this.repogenQueueService.enqueueGeneration(result.queue_payload);
      result.queue_enqueued = true;
    }
    return {
      idempotent: result.idempotent,
      queue_enqueued: result.queue_enqueued,
      pack_link: result.pack_link
    };
  }

  @Get('work-orders/:id/pack')
  async getLinkedPack(@Claims() claims: JwtClaims, @Param('id') workOrderId: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.repogenFactoryService.getWorkOrderPackLink(tx, workOrderId));
  }

  @Post('work-orders/:id/release-deliverables')
  async releaseDeliverables(@Claims() claims: JwtClaims, @Param('id') workOrderId: string, @Body() body: unknown) {
    const parsed = parseOrThrow<RepogenDeliverablesReleaseRequest>(RepogenDeliverablesReleaseRequestSchema, body);
    this.requireFactoryOperator(claims);
    const userId = requireUserId(claims);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenFactoryService.releaseDeliverables(tx, {
        work_order_id: workOrderId,
        actor_user_id: userId,
        request: parsed
      })
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
