import { Controller, Get, NotImplementedException } from '@nestjs/common';
import { RequireCapabilities } from '../auth/public.decorator.js';
import { Capabilities } from '../auth/rbac.js';

@Controller('control')
export class ControlController {
  @Get('tenant')
  @RequireCapabilities(Capabilities.masterDataRead)
  listTenants() {
    throw new NotImplementedException({
      code: 'CONTROL_TENANT_NOT_IMPLEMENTED',
      message: 'Control plane tenant registry is reserved for a later milestone.'
    });
  }

  @Get('subscriptions')
  @RequireCapabilities(Capabilities.masterDataRead)
  listSubscriptions() {
    throw new NotImplementedException({
      code: 'CONTROL_SUBSCRIPTIONS_NOT_IMPLEMENTED',
      message: 'Control plane subscriptions are reserved for a later milestone.'
    });
  }

  @Get('credits')
  @RequireCapabilities(Capabilities.masterDataRead)
  listCredits() {
    throw new NotImplementedException({
      code: 'CONTROL_CREDITS_NOT_IMPLEMENTED',
      message: 'Control plane credit ledger is reserved for a later milestone.'
    });
  }
}
