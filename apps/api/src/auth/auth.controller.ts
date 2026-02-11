import { BadRequestException, Body, Controller, ForbiddenException, Inject, Post } from '@nestjs/common';
import { LoginRequestSchema, LoginResponseSchema } from '@zenops/contracts';
import { signJwt } from '@zenops/auth';
import { Public } from './public.decorator.js';
import type { LaunchModeConfig } from '../common/launch-mode.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject('JWT_SECRET_VALUE') private readonly jwtSecret: string,
    @Inject('LAUNCH_MODE_CONFIG') private readonly launchMode: LaunchModeConfig
  ) {}

  @Post('login')
  @Public()
  login(@Body() body: unknown) {
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const payload = parsed.data;
    const tenantId =
      payload.aud === 'portal'
        ? this.launchMode.externalTenantId
        : payload.aud === 'web' && !this.launchMode.multiTenantEnabled
          ? this.launchMode.internalTenantId
          : (payload.tenant_id ?? null);

    if (
      payload.aud === 'web' &&
      !this.launchMode.multiTenantEnabled &&
      payload.tenant_id !== this.launchMode.internalTenantId
    ) {
      throw new ForbiddenException('TENANT_NOT_ENABLED');
    }

    const token = signJwt({
      secret: this.jwtSecret,
      claims: {
        sub: payload.sub,
        tenant_id: tenantId,
        user_id: payload.user_id,
        aud: payload.aud,
        roles: payload.roles,
        capabilities: payload.capabilities
      }
    });

    return LoginResponseSchema.parse({
      access_token: token,
      token_type: 'Bearer'
    });
  }
}
