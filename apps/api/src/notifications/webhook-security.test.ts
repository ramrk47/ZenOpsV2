import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildMailgunSignature,
  buildTwilioSignature,
  resolveWebhookSecurityConfig,
  validateWebhookRequest,
  verifyMailgunSignature,
  verifySendgridSignature
} from './webhook-security.js';

describe('webhook-security', () => {
  it('defaults to disabled webhooks', () => {
    const config = resolveWebhookSecurityConfig({});
    expect(config.enabled).toBe(false);
    expect(config.twilioValidate).toBe(false);
    expect(config.sendgridValidate).toBe(false);
    expect(config.mailgunValidate).toBe(false);
  });

  it('enables provider validation by default when webhooks are enabled', () => {
    const config = resolveWebhookSecurityConfig({ WEBHOOKS_ENABLED: 'true' });
    expect(config.enabled).toBe(true);
    expect(config.twilioValidate).toBe(true);
    expect(config.sendgridValidate).toBe(true);
    expect(config.mailgunValidate).toBe(true);
  });

  it('allows twilio webhook when validation is disabled explicitly', () => {
    const result = validateWebhookRequest({
      provider: 'twilio',
      headers: {},
      payload: { MessageSid: 'SM1' },
      requestUrl: 'https://example.com/v1/webhooks/twilio',
      env: {
        WEBHOOKS_ENABLED: 'true',
        TWILIO_WEBHOOK_VALIDATE: 'false'
      }
    });

    expect(result.ok).toBe(true);
  });

  it('validates twilio webhook signature when enabled', () => {
    const env = {
      WEBHOOKS_ENABLED: 'true',
      TWILIO_WEBHOOK_VALIDATE: 'true',
      TWILIO_AUTH_TOKEN: 'secret-token'
    };
    const payload = { MessageSid: 'SM123', SmsStatus: 'delivered' };
    const requestUrl = 'https://api.example.com/v1/webhooks/twilio';
    const signature = buildTwilioSignature(env.TWILIO_AUTH_TOKEN, requestUrl, payload);

    const accepted = validateWebhookRequest({
      provider: 'twilio',
      headers: {
        'x-twilio-signature': signature
      },
      payload,
      requestUrl,
      env
    });

    const rejected = validateWebhookRequest({
      provider: 'twilio',
      headers: {
        'x-twilio-signature': 'invalid-signature'
      },
      payload,
      requestUrl,
      env
    });

    expect(accepted.ok).toBe(true);
    expect(rejected.ok).toBe(false);
  });

  it('allows sendgrid webhook when validation is disabled explicitly', () => {
    const result = validateWebhookRequest({
      provider: 'sendgrid',
      headers: {},
      payload: [{ event: 'delivered' }],
      requestUrl: 'https://example.com/v1/webhooks/sendgrid',
      env: {
        WEBHOOKS_ENABLED: 'true',
        SENDGRID_WEBHOOK_VALIDATE: 'false'
      }
    });

    expect(result.ok).toBe(true);
  });

  it('validates sendgrid webhook signature when enabled', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const payload = [{ event: 'delivered', sg_event_id: 'event-1' }];
    const message = Buffer.from(`${timestamp}${JSON.stringify(payload)}`);
    const signature = sign('sha256', message, privateKey).toString('base64');

    expect(
      verifySendgridSignature({
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        signature,
        timestamp,
        payload
      })
    ).toBe(true);

    const result = validateWebhookRequest({
      provider: 'sendgrid',
      headers: {
        'x-twilio-email-event-webhook-signature': signature,
        'x-twilio-email-event-webhook-timestamp': timestamp
      },
      payload,
      requestUrl: 'https://api.example.com/v1/webhooks/sendgrid',
      env: {
        WEBHOOKS_ENABLED: 'true',
        SENDGRID_WEBHOOK_VALIDATE: 'true',
        SENDGRID_WEBHOOK_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString()
      }
    });

    const invalid = validateWebhookRequest({
      provider: 'sendgrid',
      headers: {
        'x-twilio-email-event-webhook-signature': 'bad-signature',
        'x-twilio-email-event-webhook-timestamp': timestamp
      },
      payload,
      requestUrl: 'https://api.example.com/v1/webhooks/sendgrid',
      env: {
        WEBHOOKS_ENABLED: 'true',
        SENDGRID_WEBHOOK_VALIDATE: 'true',
        SENDGRID_WEBHOOK_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString()
      }
    });

    expect(result.ok).toBe(true);
    expect(invalid.ok).toBe(false);
  });

  it('validates mailgun webhook signature when enabled', () => {
    const env = {
      WEBHOOKS_ENABLED: 'true',
      MAILGUN_WEBHOOK_VALIDATE: 'true',
      MAILGUN_WEBHOOK_SIGNING_KEY: 'mailgun-signing-key'
    };
    const payload = {
      tenant_id: '11111111-1111-1111-1111-111111111111',
      signature: {
        timestamp: `${Math.floor(Date.now() / 1000)}`,
        token: 'token-123',
        signature: ''
      }
    };

    payload.signature.signature = buildMailgunSignature(
      env.MAILGUN_WEBHOOK_SIGNING_KEY,
      payload.signature.timestamp,
      payload.signature.token
    );

    expect(
      verifyMailgunSignature({
        signingKey: env.MAILGUN_WEBHOOK_SIGNING_KEY,
        timestamp: payload.signature.timestamp,
        token: payload.signature.token,
        signature: payload.signature.signature
      })
    ).toBe(true);

    const accepted = validateWebhookRequest({
      provider: 'mailgun',
      headers: {},
      payload,
      requestUrl: 'https://api.example.com/v1/webhooks/mailgun',
      env
    });

    const rejected = validateWebhookRequest({
      provider: 'mailgun',
      headers: {},
      payload: {
        ...payload,
        signature: {
          ...payload.signature,
          signature: 'bad-signature'
        }
      },
      requestUrl: 'https://api.example.com/v1/webhooks/mailgun',
      env
    });

    expect(accepted.ok).toBe(true);
    expect(rejected.ok).toBe(false);
  });
});
