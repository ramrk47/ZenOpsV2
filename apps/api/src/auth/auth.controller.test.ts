import { describe, expect, it } from 'vitest';
import { verifyJwt } from '@zenops/auth';
import { AuthController } from './auth.controller.js';

describe('AuthController role capability expansion', () => {
  it('adds capabilities implied by roles at login', () => {
    const launchMode = {
      multiTenantEnabled: false,
      internalTenantId: '11111111-1111-1111-1111-111111111111',
      externalTenantId: '22222222-2222-2222-2222-222222222222'
    };
    const controller = new AuthController('dev-secret', launchMode as any);

    const result = controller.login({
      aud: 'web',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      user_id: '33333333-3333-3333-3333-333333333333',
      sub: '33333333-3333-3333-3333-333333333333',
      roles: ['hr'],
      capabilities: []
    });

    const claims = verifyJwt(result.access_token, 'dev-secret');
    expect(claims.capabilities).toContain('employees.write');
    expect(claims.capabilities).toContain('attendance.write');
  });
});
