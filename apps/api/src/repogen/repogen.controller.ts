import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req
} from '@nestjs/common';
import {
  RepogenDraftContextQuerySchema,
  type RepogenDraftContextQuery,
  RepogenDraftUpsertSchema,
  type RepogenDraftUpsert,
  RepogenEvidenceLinksUpsertSchema,
  type RepogenEvidenceLinksUpsert,
  RepogenGenerateTriggerSchema,
  type RepogenGenerateTrigger,
  RepogenPackFinalizeSchema,
  type RepogenPackFinalize,
  RepogenPacksListQuerySchema,
  type RepogenPacksListQuery
} from '@zenops/contracts';
import type { AuthenticatedRequest } from '../types.js';
import { Claims } from '../auth/claims.decorator.js';
import type { JwtClaims } from '@zenops/auth';
import { RequestContextService } from '../db/request-context.service.js';
import { RepogenService } from './repogen.service.js';
import { RepogenQueueService } from '../queue/repogen-queue.service.js';

const parseOrThrow = <T>(parser: { safeParse: (input: unknown) => any }, body: unknown): T => {
  const parsed = parser.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error);
  }
  return parsed.data as T;
};

@Controller()
export class RepogenController {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly repogenService: RepogenService,
    private readonly repogenQueueService: RepogenQueueService
  ) { }

  @Get('assignments/:id/report-generation/context')
  async getDraftContext(@Claims() claims: JwtClaims, @Param('id') assignmentId: string, @Query() query: unknown) {
    const parsed = parseOrThrow<RepogenDraftContextQuery>(RepogenDraftContextQuerySchema, query);
    return this.requestContext.runWithClaims(claims, (tx) => this.repogenService.getDraftContext(tx, assignmentId, parsed));
  }

  @Patch('assignments/:id/report-generation/draft')
  async upsertDraft(
    @Claims() claims: JwtClaims,
    @Param('id') assignmentId: string,
    @Body() body: unknown
  ) {
    const input = parseOrThrow<RepogenDraftUpsert>(RepogenDraftUpsertSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenService.upsertDraftFields(tx, assignmentId, claims.user_id, input)
    );
  }

  @Put('assignments/:id/report-generation/evidence')
  async upsertEvidence(
    @Claims() claims: JwtClaims,
    @Param('id') assignmentId: string,
    @Body() body: unknown
  ) {
    const input = parseOrThrow<RepogenEvidenceLinksUpsert>(RepogenEvidenceLinksUpsertSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenService.upsertEvidenceLinks(tx, assignmentId, claims.user_id, input)
    );
  }

  @Post('assignments/:id/report-generation/generate')
  async triggerGeneration(
    @Claims() claims: JwtClaims,
    @Param('id') assignmentId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const input = parseOrThrow<RepogenGenerateTrigger>(RepogenGenerateTriggerSchema, body);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new BadRequestException('TENANT_CONTEXT_REQUIRED');
    }

    const { repogenFeaturesJson } = await this.requestContext.runWithClaims(claims, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { repogenFeaturesJson: true } })
    );

    const features = repogenFeaturesJson as any;
    if (features?.enable_repogen !== true) {
      throw new BadRequestException('Repogen is not enabled for this tenant');
    }

    const result = await this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenService.triggerGeneration(tx, assignmentId, claims.user_id, input)
    );

    if (!result.idempotent) {
      await this.repogenQueueService.enqueueGeneration({
        reportGenerationJobId: result.job.id,
        assignmentId,
        tenantId,
        requestId: req.requestId
      });
    }

    return result;
  }

  @Get('report-generation/jobs/:jobId')
  async getJobStatus(@Claims() claims: JwtClaims, @Param('jobId') jobId: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.repogenService.getJobStatus(tx, jobId));
  }

  @Get('assignments/:id/report-generation/packs')
  async listPacks(@Claims() claims: JwtClaims, @Param('id') assignmentId: string, @Query() query: unknown) {
    const parsed = parseOrThrow<RepogenPacksListQuery>(RepogenPacksListQuerySchema, query);
    return this.requestContext.runWithClaims(claims, (tx) => this.repogenService.listPacks(tx, assignmentId, parsed));
  }

  @Get('assignments/:id/report-generation/packs/:packId/artifacts')
  async listPackArtifacts(
    @Claims() claims: JwtClaims,
    @Param('id') assignmentId: string,
    @Param('packId') packId: string
  ) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenService.listPackArtifacts(tx, assignmentId, packId)
    );
  }

  @Post('assignments/:id/report-generation/packs/:packId/finalize')
  async finalizePack(
    @Claims() claims: JwtClaims,
    @Param('id') assignmentId: string,
    @Param('packId') packId: string,
    @Body() body: unknown
  ) {
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new BadRequestException('TENANT_CONTEXT_REQUIRED');
    }

    const { repogenFeaturesJson } = await this.requestContext.runWithClaims(claims, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { repogenFeaturesJson: true } })
    );

    const features = repogenFeaturesJson as any;
    if (features?.enable_review_gap !== true) {
      throw new BadRequestException('Review Gap is not enabled for this tenant');
    }

    const input = parseOrThrow<RepogenPackFinalize>(RepogenPackFinalizeSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenService.finalizePack(tx, assignmentId, packId, input.notes)
    );
  }

  @Get('report-generation/artifacts/:artifactId/presigned')
  async getArtifactPresignedUrl(
    @Claims() claims: JwtClaims,
    @Param('artifactId') artifactId: string
  ) {
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.repogenService.createArtifactPresignedUrl(tx, artifactId)
    );
  }
}
