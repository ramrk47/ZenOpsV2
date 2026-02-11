import type { FastifyRequest } from 'fastify';
import type { JwtClaims } from '@zenops/auth';

export interface AuthenticatedRequest extends FastifyRequest {
  claims: JwtClaims;
  requestId: string;
}
