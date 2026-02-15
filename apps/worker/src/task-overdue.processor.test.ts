import { describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processTaskOverdueJob } from './task-overdue.processor.js';

describe('processTaskOverdueJob', () => {
  it('updates overdue and clears resolved flags', async () => {
    const tx = {
      task: {
        updateMany: vi
          .fn()
          .mockResolvedValueOnce({ count: 2 })
          .mockResolvedValueOnce({ count: 1 })
      }
    } as any;

    await processTaskOverdueJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        tenantId: 'tenant-1',
        requestId: 'req-1'
      },
      fallbackTenantId: 'tenant-1',
      runWithContext: async (_prisma, _context, fn) => fn(tx)
    });

    expect(tx.task.updateMany).toHaveBeenCalledTimes(2);
  });
});
