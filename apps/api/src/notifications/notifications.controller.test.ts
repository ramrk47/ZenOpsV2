import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { NotificationsController } from './notifications.controller.js';
import { buildMailgunSignature } from './webhook-security.js';

const makeController = () => {
  const requestContext = {
    runWithClaims: async (_claims: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
    runWorker: async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})
  };
  const notificationsService = {
    enqueueTest: async () => ({}),
    listOutbox: async () => [],
    recordWebhookEvent: async () => ({ duplicate: false, event: { id: 'event-1' }, outbox: null })
  };

  return new NotificationsController(requestContext as any, notificationsService as any);
};

const makeRequest = () =>
  ({
    headers: {},
    url: '/v1/webhooks/mailgun',
    protocol: 'https'
  }) as any;

describe('NotificationsController webhook status mapping', () => {
  it('returns 403 when webhooks are disabled', async () => {
    const oldEnabled = process.env.WEBHOOKS_ENABLED;
    process.env.WEBHOOKS_ENABLED = 'false';

    const controller = makeController();
    await expect(
      controller.mailgunWebhook(makeRequest(), {
        tenant_id: '11111111-1111-1111-1111-111111111111'
      })
    ).rejects.toBeInstanceOf(ForbiddenException);

    process.env.WEBHOOKS_ENABLED = oldEnabled;
  });

  it('returns 401 when webhook signature is invalid', async () => {
    const oldEnabled = process.env.WEBHOOKS_ENABLED;
    const oldValidate = process.env.MAILGUN_WEBHOOK_VALIDATE;
    const oldSigningKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    process.env.WEBHOOKS_ENABLED = 'true';
    process.env.MAILGUN_WEBHOOK_VALIDATE = 'true';
    process.env.MAILGUN_WEBHOOK_SIGNING_KEY = 'mailgun-signing-key';

    const controller = makeController();
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const token = 'token-123';
    const validSignature = buildMailgunSignature(process.env.MAILGUN_WEBHOOK_SIGNING_KEY, timestamp, token);

    await expect(
      controller.mailgunWebhook(makeRequest(), {
        tenant_id: '11111111-1111-1111-1111-111111111111',
        signature: {
          timestamp,
          token,
          signature: `${validSignature}x`
        }
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);

    process.env.WEBHOOKS_ENABLED = oldEnabled;
    process.env.MAILGUN_WEBHOOK_VALIDATE = oldValidate;
    process.env.MAILGUN_WEBHOOK_SIGNING_KEY = oldSigningKey;
  });
});
