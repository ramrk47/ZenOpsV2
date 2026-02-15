import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export interface PaymentProvider {
  readonly name: 'stripe' | 'razorpay';
  createCustomer(input: { tenant_id: string; account_id: string; email?: string }): Promise<{ provider_customer_id: string }>;
  createSubscription(input: {
    tenant_id: string;
    account_id: string;
    plan_name: string;
    external_customer_id?: string;
  }): Promise<{ provider_subscription_id: string }>;
  cancelSubscription(input: { provider_subscription_id: string }): Promise<{ ok: true }>;
  verifyWebhookSignature(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  parseWebhookEvent(rawBody: string): {
    event_id: string;
    event_type: string;
    external_subscription_id?: string | null;
    payload_json: Record<string, unknown>;
  };
}

const normalize = (value: string): string => value.trim().toLowerCase();

const safeCompare = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;

  async createCustomer(input: { tenant_id: string; account_id: string; email?: string }) {
    return {
      provider_customer_id: `cus_${input.tenant_id.slice(0, 8)}_${input.account_id.slice(0, 8)}`
    };
  }

  async createSubscription(input: {
    tenant_id: string;
    account_id: string;
    plan_name: string;
    external_customer_id?: string;
  }) {
    return {
      provider_subscription_id: `sub_${input.tenant_id.slice(0, 8)}_${normalize(input.plan_name).replace(/[^a-z0-9]/g, '')}`
    };
  }

  async cancelSubscription(_input: { provider_subscription_id: string }) {
    return {
      ok: true as const
    };
  }

  verifyWebhookSignature(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean {
    if ((process.env.PAYMENT_WEBHOOK_DEV_BYPASS ?? '').toLowerCase() === 'true') {
      return true;
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = headers['stripe-signature'];
    if (!secret || typeof signature !== 'string' || signature.length === 0) {
      return false;
    }
    const parts = signature.split(',').map((piece) => piece.trim());
    const timestamp = parts.find((piece) => piece.startsWith('t='))?.slice(2);
    const expected = parts.find((piece) => piece.startsWith('v1='))?.slice(3);
    if (!timestamp || !expected) {
      return false;
    }
    const computed = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return safeCompare(computed, expected);
  }

  parseWebhookEvent(rawBody: string) {
    const payload = JSON.parse(rawBody || '{}') as Record<string, unknown>;
    const data = typeof payload.data === 'object' && payload.data !== null ? (payload.data as Record<string, unknown>) : {};
    const object = typeof data.object === 'object' && data.object !== null ? (data.object as Record<string, unknown>) : {};
    return {
      event_id: typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : `stripe-${randomUUID()}`,
      event_type: typeof payload.type === 'string' && payload.type.length > 0 ? payload.type : 'unknown',
      external_subscription_id:
        (typeof object.subscription === 'string' && object.subscription) ||
        (typeof object.id === 'string' && object.id.startsWith('sub_') ? object.id : null),
      payload_json: payload
    };
  }
}

class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;

  async createCustomer(input: { tenant_id: string; account_id: string; email?: string }) {
    return {
      provider_customer_id: `cust_${input.tenant_id.slice(0, 8)}_${input.account_id.slice(0, 8)}`
    };
  }

  async createSubscription(input: {
    tenant_id: string;
    account_id: string;
    plan_name: string;
    external_customer_id?: string;
  }) {
    return {
      provider_subscription_id: `sub_${input.tenant_id.slice(0, 8)}_${normalize(input.plan_name).replace(/[^a-z0-9]/g, '')}`
    };
  }

  async cancelSubscription(_input: { provider_subscription_id: string }) {
    return {
      ok: true as const
    };
  }

  verifyWebhookSignature(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean {
    if ((process.env.PAYMENT_WEBHOOK_DEV_BYPASS ?? '').toLowerCase() === 'true') {
      return true;
    }
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = headers['x-razorpay-signature'];
    if (!secret || typeof signature !== 'string' || signature.length === 0) {
      return false;
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeCompare(expected, signature);
  }

  parseWebhookEvent(rawBody: string) {
    const payload = JSON.parse(rawBody || '{}') as Record<string, unknown>;
    const payloadRecord =
      typeof payload.payload === 'object' && payload.payload !== null ? (payload.payload as Record<string, unknown>) : {};
    const subWrapper =
      typeof payloadRecord.subscription === 'object' && payloadRecord.subscription !== null
        ? (payloadRecord.subscription as Record<string, unknown>)
        : {};
    const subEntity =
      typeof subWrapper.entity === 'object' && subWrapper.entity !== null ? (subWrapper.entity as Record<string, unknown>) : {};

    return {
      event_id: typeof payload.event_id === 'string' && payload.event_id.length > 0 ? payload.event_id : `razorpay-${randomUUID()}`,
      event_type: typeof payload.event === 'string' && payload.event.length > 0 ? payload.event : 'unknown',
      external_subscription_id: typeof subEntity.id === 'string' ? subEntity.id : null,
      payload_json: payload
    };
  }
}

export const paymentProviders: Record<'stripe' | 'razorpay', PaymentProvider> = {
  stripe: new StripeProvider(),
  razorpay: new RazorpayProvider()
};

