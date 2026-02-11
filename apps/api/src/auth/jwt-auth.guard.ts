import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { parseBearerToken, verifyJwt } from '@zenops/auth';
import { IS_PUBLIC_KEY, REQUIRED_AUDIENCE_KEY } from './public.decorator.js';
import type { AuthenticatedRequest } from '../types.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject('JWT_SECRET_VALUE') private readonly jwtSecret: string
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parseBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }

    const claims = verifyJwt(token, this.jwtSecret);
    const requiredAudience = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_AUDIENCE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (requiredAudience && claims.aud !== requiredAudience) {
      throw new UnauthorizedException('audience mismatch');
    }

    request.claims = claims;
    return true;
  }
}
