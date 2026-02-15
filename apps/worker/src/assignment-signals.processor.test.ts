import { describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processAssignmentSignalsJob } from './assignment-signals.processor.js';

const buildTx = (options?: {
  stage?: string;
  dueDate?: Date | null;
  qcChangedAt?: Date | null;
  sentChangedAt?: Date | null;
  signals?: Array<{ id: string; kind: 'overdue' | 'stuck_in_qc' | 'billing_pending'; isActive: boolean }>;
}) => {
  const state = {
    assignment: {
      id: 'assignment-1',
      tenantId: 'tenant-1',
      stage: options?.stage ?? 'qc_pending',
      dueDate: options?.dueDate ?? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    },
    qcChangedAt: options?.qcChangedAt ?? new Date(Date.now() - 30 * 60 * 60 * 1000),
    sentChangedAt: options?.sentChangedAt ?? new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    signals: [...(options?.signals ?? [])] as Array<{
      id: string;
      kind: 'overdue' | 'stuck_in_qc' | 'billing_pending';
      isActive: boolean;
      firstSeenAt?: Date;
      lastSeenAt?: Date;
      detailsJson?: Record<string, unknown>;
    }>
  };

  return {
    state,
    tx: {
      assignment: {
        findFirst: vi.fn().mockResolvedValue(state.assignment)
      },
      assignmentStageTransition: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.toStage === 'qc_pending' && state.qcChangedAt) {
            return { changedAt: state.qcChangedAt };
          }
          if (where?.toStage === 'sent_to_client' && state.sentChangedAt) {
            return { changedAt: state.sentChangedAt };
          }
          return null;
        })
      },
      assignmentSignal: {
        findMany: vi.fn().mockImplementation(async () => state.signals),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          const row = {
            id: `${data.kind}-1`,
            kind: data.kind,
            isActive: data.isActive,
            firstSeenAt: data.firstSeenAt,
            lastSeenAt: data.lastSeenAt,
            detailsJson: data.detailsJson
          };
          state.signals.push(row);
          return row;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => {
          const index = state.signals.findIndex((row) => row.id === where.id);
          if (index >= 0) {
            state.signals[index] = {
              ...state.signals[index],
              ...data
            };
            return state.signals[index];
          }
          return null;
        })
      }
    } as any
  };
};

describe('processAssignmentSignalsJob', () => {
  it('creates active overdue and stuck_in_qc signals when criteria are met', async () => {
    const { tx, state } = buildTx({
      stage: 'qc_pending'
    });

    await processAssignmentSignalsJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        assignmentId: 'assignment-1',
        tenantId: 'tenant-1',
        stage: 'qc_pending',
        dateBucket: '20260215',
        requestId: 'req-1'
      },
      fallbackTenantId: 'tenant-1',
      runWithContext: async (_prisma, _context, fn) => fn(tx)
    });

    const overdue = state.signals.find((row) => row.kind === 'overdue');
    const stuck = state.signals.find((row) => row.kind === 'stuck_in_qc');
    const billing = state.signals.find((row) => row.kind === 'billing_pending');

    expect(overdue?.isActive).toBe(true);
    expect(stuck?.isActive).toBe(true);
    expect(billing).toBeUndefined();
  });

  it('deactivates existing overdue signal when assignment is closed', async () => {
    const { tx, state } = buildTx({
      stage: 'closed',
      signals: [{ id: 'overdue-1', kind: 'overdue', isActive: true }]
    });

    await processAssignmentSignalsJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        assignmentId: 'assignment-1',
        tenantId: 'tenant-1',
        stage: 'closed',
        dateBucket: '20260215',
        requestId: 'req-2'
      },
      fallbackTenantId: 'tenant-1',
      runWithContext: async (_prisma, _context, fn) => fn(tx)
    });

    const overdue = state.signals.find((row) => row.kind === 'overdue');
    expect(overdue?.isActive).toBe(false);
  });
});
