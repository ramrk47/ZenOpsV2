import { describe, expect, it, vi } from 'vitest';
import { DomainService } from './domain.service.js';

const buildTx = () => {
  const reportRequest = { id: 'req-1', tenantId: 'tenant-1', status: 'requested', deletedAt: null };
  const reservation = { id: 'ledger-1', reportJobId: null };
  const reportJob = { id: 'job-1' };

  return {
    reportRequest: {
      findFirst: vi.fn().mockResolvedValue(reportRequest),
      update: vi.fn().mockResolvedValue({ ...reportRequest, status: 'queued' })
    },
    creditsLedger: {
      findFirst: vi.fn().mockResolvedValue(reservation),
      create: vi.fn().mockResolvedValue(reservation),
      update: vi.fn().mockResolvedValue({ ...reservation, status: 'consumed' })
    },
    reportJob: {
      findFirst: vi.fn().mockResolvedValue(reportJob),
      create: vi.fn().mockResolvedValue(reportJob)
    }
  } as any;
};

describe('DomainService queue/finalize idempotency', () => {
  it('returns existing reservation/job for repeated queue requests', async () => {
    const tx = buildTx();
    const service = new DomainService();

    const result = await service.queueDraft(tx, 'req-1');

    expect(result.reportJobId).toBe('job-1');
    expect(result.alreadyQueued).toBe(true);
    expect(tx.creditsLedger.create).not.toHaveBeenCalled();
    expect(tx.reportJob.create).not.toHaveBeenCalled();
    expect(tx.reportRequest.update).toHaveBeenCalledTimes(1);
  });

  it('converts reserved to consumed and remains idempotent on repeated finalize', async () => {
    const tx = buildTx();
    const service = new DomainService();

    tx.creditsLedger.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'reserved-1' });

    await service.finalize(tx, 'req-1');

    expect(tx.creditsLedger.update).toHaveBeenCalledWith({
      where: { id: 'reserved-1' },
      data: {
        status: 'consumed',
        idempotencyKey: 'consume:req-1'
      }
    });

    tx.creditsLedger.update.mockClear();
    tx.creditsLedger.create.mockClear();

    tx.creditsLedger.findFirst.mockResolvedValueOnce({ id: 'already-consumed' });
    await service.finalize(tx, 'req-1');

    expect(tx.creditsLedger.update).not.toHaveBeenCalled();
    expect(tx.creditsLedger.create).not.toHaveBeenCalled();
  });

  it('reserves once across concurrent queue attempts (mocked concurrency)', async () => {
    const service = new DomainService();
    const state = {
      reservation: null as null | { id: string; reportJobId: string | null },
      job: null as null | { id: string }
    };

    const tx = {
      reportRequest: {
        findFirst: vi.fn().mockResolvedValue({ id: 'req-1', tenantId: 'tenant-1' }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      creditsLedger: {
        findFirst: vi.fn().mockImplementation(async () => state.reservation),
        create: vi.fn().mockImplementation(async () => {
          if (state.reservation) return state.reservation;
          state.reservation = { id: 'reserve-1', reportJobId: null };
          return state.reservation;
        }),
        update: vi.fn().mockImplementation(async (_args) => state.reservation)
      },
      reportJob: {
        findFirst: vi.fn().mockImplementation(async () => state.job),
        create: vi.fn().mockImplementation(async () => {
          if (state.job) return state.job;
          state.job = { id: 'job-1' };
          return state.job;
        })
      }
    } as any;

    const [first, second] = await Promise.all([
      service.queueDraft(tx, 'req-1'),
      service.queueDraft(tx, 'req-1')
    ]);

    expect(first.reportJobId).toBe('job-1');
    expect(second.reportJobId).toBe('job-1');
    expect(state.reservation?.id).toBe('reserve-1');
    expect(state.job?.id).toBe('job-1');
  });
});
