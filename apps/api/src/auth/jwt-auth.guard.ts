import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { parseBearerToken, verifyJwt } from '@zenops/auth';
import { IS_PUBLIC_KEY, REQUIRED_AUDIENCE_KEY, REQUIRED_CAPABILITIES_KEY } from './public.decorator.js';
import type { AuthenticatedRequest } from '../types.js';
import type { LaunchModeConfig } from '../common/launch-mode.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private static controlBuckets = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly reflector: Reflector,
    @Inject('JWT_SECRET_VALUE') private readonly jwtSecret: string,
    @Inject('LAUNCH_MODE_CONFIG') private readonly launchMode: LaunchModeConfig,
    @Inject('STUDIO_ADMIN_TOKEN') private readonly studioAdminToken: string | null,
    @Inject('CONTROL_RATE_LIMIT_RPM') private readonly controlRateLimitRpm: number
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
    const path = request.url ?? '';
    const isControlRoute = path.startsWith('/v1/control/');
    if (isControlRoute) {
      this.enforceControlRateLimit(request);
    }

    const token = parseBearerToken(request.headers.authorization);

    if (isControlRoute && this.studioAdminToken && token === this.studioAdminToken) {
      request.claims = {
        sub: 'studio-admin-token',
        tenant_id: this.launchMode.internalTenantId,
        user_id: 'studio-admin-token',
        aud: 'studio',
        roles: ['super_admin'],
        capabilities: ['*']
      };
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }

    const claims = verifyJwt(token, this.jwtSecret);

    if (
      !this.launchMode.multiTenantEnabled &&
      claims.aud === 'web' &&
      claims.tenant_id !== this.launchMode.internalTenantId
    ) {
      throw new ForbiddenException('TENANT_NOT_ENABLED');
    }

    const requiredAudience = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_AUDIENCE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (requiredAudience && claims.aud !== requiredAudience) {
      throw new UnauthorizedException('audience mismatch');
    }

    const requiredCapabilities = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_CAPABILITIES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (requiredCapabilities && requiredCapabilities.length > 0) {
      const capabilitySet = new Set(claims.capabilities);
      const isSuperAdmin = claims.roles.includes('super_admin') || capabilitySet.has('*');

      if (!isSuperAdmin) {
        const missing = requiredCapabilities.filter((capability) => !capabilitySet.has(capability));
        if (missing.length > 0) {
          throw new ForbiddenException(`missing capabilities: ${missing.join(', ')}`);
        }
      }
    }

    request.claims = claims;
    return true;
  }

  private enforceControlRateLimit(request: AuthenticatedRequest): void {
    const limit = Number.isFinite(this.controlRateLimitRpm) ? this.controlRateLimitRpm : 180;
    if (limit <= 0) {
      return;
    }

    const now = Date.now();
    const windowStart = now - (now % 60_000);
    const ip = request.ip || request.headers['x-forwarded-for']?.toString() || 'unknown';
    const key = `${ip}:${windowStart}`;

    const bucket = JwtAuthGuard.controlBuckets.get(key);
    if (!bucket) {
      JwtAuthGuard.controlBuckets.set(key, { count: 1, windowStart });
      return;
    }

    if (bucket.count >= limit) {
      throw new ForbiddenException('CONTROL_RATE_LIMIT_EXCEEDED');
    }

    bucket.count += 1;
    JwtAuthGuard.controlBuckets.set(key, bucket);
  }
}
