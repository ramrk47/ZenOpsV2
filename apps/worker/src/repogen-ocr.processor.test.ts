import { describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processRepogenOcrPlaceholderJob } from './repogen-ocr.processor.js';

describe('processRepogenOcrPlaceholderJob', () => {
  it('marks queued OCR job as DONE with placeholder result', async () => {
    const updates: any[] = [];
    const tx = {
      repogenOcrJob: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'ocr-1',
          status: 'QUEUED',
          workOrderId: 'wo-1',
          evidenceItemId: 'ev-1',
          resultJson: null,
          requestedAt: new Date('2026-02-24T10:00:00.000Z')
        }),
        update: vi.fn().mockImplementation(async ({ data }: any) => {
          updates.push(data);
          return { id: 'ocr-1', ...data };
        })
      }
    } as any;

    await processRepogenOcrPlaceholderJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        ocrJobId: 'ocr-1',
        workOrderId: 'wo-1',
        evidenceItemId: 'ev-1',
        tenantId: 'tenant-1',
        requestId: 'req-ocr-1'
      },
      fallbackTenantId: 'tenant-1',
      runWithContext: async (_prisma, _ctx, fn) => fn(tx)
    });

    expect(tx.repogenOcrJob.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.repogenOcrJob.update).toHaveBeenCalledTimes(1);
    expect(updates[0]?.status).toBe('DONE');
    expect(updates[0]?.resultJson?.note).toBe('OCR not enabled yet');
    expect(updates[0]?.workerTrace).toBe('req-ocr-1');
  });

  it('is idempotent when OCR job is already DONE', async () => {
    const tx = {
      repogenOcrJob: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'ocr-2',
          status: 'DONE',
          workOrderId: 'wo-1',
          evidenceItemId: 'ev-2',
          resultJson: { placeholder: true },
          requestedAt: new Date('2026-02-24T10:00:00.000Z')
        }),
        update: vi.fn()
      }
    } as any;

    await processRepogenOcrPlaceholderJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        ocrJobId: 'ocr-2',
        workOrderId: 'wo-1',
        evidenceItemId: 'ev-2',
        tenantId: 'tenant-1',
        requestId: 'req-ocr-2'
      },
      fallbackTenantId: 'tenant-1',
      runWithContext: async (_prisma, _ctx, fn) => fn(tx)
    });

    expect(tx.repogenOcrJob.update).not.toHaveBeenCalled();
  });
});
