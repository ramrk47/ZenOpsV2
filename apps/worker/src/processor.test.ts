import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processDraftJob } from './processor.js';

const makeTx = () => {
  const state = {
    artifact: null as null | { id: string },
    outbox: null as null | { id: string }
  };

  return {
    reportJob: {
      update: vi.fn().mockResolvedValue(undefined)
    },
    reportInput: {
      findUnique: vi.fn().mockResolvedValue({
        schemaId: null,
        payload: {}
      })
    },
    reportArtifact: {
      findFirst: vi.fn().mockImplementation(async () => state.artifact),
      create: vi.fn().mockImplementation(async () => {
        state.artifact = { id: 'artifact-1' };
        return state.artifact;
      })
    },
    documentLink: {
      findMany: vi.fn().mockResolvedValue([])
    },
    artifactVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined)
    },
    reportRequest: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'req-1',
        assignmentId: null,
        workOrderId: null
      }),
      update: vi.fn().mockResolvedValue(undefined)
    },
    creditsLedger: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined)
    },
    contactPoint: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'contact-1'
      }),
      create: vi.fn().mockResolvedValue({
        id: 'contact-1'
      })
    },
    notificationTemplate: {
      findFirst: vi.fn().mockResolvedValue({
        provider: 'noop'
      })
    },
    notificationOutbox: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async () => {
        state.outbox = { id: 'outbox-1' };
        return state.outbox;
      })
    }
  } as any;
};

describe('processDraftJob', () => {
  it('creates placeholder artifact and transitions statuses', async () => {
    const tx = makeTx();
    const temp = await mkdtemp(join(tmpdir(), 'zenops-worker-'));
    const enqueueNotification = vi.fn().mockResolvedValue(undefined);

    await processDraftJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        reportRequestId: 'req-1',
        reportJobId: 'job-1',
        tenantId: 'tenant-1',
        requestId: 'request-1'
      },
      artifactsRoot: temp,
      fallbackTenantId: 'tenant-1',
      enqueueNotification,
      runWithContext: async (_prisma, _ctx, fn) => fn(tx)
    });

    expect(tx.reportJob.update).toHaveBeenCalled();
    expect(tx.reportRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'draft_ready' }
    });

    const artifactPath = join(temp, 'req-1', 'job-1-v1.docx');
    const content = await readFile(artifactPath, 'utf8');
    expect(content).toContain('Placeholder DOCX');
    expect(tx.notificationOutbox.create).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith({
      outboxId: 'outbox-1',
      tenantId: 'tenant-1',
      requestId: 'request-1'
    });
  });
});
