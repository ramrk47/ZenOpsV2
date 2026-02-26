import { randomUUID } from 'node:crypto';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Logger {
  info: (message: string, meta?: Record<string, JsonValue>) => void;
  warn: (message: string, meta?: Record<string, JsonValue>) => void;
  error: (message: string, meta?: Record<string, JsonValue>) => void;
}

const emit = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, JsonValue>) => {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {})
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

export const createJsonLogger = (): Logger => ({
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta)
});

export const ensureRequestId = (value?: string): string => value && value.length > 0 ? value : randomUUID();

export const nowIso = (): string => new Date().toISOString();

export const status = {
  reportRequest: {
    requested: 'requested',
    queued: 'queued',
    draftReady: 'draft_ready',
    underReview: 'under_review',
    finalized: 'finalized',
    failed: 'failed',
    cancelled: 'cancelled'
  },
  reportJob: {
    pending: 'pending',
    processing: 'processing',
    succeeded: 'succeeded',
    failed: 'failed'
  },
  creditsLedger: {
    reserved: 'reserved',
    consumed: 'consumed',
    released: 'released'
  }
} as const;

export * from './repogen/renderContext.js';
export * from './repogen/buildRenderContext.js';
export * from './repogen/packRecipe.js';
export * from './terminology.js';

export interface RepogenFeatures {
  enable_repogen?: boolean;
  enable_review_gap?: boolean;
  enable_pdf_conversion?: boolean;
  enable_image_classifier?: boolean;
}

