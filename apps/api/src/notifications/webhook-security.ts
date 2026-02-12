import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

type HeaderValue = string | string[] | undefined;
export type HeaderMap = Record<string, HeaderValue>;

export interface WebhookSecurityConfig {
  enabled: boolean;
  twilioValidate: boolean;
  sendgridValidate: boolean;
  mailgunValidate: boolean;
}

type ValidationFailure =
  | 'disabled'
  | 'missing_signature'
  | 'missing_secret'
  | 'invalid_signature'
  | 'unsupported_provider';

export type WebhookValidationResult = { ok: true } | { ok: false; reason: ValidationFailure };

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return fallback;
};

const normalizeHeaderValue = (value: HeaderValue): string | undefined => {
  if (Array.isArray(value)) {
    return normalizeHeaderValue(value[0]);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getHeader = (headers: HeaderMap, key: string): string | undefined => {
  const direct = normalizeHeaderValue(headers[key]);
  if (direct) {
    return direct;
  }

  const lower = key.toLowerCase();
  const lowerValue = normalizeHeaderValue(headers[lower]);
  if (lowerValue) {
    return lowerValue;
  }

  const upper = key.toUpperCase();
  return normalizeHeaderValue(headers[upper]);
};

const safeCompare = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  return timingSafeEqual(leftBytes, rightBytes);
};

const toTwilioPairs = (payload: unknown): Array<[string, string]> => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return [];
  }

  const pairs: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined) {
          continue;
        }
        pairs.push([key, String(item)]);
      }
      continue;
    }

    if (typeof value === 'object') {
      pairs.push([key, JSON.stringify(value)]);
      continue;
    }

    pairs.push([key, String(value)]);
  }

  pairs.sort((a, b) => {
    if (a[0] === b[0]) {
      return a[1].localeCompare(b[1]);
    }
    return a[0].localeCompare(b[0]);
  });

  return pairs;
};

const stringifyPayload = (payload: unknown): string => {
  if (typeof payload === 'string') {
    return payload;
  }

  return JSON.stringify(payload ?? {});
};

const parseMailgunSignature = (payload: unknown): { timestamp?: string; token?: string; signature?: string } => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {};
  }

  const body = payload as Record<string, unknown>;
  const nested =
    typeof body.signature === 'object' && body.signature !== null && !Array.isArray(body.signature)
      ? (body.signature as Record<string, unknown>)
      : {};

  const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

  return {
    timestamp: asString(nested.timestamp ?? body.timestamp),
    token: asString(nested.token ?? body.token),
    signature: asString(nested.signature ?? body.signature)
  };
};

export const resolveWebhookSecurityConfig = (env: NodeJS.ProcessEnv = process.env): WebhookSecurityConfig => {
  const enabled = parseBoolean(env.WEBHOOKS_ENABLED, false);

  return {
    enabled,
    twilioValidate: parseBoolean(env.TWILIO_WEBHOOK_VALIDATE, enabled),
    sendgridValidate: parseBoolean(env.SENDGRID_WEBHOOK_VALIDATE, enabled),
    mailgunValidate: parseBoolean(env.MAILGUN_WEBHOOK_VALIDATE, enabled)
  };
};

export const buildTwilioSignature = (authToken: string, requestUrl: string, payload: unknown): string => {
  let base = requestUrl;
  for (const [key, value] of toTwilioPairs(payload)) {
    base += `${key}${value}`;
  }
  return createHmac('sha1', authToken).update(base).digest('base64');
};

export const verifyTwilioSignature = (input: {
  authToken: string;
  requestUrl: string;
  payload: unknown;
  providedSignature: string;
}): boolean => {
  const expected = buildTwilioSignature(input.authToken, input.requestUrl, input.payload);
  return safeCompare(input.providedSignature, expected);
};

export const verifySendgridSignature = (input: {
  publicKey: string;
  signature: string;
  timestamp: string;
  payload: unknown;
}): boolean => {
  try {
    const key = createPublicKey(input.publicKey);
    const message = Buffer.from(`${input.timestamp}${stringifyPayload(input.payload)}`);
    const signatureBuffer = Buffer.from(input.signature, 'base64');
    return verify('sha256', message, key, signatureBuffer);
  } catch {
    return false;
  }
};

export const buildMailgunSignature = (signingKey: string, timestamp: string, token: string): string => {
  return createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest('hex');
};

export const verifyMailgunSignature = (input: {
  signingKey: string;
  timestamp: string;
  token: string;
  signature: string;
}): boolean => {
  const expected = buildMailgunSignature(input.signingKey, input.timestamp, input.token);
  return safeCompare(input.signature.toLowerCase(), expected.toLowerCase());
};

export const buildRequestUrl = (request: {
  headers: HeaderMap;
  protocol?: string;
  url: string;
}): string => {
  const forwardedProto = getHeader(request.headers, 'x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = getHeader(request.headers, 'x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost ?? getHeader(request.headers, 'host') ?? 'localhost';
  const proto = forwardedProto ?? request.protocol ?? 'http';
  return `${proto}://${host}${request.url}`;
};

export const validateWebhookRequest = (input: {
  provider: 'twilio' | 'sendgrid' | 'mailgun';
  headers: HeaderMap;
  payload: unknown;
  requestUrl: string;
  env?: NodeJS.ProcessEnv;
}): WebhookValidationResult => {
  const config = resolveWebhookSecurityConfig(input.env);

  if (!config.enabled) {
    return { ok: false, reason: 'disabled' };
  }

  if (input.provider === 'twilio') {
    if (!config.twilioValidate) {
      return { ok: true };
    }

    const signature = getHeader(input.headers, 'x-twilio-signature');
    if (!signature) {
      return { ok: false, reason: 'missing_signature' };
    }

    const authToken = input.env?.TWILIO_AUTH_TOKEN ?? process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      return { ok: false, reason: 'missing_secret' };
    }

    if (!verifyTwilioSignature({
      authToken,
      requestUrl: input.requestUrl,
      payload: input.payload,
      providedSignature: signature
    })) {
      return { ok: false, reason: 'invalid_signature' };
    }

    return { ok: true };
  }

  if (input.provider === 'sendgrid') {
    if (!config.sendgridValidate) {
      return { ok: true };
    }

    const signature = getHeader(input.headers, 'x-twilio-email-event-webhook-signature');
    const timestamp = getHeader(input.headers, 'x-twilio-email-event-webhook-timestamp');

    if (!signature || !timestamp) {
      return { ok: false, reason: 'missing_signature' };
    }

    const publicKey = input.env?.SENDGRID_WEBHOOK_PUBLIC_KEY ?? process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    if (!publicKey) {
      return { ok: false, reason: 'missing_secret' };
    }

    if (!verifySendgridSignature({
      publicKey,
      signature,
      timestamp,
      payload: input.payload
    })) {
      return { ok: false, reason: 'invalid_signature' };
    }

    return { ok: true };
  }

  if (input.provider === 'mailgun') {
    if (!config.mailgunValidate) {
      return { ok: true };
    }

    const parsed = parseMailgunSignature(input.payload);
    const timestamp = parsed.timestamp ?? getHeader(input.headers, 'x-mailgun-timestamp');
    const token = parsed.token ?? getHeader(input.headers, 'x-mailgun-token');
    const signature = parsed.signature ?? getHeader(input.headers, 'x-mailgun-signature');

    if (!timestamp || !token || !signature) {
      return { ok: false, reason: 'missing_signature' };
    }

    const signingKey = input.env?.MAILGUN_WEBHOOK_SIGNING_KEY ?? process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    if (!signingKey) {
      return { ok: false, reason: 'missing_secret' };
    }

    if (!verifyMailgunSignature({ signingKey, timestamp, token, signature })) {
      return { ok: false, reason: 'invalid_signature' };
    }

    return { ok: true };
  }

  return { ok: false, reason: 'unsupported_provider' };
};
