import { describe, expect, it, vi } from 'vitest';
import { RepogenService } from './repogen.service.js';

const assignmentId = 'assignment-1';
const tenantId = 'tenant-1';

const buildTriggerTx = () => {
  const state = {
    templates: [] as any[],
    templateVersions: [] as any[],
    jobs: [] as any[],
    auditLogs: [] as any[]
  };

  const tx: any = {
    assignment: {
      findFirst: vi.fn().mockResolvedValue({
        id: assignmentId,
        tenantId,
        title: 'Assignment',
        status: 'draft_in_progress',
        stage: 'data_collected'
      })
    },
    reportTemplate: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        return state.templates.find((row) => row.tenantId === where.tenantId && row.templateKey === where.templateKey) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `template-${state.templates.length + 1}`,
          tenantId: data.tenantId,
          name: data.name,
          templateKey: data.templateKey,
          family: data.family,
          status: data.status,
          metadataJson: data.metadataJson,
          deletedAt: null
        };
        state.templates.push(row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = state.templates.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      })
    },
    templateVersion: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        return (
          state.templateVersions.find(
            (row) =>
              row.tenantId === where.tenantId &&
              row.reportTemplateId === where.reportTemplateId &&
              row.version === where.version
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `tver-${state.templateVersions.length + 1}`,
          tenantId: data.tenantId,
          reportTemplateId: data.reportTemplateId,
          version: data.version,
          label: data.label,
          status: data.status,
          storageRef: data.storageRef,
          manifestJson: data.manifestJson,
          deletedAt: null
        };
        state.templateVersions.push(row);
        return row;
      })
    },
    reportFieldValue: {
      findMany: vi.fn().mockResolvedValue([])
    },
    reportEvidenceLink: {
      findMany: vi.fn().mockResolvedValue([])
    },
    reportGenerationJob: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where.idempotencyKey) {
          const existing =
            state.jobs.find((row) => row.tenantId === where.tenantId && row.idempotencyKey === where.idempotencyKey) ?? null;
          if (!existing) return null;
          return {
            ...existing,
            templateVersion:
              state.templateVersions.find((row) => row.id === existing.templateVersionId)
                ? {
                    id: existing.templateVersionId,
                    version:
                      state.templateVersions.find((row) => row.id === existing.templateVersionId)!.version,
                    label:
                      state.templateVersions.find((row) => row.id === existing.templateVersionId)!.label
                  }
                : null,
            reportPack: null
          };
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const now = new Date();
        const row = {
          id: `job-${state.jobs.length + 1}`,
          tenantId: data.tenantId,
          assignmentId: data.assignmentId,
          templateVersionId: data.templateVersionId,
          templateKey: data.templateKey,
          reportFamily: data.reportFamily,
          idempotencyKey: data.idempotencyKey,
          status: data.status,
          attempts: 0,
          errorMessage: null,
          workerTrace: null,
          requestedByUserId: data.requestedByUserId ?? null,
          requestPayloadJson: data.requestPayloadJson,
          warningsJson: data.warningsJson,
          queuedAt: data.queuedAt ?? null,
          startedAt: null,
          finishedAt: null,
          createdAt: now,
          updatedAt: now,
          reportPackId: null
        };
        state.jobs.push(row);
        const version = state.templateVersions.find((item) => item.id === row.templateVersionId);
        return {
          ...row,
          templateVersion: version ? { id: version.id, version: version.version, label: version.label } : null,
          reportPack: null
        };
      })
    },
    reportAuditLog: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        state.auditLogs.push({ id: `audit-${state.auditLogs.length + 1}`, ...data, createdAt: new Date() });
        return state.auditLogs[state.auditLogs.length - 1];
      })
    }
  };

  return { tx, state };
};

const buildEvidenceTx = () => {
  const state = {
    evidenceLinks: [] as any[],
    auditLogs: [] as any[],
    documents: [
      {
        id: 'doc-1',
        tenantId,
        deletedAt: null,
        originalFilename: 'gps-photo.jpg',
        contentType: 'image/jpeg',
        sizeBytes: BigInt(2048),
        status: 'uploaded',
        classification: 'site_photo',
        source: 'mobile_camera',
        storageKey: 'objects/doc-1.jpg'
      }
    ]
  };

  const assignmentRow = {
    id: assignmentId,
    tenantId,
    title: 'Assignment',
    status: 'draft_in_progress',
    stage: 'data_collected'
  };

  const tx: any = {
    assignment: {
      findFirst: vi.fn().mockResolvedValue(assignmentRow)
    },
    document: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return state.documents.filter(
          (row) => row.tenantId === where.tenantId && where.id.in.includes(row.id) && row.deletedAt === null
        );
      })
    },
    reportEvidenceLink: {
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const before = state.evidenceLinks.length;
        state.evidenceLinks = state.evidenceLinks.filter((row) => {
          if (row.tenantId !== where.tenantId || row.assignmentId !== where.assignmentId || row.templateKey !== where.templateKey) {
            return true;
          }
          return !where.OR.some(
            (target: any) => row.sectionKey === target.sectionKey && (row.fieldKey ?? null) === (target.fieldKey ?? null)
          );
        });
        return { count: before - state.evidenceLinks.length };
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        return (
          state.evidenceLinks.find(
            (row) =>
              row.tenantId === where.tenantId &&
              row.assignmentId === where.assignmentId &&
              row.templateKey === where.templateKey &&
              row.sectionKey === where.sectionKey &&
              (row.fieldKey ?? null) === (where.fieldKey ?? null) &&
              row.documentId === where.documentId
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const now = new Date();
        const row = {
          id: `evidence-${state.evidenceLinks.length + 1}`,
          tenantId: data.tenantId,
          assignmentId: data.assignmentId,
          templateKey: data.templateKey,
          sectionKey: data.sectionKey,
          fieldKey: data.fieldKey ?? null,
          documentId: data.documentId,
          label: data.label ?? null,
          sortOrder: data.sortOrder ?? 0,
          metadataJson: data.metadataJson ?? {},
          ocrJson: data.ocrJson ?? null,
          createdByUserId: data.createdByUserId ?? null,
          createdAt: now,
          updatedAt: now
        };
        state.evidenceLinks.push(row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = state.evidenceLinks.find((item) => item.id === where.id);
        Object.assign(row, {
          ...data,
          updatedAt: new Date()
        });
        return row;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return state.evidenceLinks
          .filter(
            (row) =>
              row.tenantId === where.tenantId && row.assignmentId === where.assignmentId && row.templateKey === where.templateKey
          )
          .map((row) => ({
            ...row,
            document: state.documents.find((doc) => doc.id === row.documentId)
          }));
      })
    },
    reportFieldValue: {
      findMany: vi.fn().mockResolvedValue([])
    },
    reportGenerationJob: {
      findFirst: vi.fn().mockResolvedValue(null)
    },
    reportTemplate: {
      findFirst: vi.fn().mockResolvedValue(null)
    },
    reportAuditLog: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        state.auditLogs.push({ id: `audit-${state.auditLogs.length + 1}`, ...data, createdAt: new Date() });
        return state.auditLogs[state.auditLogs.length - 1];
      }),
      findMany: vi.fn().mockImplementation(async () => state.auditLogs.slice().reverse())
    }
  };

  return { tx, state };
};

describe('RepogenService', () => {
  it('returns the same generation job for repeated idempotency keys', async () => {
    const service = new RepogenService();
    const { tx, state } = buildTriggerTx();

    const first = await service.triggerGeneration(tx, assignmentId, 'user-1', {
      template_key: 'SBI_UNDER_5CR_V1',
      template_version: 1,
      report_family: 'valuation',
      idempotency_key: 'idem-1'
    });
    const second = await service.triggerGeneration(tx, assignmentId, 'user-1', {
      template_key: 'SBI_UNDER_5CR_V1',
      template_version: 1,
      report_family: 'valuation',
      idempotency_key: 'idem-1'
    });

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(first.job.id).toBe(second.job.id);
    expect(state.jobs).toHaveLength(1);
    expect(state.auditLogs.filter((row) => row.action === 'generation_requested')).toHaveLength(1);
  });

  it('persists evidence links and returns them in draft context', async () => {
    const service = new RepogenService();
    const { tx, state } = buildEvidenceTx();

    await service.upsertEvidenceLinks(tx, assignmentId, 'user-1', {
      template_key: 'SBI_UNDER_5CR_V1',
      replace_for_target: false,
      links: [
        {
          section_key: 'gps_photos',
          document_id: 'doc-1',
          label: 'GPS overlay photo'
        }
      ]
    });

    const context = await service.getDraftContext(tx, assignmentId, {
      template_key: 'SBI_UNDER_5CR_V1'
    });

    expect(state.evidenceLinks).toHaveLength(1);
    expect(context.evidence_links).toHaveLength(1);
    expect(context.evidence_links[0]?.section_key).toBe('gps_photos');
    expect(context.evidence_links[0]?.document.id).toBe('doc-1');
    expect(context.audit_timeline.some((row) => row.action === 'evidence_link_created')).toBe(true);
  });
});
