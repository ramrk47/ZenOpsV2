import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  getHealth() {
    return {
      ok: true,
      service: 'zenops-api',
      ts: new Date().toISOString()
    };
  }
}
