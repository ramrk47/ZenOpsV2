import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { signJwt } from '@zenops/auth';
import { JwtAuthGuard } from './jwt-auth.guard.js';

class ReflectorStub {
  constructor(private readonly requiredAudience?: string, private readonly isPublic = false) {}

  getAllAndOverride<T>(key: string): T | undefined {
    if (key === 'isPublic') {
      return this.isPublic as T;
    }
    if (key === 'requiredAudience') {
      return this.requiredAudience as T;
    }
    return undefined;
  }
}

const makeExecutionContext = (authorization: string): ExecutionContext => {
  const request = { headers: { authorization } };
  return {
    getHandler: () => ({}),
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as ExecutionContext;
};

const launchMode = {
  multiTenantEnabled: false,
  internalTenantId: '11111111-1111-1111-1111-111111111111',
  externalTenantId: '22222222-2222-2222-2222-222222222222'
} as const;

describe('JwtAuthGuard audience gating', () => {
  it('denies non-studio token on studio-only route', () => {
    const secret = 'dev-secret';
    const token = signJwt({
      secret,
      claims: {
        sub: '11111111-1111-1111-1111-111111111111',
        tenant_id: '11111111-1111-1111-1111-111111111111',
        user_id: '11111111-1111-1111-1111-111111111111',
        aud: 'web',
        roles: [],
        capabilities: []
      }
    });

    const guard = new JwtAuthGuard(new ReflectorStub('studio') as any, secret, launchMode);

    expect(() => guard.canActivate(makeExecutionContext(`Bearer ${token}`))).toThrowError(UnauthorizedException);
  });

  it('allows studio token on studio-only route', () => {
    const secret = 'dev-secret';
    const token = signJwt({
      secret,
      claims: {
        sub: '22222222-2222-2222-2222-222222222222',
        tenant_id: '11111111-1111-1111-1111-111111111111',
        user_id: '22222222-2222-2222-2222-222222222222',
        aud: 'studio',
        roles: [],
        capabilities: []
      }
    });

    const guard = new JwtAuthGuard(new ReflectorStub('studio') as any, secret, launchMode);

    expect(guard.canActivate(makeExecutionContext(`Bearer ${token}`))).toBe(true);
  });

  it('rejects non-internal web tenant in single-tenant mode', () => {
    const secret = 'dev-secret';
    const token = signJwt({
      secret,
      claims: {
        sub: '33333333-3333-3333-3333-333333333333',
        tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        user_id: '33333333-3333-3333-3333-333333333333',
        aud: 'web',
        roles: [],
        capabilities: []
      }
    });

    const guard = new JwtAuthGuard(new ReflectorStub('web') as any, secret, launchMode);
    expect(() => guard.canActivate(makeExecutionContext(`Bearer ${token}`))).toThrowError(ForbiddenException);
  });
});
