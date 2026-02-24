import { describe, expect, it } from 'vitest';
import { buildEvidenceChecklist, suggestEvidenceForMissingFields } from './logic.js';

describe('repogen evidence intelligence logic', () => {
  it('evaluates evidence checklist against profile item requirements', () => {
    const checklist = buildEvidenceChecklist(
      [
        {
          id: 'profile-photo-exterior',
          evidenceType: 'PHOTO',
          docType: null,
          minCount: 2,
          isRequired: true,
          tagsJson: { category: 'exterior' },
          orderHint: 10,
          label: 'Exterior Photos',
          fieldKeyHint: 'property.address'
        },
        {
          id: 'profile-doc-sale',
          evidenceType: 'DOCUMENT',
          docType: 'SALE_DEED',
          minCount: 1,
          isRequired: true,
          tagsJson: null,
          orderHint: 20,
          label: 'Sale Deed',
          fieldKeyHint: 'property.address'
        }
      ],
      [
        {
          id: 'e1',
          evidenceType: 'PHOTO',
          docType: null,
          tags: { category: 'exterior' },
          annexureOrder: null,
          createdAt: new Date('2026-02-24T10:00:00.000Z')
        },
        {
          id: 'e2',
          evidenceType: 'PHOTO',
          docType: null,
          tags: { category: 'interior' },
          annexureOrder: null,
          createdAt: new Date('2026-02-24T10:01:00.000Z')
        }
      ]
    );

    expect(checklist).toHaveLength(2);
    expect(checklist[0]).toMatchObject({
      id: 'profile-photo-exterior',
      current_count: 1,
      missing_count: 1,
      satisfied: false
    });
    expect(checklist[1]).toMatchObject({
      id: 'profile-doc-sale',
      current_count: 0,
      missing_count: 1,
      satisfied: false
    });
  });

  it('suggests evidence profile items for missing fields', () => {
    const suggestions = suggestEvidenceForMissingFields(
      ['property.address', 'valuation_inputs.guideline_rate_per_sqm'],
      [
        {
          id: 'p1',
          label: 'Sale Deed',
          field_key_hint: 'property.address',
          current_count: 0,
          min_count: 1,
          satisfied: false,
          is_required: true
        },
        {
          id: 'p2',
          label: 'Guideline Screenshot',
          field_key_hint: 'valuation_inputs.guideline_rate_per_sqm',
          current_count: 0,
          min_count: 1,
          satisfied: false,
          is_required: true
        }
      ]
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]?.field_key).toBe('property.address');
    expect(suggestions[1]?.field_key).toBe('valuation_inputs.guideline_rate_per_sqm');
  });
});
