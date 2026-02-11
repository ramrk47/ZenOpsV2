import { Injectable } from '@nestjs/common';
import type { JwtClaims } from '@zenops/auth';
import { withTxContext, type TxClient } from '@zenops/db';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class RequestContextService {
  constructor(private readonly prismaService: PrismaService) {}

  async runWithClaims<T>(claims: JwtClaims, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTxContext(this.prismaService.client, {
      tenantId: claims.tenant_id,
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
}
