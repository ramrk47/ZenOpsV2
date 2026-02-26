import { processRepogenGenerationJob } from '../apps/worker/src/repogen.processor';
import { createJsonLogger } from '@zenops/common';
import { join } from 'path';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';

async function run() {
  const artifactsRoot = await mkdtemp(join(tmpdir(), 'zenops-repogen-worker-'));
  const state = { packs: [], artifacts: [] };
  const tx: any = {
    tenant: { findUnique: async () => ({ repogenFeaturesJson: { enable_repogen: true } }) },
    reportGenerationJob: {
      update: async (args: any) => ({})
    },
    reportPack: {
      findFirst: async () => null,
      create: async () => ({ id: 'pack-1', version: 1 })
    },
    reportPackArtifact: {
      findFirst: async () => null,
      count: async () => 0,
      create: async ({ data }: any) => {
        state.artifacts.push(data);
        if (data.kind === 'zip') {
          await writeFile('/Users/dr.156/ZenOpsV2/scripts/mock_output.zip', Buffer.from(data.storageRef.split(',')[1], 'base64'));
          console.log('Successfully saved to /Users/dr.156/ZenOpsV2/scripts/mock_output.zip');
        }
      }
    },
    reportAuditLog: { create: async () => ({}) }
  };

  await processRepogenGenerationJob({
    prisma: {
      $transaction: async (fn: any) => fn(tx),
      reportGenerationJob: {
        findUniqueOrThrow: async () => ({
          assignmentId: 'assignment-1',
          templateKey: 'SBI_UNDER_5CR_V1',
          reportFamily: 'valuation',
          requestPayloadJson: { repogen_factory: true, export_bundle: { evidence_manifest: [] } }
        })
      },
      assignment: { findUniqueOrThrow: async () => ({ id: 'assignment-1', title: 'Test Assignment' }) }
    } as any,
    logger: createJsonLogger(),
    payload: {
      reportGenerationJobId: 'repogen-job-1',
      assignmentId: 'assignment-1',
      tenantId: 'tenant-1',
      requestId: 'req-1'
    },
    artifactsRoot,
    fallbackTenantId: 'tenant-1',
    runWithContext: async (_prisma, _ctx, fn) => fn(tx)
  });
}
run().catch(console.error);
