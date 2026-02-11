import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processDraftJob } from './processor.js';

const makeTx = () => {
  const state = {
    artifact: null as null | { id: string }
  };

  return {
    reportJob: {
      update: vi.fn().mockResolvedValue(undefined)
    },
    reportArtifact: {
      findFirst: vi.fn().mockImplementation(async () => state.artifact),
      create: vi.fn().mockImplementation(async () => {
        state.artifact = { id: 'artifact-1' };
        return state.artifact;
      })
    },
    artifactVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined)
    },
    reportRequest: {
      update: vi.fn().mockResolvedValue(undefined)
    },
    creditsLedger: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined)
    }
  } as any;
};

describe('processDraftJob', () => {
  it('creates placeholder artifact and transitions statuses', async () => {
    const tx = makeTx();
    const temp = await mkdtemp(join(tmpdir(), 'zenops-worker-'));

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
  });
});
