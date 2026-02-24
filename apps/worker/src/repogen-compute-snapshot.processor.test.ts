import { describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processRepogenComputeSnapshotJob } from './repogen-compute-snapshot.processor.js';

describe('processRepogenComputeSnapshotJob', () => {
  it('validates work order and snapshot visibility in worker context', async () => {
    const tx = {
      repogenWorkOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'wo-1',
          status: 'DATA_PENDING',
          reportType: 'VALUATION',
          bankType: 'SBI',
          valueSlab: 'LT_5CR',
          templateSelector: 'SBI_FORMAT_A'
        })
      },
      repogenContractSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'snap-2',
          version: 2,
          createdAt: new Date()
        })
      }
    } as any;

    await processRepogenComputeSnapshotJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        workOrderId: 'wo-1',
        snapshotVersion: 2,
        tenantId: 'tenant-1',
        requestId: 'req-1'
      },
      fallbackTenantId: 'tenant-1',
      runWithContext: async (_prisma, _ctx, fn) => fn(tx)
    });

    expect(tx.repogenWorkOrder.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.repogenContractSnapshot.findFirst).toHaveBeenCalledTimes(1);
  });
});
