import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processSubscriptionRefillJob } from './subscription-refill.processor.js';

const originalEnv = {
  BILLING_API_BASE_URL: process.env.BILLING_API_BASE_URL,
  STUDIO_SERVICE_TOKEN: process.env.STUDIO_SERVICE_TOKEN
};

describe('processSubscriptionRefillJob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.BILLING_API_BASE_URL = originalEnv.BILLING_API_BASE_URL;
    process.env.STUDIO_SERVICE_TOKEN = originalEnv.STUDIO_SERVICE_TOKEN;
  });

  it('runs refill and reconcile endpoints with service token', async () => {
    process.env.BILLING_API_BASE_URL = 'http://api.internal';
    process.env.STUDIO_SERVICE_TOKEN = 'studio-token';

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          scanned: 3,
          refilled: 2,
          skipped: 1,
          past_due: 0,
          suspended: 0,
          reactivated: 0
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          scanned: 2,
          consumed: 1,
          released: 1,
          timed_out: 1
        })
      } as unknown as Response);

    await processSubscriptionRefillJob({
      logger: createJsonLogger(),
      payload: {
        requestId: 'req-1',
        limit: 50,
        reconcile_limit: 75,
        timeout_minutes: 120
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.internal/v1/billing/subscriptions/refill-due');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://api.internal/v1/billing/credits/reconcile');
  });

  it('fails when STUDIO_SERVICE_TOKEN is missing', async () => {
    process.env.BILLING_API_BASE_URL = 'http://api.internal';
    process.env.STUDIO_SERVICE_TOKEN = '';

    await expect(
      processSubscriptionRefillJob({
        logger: createJsonLogger(),
        payload: {
          requestId: 'req-2'
        }
      })
    ).rejects.toThrow('STUDIO_SERVICE_TOKEN is required');
  });
});
