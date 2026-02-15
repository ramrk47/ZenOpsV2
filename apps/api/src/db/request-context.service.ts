import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { JwtClaims } from '@zenops/auth';
import { withTxContext, type TxClient } from '@zenops/db';
import { PrismaService } from './prisma.service.js';
import type { LaunchModeConfig } from '../common/launch-mode.js';

@Injectable()
export class RequestContextService {
  constructor(
    private readonly prismaService: PrismaService,
    @Inject('LAUNCH_MODE_CONFIG') private readonly launchMode: LaunchModeConfig
  ) {}

  async runWithClaims<T>(claims: JwtClaims, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const tenantId = this.resolveTenantId(claims);
    return withTxContext(this.prismaService.client, {
      tenantId,
      userId: claims.user_id,
      aud: claims.aud
    }, fn);
  }

  async runWorker<T>(tenantId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTxContext(this.prismaService.client, {
      tenantId,
      userId: null,
      aud: 'worker'
    }, fn);
  }

  async runService<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTxContext(this.prismaService.client, {
      tenantId: null,
      userId: null,
      aud: 'service'
    }, fn);
  }

  tenantIdForClaims(claims: JwtClaims): string | null {
    return this.resolveTenantId(claims);
  }

  private resolveTenantId(claims: JwtClaims): string | null {
    if (claims.aud === 'portal') {
      return this.launchMode.externalTenantId;
    }

    if (claims.aud === 'web') {
      if (!this.launchMode.multiTenantEnabled) {
        if (claims.tenant_id !== this.launchMode.internalTenantId) {
          throw new ForbiddenException('TENANT_NOT_ENABLED');
        }
        return this.launchMode.internalTenantId;
      }
      return claims.tenant_id;
    }

    return claims.tenant_id;
  }
}
