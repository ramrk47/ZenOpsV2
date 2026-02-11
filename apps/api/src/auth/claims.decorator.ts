import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtClaims } from '@zenops/auth';
import type { AuthenticatedRequest } from '../types.js';

export const Claims = createParamDecorator((_: unknown, context: ExecutionContext): JwtClaims => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.claims;
});
