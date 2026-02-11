import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { LoginRequestSchema, LoginResponseSchema } from '@zenops/contracts';
import { signJwt } from '@zenops/auth';
import { Public } from './public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject('JWT_SECRET_VALUE') private readonly jwtSecret: string) {}

  @Post('login')
  @Public()
  login(@Body() body: unknown) {
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const payload = parsed.data;
    const token = signJwt({
      secret: this.jwtSecret,
      claims: {
        sub: payload.sub,
        tenant_id: payload.tenant_id ?? null,
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
