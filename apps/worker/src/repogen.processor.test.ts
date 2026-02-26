import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processRepogenGenerationJob } from './repogen.processor.js';

vi.mock('pizzip', () => {
  return {
    default: vi.fn().mockImplementation(() => ({}))
  };
});

vi.mock('docxtemplater', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      render: vi.fn(),
      getZip: vi.fn().mockReturnValue({
        generate: vi.fn().mockReturnValue(Buffer.from('mock docx content'))
      })
    }))
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn().mockImplementation(async (path: string, encoding?: string) => {
      if (typeof path === 'string' && path.includes('manifest.json')) {
        return JSON.stringify({
          bank_family: 'SBI',
          report_type: 'VALUATION',
          slab_rule: 'LT_5CR',
          pack_parts: ['report'],
          notes: 'test manifest'
        });
      }
      if (typeof path === 'string' && path.includes('samples') && path.includes('.docx')) {
        return Buffer.from('mock sample template data');
      }
      return actual.readFile(path, encoding as any);
    })
  };
});

const makeStatefulTx = (initialJobs?: any[]) => {
  const state = {
    assignment: {
      id: 'assignment-1',
      tenantId: 'tenant-1',
      title: 'Assignment Title',
      deletedAt: null
    },
    jobs:
      initialJobs ??
      [
        {
          id: 'repogen-job-1',
          tenantId: 'tenant-1',
          assignmentId: 'assignment-1',
          templateVersionId: 'tver-1',
          templateKey: 'SBI_UNDER_5CR_V1',
          reportFamily: 'valuation',
          idempotencyKey: 'idem-1',
          status: 'queued',
          attempts: 0,
          errorMessage: null,
          workerTrace: null,
          requestedByUserId: 'user-1',
          requestPayloadJson: {},
          warningsJson: [],
          queuedAt: new Date('2026-02-24T10:00:00.000Z'),
          startedAt: null,
          finishedAt: null,
          createdAt: new Date('2026-02-24T10:00:00.000Z'),
          updatedAt: new Date('2026-02-24T10:00:00.000Z'),
          reportPackId: null
        }
      ],
    packs: [] as any[],
    artifacts: [] as any[],
    auditLogs: [] as any[],
    fields: [
      {
        id: 'field-1',
        tenantId: 'tenant-1',
        assignmentId: 'assignment-1',
        templateKey: 'SBI_UNDER_5CR_V1',
        sectionKey: '',
        fieldKey: 'land_value',
        valueJson: 1000000,
        ocrJson: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'field-2',
        tenantId: 'tenant-1',
        assignmentId: 'assignment-1',
        templateKey: 'SBI_UNDER_5CR_V1',
        sectionKey: '',
        fieldKey: 'building_value',
        valueJson: 500000,
        ocrJson: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    evidenceLinks: [
      {
        id: 'evidence-1',
        tenantId: 'tenant-1',
        assignmentId: 'assignment-1',
        templateKey: 'SBI_UNDER_5CR_V1',
        sectionKey: 'site_photos',
        fieldKey: null,
        sortOrder: 0,
        createdAt: new Date(),
        document: {
          id: 'doc-1',
          originalFilename: 'front.jpg',
          contentType: 'image/jpeg'
        }
      }
    ]
  };

  const tx: any = {
    reportGenerationJob: {
      findFirst: async ({ where }: any) => {
        const job = state.jobs.find((row) => row.id === where.id && row.tenantId === where.tenantId);
        if (!job) return null;
        if (where.select) {
          return {
            id: job.id,
            assignmentId: job.assignmentId,
            reportPackId: job.reportPackId
          };
        }
        const reportPack =
          job.reportPackId == null
            ? null
            : {
              ...state.packs.find((row) => row.id === job.reportPackId),
              artifacts: state.artifacts.filter((row) => row.reportPackId === job.reportPackId)
            };
        return {
          ...job,
          reportPack
        };
      },
      update: async ({ where, data }: any) => {
        const job = state.jobs.find((row) => row.id === where.id);
        if (!job) throw new Error('job not found');
        if (data.attempts?.increment) {
          job.attempts += data.attempts.increment;
        }
        for (const [key, value] of Object.entries(data)) {
          if (key === 'attempts') continue;
          (job as any)[key] = value;
        }
        job.updatedAt = new Date();
        return job;
      }
    },
    assignment: {
      findFirst: async ({ where }: any) => {
        if (where.id === state.assignment.id && where.tenantId === state.assignment.tenantId) {
          return {
            id: state.assignment.id,
            title: state.assignment.title
          };
        }
        return null;
      }
    },
    tenant: {
      findUnique: async ({ where }: any) => {
        if (where.id === 'tenant-1') {
          return {
            repogenFeaturesJson: {
              enable_repogen: true,
              enable_review_gap: true,
              enable_pdf_conversion: true,
              enable_image_classifier: true
            }
          };
        }
        return null;
      }
    },
    reportFieldValue: {
      findMany: async ({ where }: any) =>
        state.fields.filter(
          (row) =>
            row.tenantId === where.tenantId &&
            row.assignmentId === where.assignmentId &&
            row.templateKey === where.templateKey
        )
    },
    reportEvidenceLink: {
      findMany: async ({ where }: any) =>
        state.evidenceLinks.filter(
          (row) =>
            row.tenantId === where.tenantId &&
            row.assignmentId === where.assignmentId &&
            row.templateKey === where.templateKey
        )
    },
    reportPack: {
      findFirst: async ({ where }: any) => {
        if (where.id) {
          return state.packs.find((row) => row.id === where.id && row.tenantId === where.tenantId) ?? null;
        }
        const filtered = state.packs.filter(
          (row) =>
            row.tenantId === where.tenantId &&
            row.assignmentId === where.assignmentId &&
            row.templateKey === where.templateKey
        );
        if (filtered.length === 0) return null;
        const latest = filtered.slice().sort((a, b) => b.version - a.version)[0];
        return latest ?? null;
      },
      create: async ({ data }: any) => {
        const row = {
          id: `pack-${state.packs.length + 1}`,
          tenantId: data.tenantId,
          assignmentId: data.assignmentId,
          templateVersionId: data.templateVersionId ?? null,
          templateKey: data.templateKey,
          reportFamily: data.reportFamily,
          version: data.version,
          status: data.status,
          createdByUserId: data.createdByUserId ?? null,
          warningsJson: data.warningsJson ?? [],
          contextSnapshotJson: data.contextSnapshotJson ?? null,
          generatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.packs.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.packs.find((item) => item.id === where.id);
        Object.assign(row, data);
        row.updatedAt = new Date();
        return row;
      }
    },
    reportPackArtifact: {
      findFirst: async ({ where }: any) =>
        state.artifacts.find(
          (row) =>
            row.tenantId === where.tenantId &&
            row.reportPackId === where.reportPackId &&
            row.kind === where.kind
        ) ?? null,
      count: async ({ where }: any) =>
        state.artifacts.filter((row) => row.reportPackId === where.reportPackId).length,
      create: async ({ data }: any) => {
        const row = {
          id: `artifact-${state.artifacts.length + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.artifacts.push(row);
        return row;
      }
    },
    reportAuditLog: {
      create: async ({ data }: any) => {
        const row = {
          id: `audit-${state.auditLogs.length + 1}`,
          ...data,
          createdAt: new Date()
        };
        state.auditLogs.push(row);
        return row;
      }
    }
  };

  return { tx, state };
};

describe('processRepogenGenerationJob', () => {
  it('transitions job to completed and persists pack + artifact', async () => {
    const { tx, state } = makeStatefulTx();
    const artifactsRoot = await mkdtemp(join(tmpdir(), 'zenops-repogen-worker-'));

    await processRepogenGenerationJob({
      prisma: {} as any,
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

    expect(state.jobs[0]?.status).toBe('completed');
    expect(state.jobs[0]?.attempts).toBe(1);
    expect(state.packs).toHaveLength(1);
    expect(state.packs[0]?.status).toBe('generated');
    expect(state.artifacts).toHaveLength(2); // docx + zip
    expect(state.auditLogs.some((row) => row.action === 'generation_completed')).toBe(true);

    const content = await readFile(state.artifacts[0].storageRef, 'utf8');
    expect(content).toContain('mock docx content');
  });

  it('increments report pack version for subsequent jobs on the same assignment/template', async () => {
    const { tx, state } = makeStatefulTx([
      {
        id: 'repogen-job-1',
        tenantId: 'tenant-1',
        assignmentId: 'assignment-1',
        templateVersionId: 'tver-1',
        templateKey: 'SBI_UNDER_5CR_V1',
        reportFamily: 'valuation',
        idempotencyKey: 'idem-1',
        status: 'queued',
        attempts: 0,
        errorMessage: null,
        workerTrace: null,
        requestedByUserId: 'user-1',
        requestPayloadJson: {},
        warningsJson: [],
        queuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        reportPackId: null
      },
      {
        id: 'repogen-job-2',
        tenantId: 'tenant-1',
        assignmentId: 'assignment-1',
        templateVersionId: 'tver-1',
        templateKey: 'SBI_UNDER_5CR_V1',
        reportFamily: 'valuation',
        idempotencyKey: 'idem-2',
        status: 'queued',
        attempts: 0,
        errorMessage: null,
        workerTrace: null,
        requestedByUserId: 'user-1',
        requestPayloadJson: {},
        warningsJson: [],
        queuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        reportPackId: null
      }
    ]);
    const artifactsRoot = await mkdtemp(join(tmpdir(), 'zenops-repogen-worker-'));

    await processRepogenGenerationJob({
      prisma: {} as any,
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

    await processRepogenGenerationJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        reportGenerationJobId: 'repogen-job-2',
        assignmentId: 'assignment-1',
        tenantId: 'tenant-1',
        requestId: 'req-2'
      },
      artifactsRoot,
      fallbackTenantId: 'tenant-1',
      runWithContext: async (_prisma, _ctx, fn) => fn(tx)
    });

    expect(state.packs).toHaveLength(2);
    expect(state.packs.map((row) => row.version)).toEqual([1, 2]);
    expect(state.jobs.find((row) => row.id === 'repogen-job-2')?.status).toBe('completed');
  });

  it('propagates factory bridge export hash metadata into placeholder artifacts', async () => {
    const { tx, state } = makeStatefulTx([
      {
        id: 'repogen-job-factory',
        tenantId: 'tenant-1',
        assignmentId: 'assignment-1',
        templateVersionId: null,
        templateKey: 'SBI_UNDER_5CR_V1',
        reportFamily: 'valuation',
        idempotencyKey: 'idem-factory',
        status: 'queued',
        attempts: 0,
        errorMessage: null,
        workerTrace: null,
        requestedByUserId: 'user-1',
        requestPayloadJson: {
          repogen_factory: true,
          work_order_id: 'wo-1',
          snapshot_version: 4,
          template_selector: 'SBI_FORMAT_A',
          export_bundle_hash: 'hash-123',
          export_bundle: {
            work_order_id: 'wo-1',
            snapshot_version: 4,
            contract_json: {},
            derived_json: {},
            readiness_json: {},
            evidence_manifest: []
          }
        },
        warningsJson: [],
        queuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        reportPackId: null
      }
    ]);
    const artifactsRoot = await mkdtemp(join(tmpdir(), 'zenops-repogen-worker-factory-'));

    await processRepogenGenerationJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        reportGenerationJobId: 'repogen-job-factory',
        assignmentId: 'assignment-1',
        tenantId: 'tenant-1',
        requestId: 'req-factory'
      },
      artifactsRoot,
      fallbackTenantId: 'tenant-1',
      runWithContext: async (_prisma, _ctx, fn) => fn(tx)
    });

    expect(state.artifacts).toHaveLength(2); // docx + zip
    const docxArtifact = state.artifacts.find(a => a.kind === 'docx');
    expect(docxArtifact?.metadataJson?.repogen_factory).toBe(true);
    expect(docxArtifact?.metadataJson?.work_order_id).toBe('wo-1');
    expect(docxArtifact?.metadataJson?.snapshot_version).toBe(4);
    expect(docxArtifact?.metadataJson?.template_selector).toBe('SBI_FORMAT_A');
    expect(docxArtifact?.metadataJson?.export_bundle_hash).toBe('hash-123');
  });
});
