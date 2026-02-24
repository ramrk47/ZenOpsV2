import { describe, expect, it, vi } from 'vitest';
import { RepogenEvidenceIntelligenceService } from './evidence-intelligence.service.js';

describe('RepogenEvidenceIntelligenceService', () => {
  it('persists field-evidence links and writes an audit note', async () => {
    const state = {
      workOrder: {
        id: 'wo-1',
        orgId: '11111111-1111-1111-1111-111111111111',
        reportType: 'VALUATION',
        bankType: 'SBI',
        valueSlab: 'LT_5CR',
        evidenceProfileId: 'profile-1',
        status: 'DATA_PENDING',
        bankName: 'SBI'
      },
      latestSnapshot: {
        id: 'snap-2',
        version: 2,
        createdAt: new Date('2026-02-24T10:00:00.000Z')
      },
      fieldDefs: [
        {
          id: 'fd-1',
          fieldKey: 'property.address',
          label: 'Property Address',
          dataType: 'text',
          requiredByDefault: true,
          unit: null,
          metadataJson: {},
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      evidenceItems: [{ id: 'evidence-1' }],
      fieldLinks: [] as any[],
      comments: [] as any[]
    };

    const tx: any = {
      repogenWorkOrder: {
        findFirst: vi.fn().mockResolvedValue(state.workOrder)
      },
      repogenContractSnapshot: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.id) {
            return where.id === state.latestSnapshot.id ? { id: state.latestSnapshot.id, version: state.latestSnapshot.version } : null;
          }
          return state.latestSnapshot;
        })
      },
      repogenEvidenceItem: {
        findMany: vi.fn().mockResolvedValue(state.evidenceItems)
      },
      repogenFieldEvidenceLink: {
        findMany: vi.fn().mockImplementation(async ({ where }: any) => {
          const rows = state.fieldLinks.filter(
            (row) => row.workOrderId === where.workOrderId && (!where.snapshotId || row.snapshotId === where.snapshotId)
          );
          return rows.map((row) => ({
            id: row.id,
            snapshotId: row.snapshotId,
            fieldKey: row.fieldKey,
            evidenceItemId: row.evidenceItemId,
            confidence: row.confidence,
            note: row.note,
            createdByUserId: row.createdByUserId,
            createdAt: row.createdAt
          }));
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          return (
            state.fieldLinks.find(
              (row) =>
                (where.id ? row.id === where.id : true) &&
                (where.workOrderId ? row.workOrderId === where.workOrderId : true) &&
                (where.snapshotId ? row.snapshotId === where.snapshotId : true) &&
                (where.fieldKey ? row.fieldKey === where.fieldKey : true) &&
                (where.evidenceItemId ? row.evidenceItemId === where.evidenceItemId : true)
            ) ?? null
          );
        }),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          const row = {
            id: `link-${state.fieldLinks.length + 1}`,
            ...data,
            createdAt: new Date('2026-02-24T10:05:00.000Z')
          };
          state.fieldLinks.push(row);
          return row;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => {
          const row = state.fieldLinks.find((item) => item.id === where.id);
          if (!row) throw new Error('link not found');
          Object.assign(row, data);
          return row;
        }),
        delete: vi.fn().mockImplementation(async ({ where }: any) => {
          const index = state.fieldLinks.findIndex((item) => item.id === where.id);
          if (index >= 0) {
            state.fieldLinks.splice(index, 1);
          }
          return { id: where.id };
        }),
        deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
          const before = state.fieldLinks.length;
          state.fieldLinks = state.fieldLinks.filter(
            (row) =>
              !(
                row.workOrderId === where.workOrderId &&
                row.snapshotId === where.snapshotId &&
                row.fieldKey === where.fieldKey &&
                row.evidenceItemId === where.evidenceItemId
              )
          );
          return { count: before - state.fieldLinks.length };
        })
      },
      repogenComment: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `comment-${state.comments.length + 1}`, ...data };
          state.comments.push(row);
          return row;
        })
      },
      repogenFieldDef: {
        findMany: vi.fn().mockResolvedValue(state.fieldDefs)
      }
    };

    const spineService = {
      getWorkOrderDetail: vi.fn().mockResolvedValue({
        readiness: {
          completeness_score: 75,
          missing_fields: [],
          missing_evidence: [],
          missing_field_evidence_links: ['party.bank_name'],
          warnings: ['Field evidence links missing for 1 required field(s).']
        }
      })
    } as any;

    const service = new RepogenEvidenceIntelligenceService(spineService);

    const result = await service.upsertFieldEvidenceLinks(tx, 'wo-1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', {
      links: [
        {
          field_key: 'property.address',
          evidence_item_id: 'evidence-1',
          confidence: 0.9,
          note: 'Manual operator link'
        }
      ]
    });

    expect(state.fieldLinks).toHaveLength(1);
    expect(state.fieldLinks[0]).toMatchObject({
      fieldKey: 'property.address',
      evidenceItemId: 'evidence-1',
      snapshotId: 'snap-2'
    });
    expect(tx.repogenComment.create).toHaveBeenCalledTimes(1);
    expect(String(state.comments[0]?.body ?? '')).toContain('Field evidence links updated');
    expect(String(state.comments[0]?.body ?? '')).toContain('Linked property.address <- evidence-1');
    expect(result.links).toHaveLength(1);
    expect(result.readiness.completeness_score).toBe(75);
  });
});
