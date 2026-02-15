import type { Logger } from '@zenops/common';

export const BILLING_SUBSCRIPTION_REFILL_QUEUE = 'billing-subscription-refill';

export interface SubscriptionRefillPayload {
  requestId: string;
  limit?: number;
}

export interface ProcessSubscriptionRefillArgs {
  logger: Logger;
  payload: SubscriptionRefillPayload;
}

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');
const ensureApiV1Base = (value: string): string => {
  const normalized = normalizeBaseUrl(value);
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
};

export const processSubscriptionRefillJob = async ({ logger, payload }: ProcessSubscriptionRefillArgs) => {
  const apiBase =
    process.env.BILLING_API_BASE_URL ??
    process.env.ZENOPS_V2_API_BASE_URL ??
    process.env.STUDIO_BASE_URL ??
    'http://127.0.0.1:3000/v1';
  const serviceToken = process.env.STUDIO_SERVICE_TOKEN ?? '';

  if (!serviceToken) {
    throw new Error('STUDIO_SERVICE_TOKEN is required for subscription refill worker');
  }

  const url = `${ensureApiV1Base(apiBase)}/billing/subscriptions/refill-due`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-token': serviceToken
    },
    body: JSON.stringify({
      limit: payload.limit ?? 100
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`subscription refill request failed (${response.status}): ${body}`);
  }

  const result = (await response.json()) as Record<string, unknown>;
  const scanned = Number(result.scanned ?? 0);
  const refilled = Number(result.refilled ?? 0);
  const skipped = Number(result.skipped ?? 0);
  logger.info('subscription_refill_job_completed', {
    request_id: payload.requestId,
    scanned: Number.isFinite(scanned) ? scanned : 0,
    refilled: Number.isFinite(refilled) ? refilled : 0,
    skipped: Number.isFinite(skipped) ? skipped : 0
  });
};
