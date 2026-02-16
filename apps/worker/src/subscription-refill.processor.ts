import type { Logger } from '@zenops/common';

export const BILLING_SUBSCRIPTION_REFILL_QUEUE = 'billing-subscription-refill';

export interface SubscriptionRefillPayload {
  requestId: string;
  limit?: number;
  reconcile_limit?: number;
  timeout_minutes?: number;
  dry_run?: boolean;
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

const postBillingJson = async (
  url: string,
  token: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-token': token
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`billing request failed (${response.status}): ${payload}`);
  }

  return (await response.json()) as Record<string, unknown>;
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

  const apiV1Base = ensureApiV1Base(apiBase);
  const refillResult = await postBillingJson(`${apiV1Base}/billing/subscriptions/refill-due`, serviceToken, {
    limit: payload.limit ?? 100,
    dry_run: payload.dry_run ?? false
  });

  const reconcileResult = await postBillingJson(`${apiV1Base}/billing/credits/reconcile`, serviceToken, {
    limit: payload.reconcile_limit ?? Math.max(100, payload.limit ?? 100),
    timeout_minutes: payload.timeout_minutes,
    dry_run: payload.dry_run ?? false
  });

  const scanned = Number(refillResult.scanned ?? 0);
  const refilled = Number(refillResult.refilled ?? 0);
  const skipped = Number(refillResult.skipped ?? 0);
  const pastDue = Number(refillResult.past_due ?? 0);
  const suspended = Number(refillResult.suspended ?? 0);
  const reactivated = Number(refillResult.reactivated ?? 0);
  const reconciledScanned = Number(reconcileResult.scanned ?? 0);
  const released = Number(reconcileResult.released ?? 0);
  const consumed = Number(reconcileResult.consumed ?? 0);
  const timedOut = Number(reconcileResult.timed_out ?? 0);

  logger.info('subscription_refill_job_completed', {
    request_id: payload.requestId,
    scanned: Number.isFinite(scanned) ? scanned : 0,
    refilled: Number.isFinite(refilled) ? refilled : 0,
    skipped: Number.isFinite(skipped) ? skipped : 0,
    past_due: Number.isFinite(pastDue) ? pastDue : 0,
    suspended: Number.isFinite(suspended) ? suspended : 0,
    reactivated: Number.isFinite(reactivated) ? reactivated : 0,
    reconcile_scanned: Number.isFinite(reconciledScanned) ? reconciledScanned : 0,
    released: Number.isFinite(released) ? released : 0,
    consumed: Number.isFinite(consumed) ? consumed : 0,
    timed_out: Number.isFinite(timedOut) ? timedOut : 0
  });
};
