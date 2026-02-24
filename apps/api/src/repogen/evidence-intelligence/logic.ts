type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface EvidenceProfileItemLike {
  id: string;
  evidenceType: string;
  docType: string | null;
  minCount: number;
  isRequired: boolean;
  tagsJson: unknown;
  orderHint: number | null;
  label: string | null;
  fieldKeyHint: string | null;
}

export interface EvidenceItemLike {
  id: string;
  evidenceType: string;
  docType: string | null;
  tags: unknown;
  annexureOrder: number | null;
  createdAt: Date;
}

export const profileItemMatchesEvidence = (item: EvidenceProfileItemLike, evidence: EvidenceItemLike): boolean => {
  if (item.evidenceType !== evidence.evidenceType) return false;
  if (item.docType && item.docType !== evidence.docType) return false;

  if (item.tagsJson && isRecord(item.tagsJson)) {
    const evidenceTags = isRecord(evidence.tags) ? evidence.tags : {};
    for (const [key, expected] of Object.entries(item.tagsJson)) {
      if (evidenceTags[key] !== expected) {
        return false;
      }
    }
  }

  return true;
};

export const buildEvidenceChecklist = (items: EvidenceProfileItemLike[], evidenceRows: EvidenceItemLike[]) => {
  const ordered = items
    .slice()
    .sort((a, b) => (a.orderHint ?? Number.MAX_SAFE_INTEGER) - (b.orderHint ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));

  return ordered.map((item) => {
    const matches = evidenceRows.filter((evidence) => profileItemMatchesEvidence(item, evidence));
    const count = matches.length;
    const requiredMin = item.isRequired ? Math.max(item.minCount, 0) : Math.max(item.minCount, 0);
    const satisfied = item.isRequired ? count >= requiredMin : count >= requiredMin;
    return {
      id: item.id,
      label: item.label ?? `${item.evidenceType}${item.docType ? `:${item.docType}` : ''}`,
      evidence_type: item.evidenceType,
      doc_type: item.docType,
      min_count: item.minCount,
      is_required: item.isRequired,
      tags_json: isRecord(item.tagsJson) ? (item.tagsJson as JsonRecord) : null,
      order_hint: item.orderHint,
      field_key_hint: item.fieldKeyHint,
      current_count: count,
      missing_count: Math.max(0, requiredMin - count),
      satisfied,
      matching_evidence_item_ids: matches.map((row) => row.id)
    };
  });
};

export const suggestEvidenceForMissingFields = (
  missingFieldKeys: string[],
  checklist: Array<{
    id: string;
    label: string;
    field_key_hint: string | null;
    current_count: number;
    min_count: number;
    satisfied: boolean;
    is_required: boolean;
  }>
) => {
  const normalizedMissing = new Set(missingFieldKeys.map((key) => key.trim()).filter(Boolean));
  const suggestions: Array<{
    field_key: string;
    suggested_items: Array<{
      profile_item_id: string;
      label: string;
      current_count: number;
      min_count: number;
      satisfied: boolean;
      is_required: boolean;
    }>;
  }> = [];

  for (const fieldKey of normalizedMissing) {
    const items = checklist
      .filter((item) => item.field_key_hint === fieldKey)
      .map((item) => ({
        profile_item_id: item.id,
        label: item.label,
        current_count: item.current_count,
        min_count: item.min_count,
        satisfied: item.satisfied,
        is_required: item.is_required
      }));
    if (items.length > 0) {
      suggestions.push({ field_key: fieldKey, suggested_items: items });
    }
  }

  return suggestions;
};

const annexureCategoryRank = (evidence: EvidenceItemLike): number => {
  const tags = isRecord(evidence.tags) ? evidence.tags : {};
  const category = typeof tags.category === 'string' ? tags.category.toLowerCase() : '';

  if (category === 'exterior') return 10;
  if (category === 'interior') return 20;
  if (category === 'surroundings') return 30;
  if (category === 'gps') return 40;
  if (category === 'google_map') return 50;
  if (category === 'route_map') return 60;
  if (evidence.evidenceType === 'SCREENSHOT') return 70;
  if (evidence.evidenceType === 'GEO') return 80;
  if (evidence.evidenceType === 'PHOTO') return 90;
  if (evidence.evidenceType === 'DOCUMENT') return 100;
  return 200;
};

export const buildAutoAnnexureOrder = (evidenceRows: EvidenceItemLike[]) => {
  const sorted = evidenceRows
    .slice()
    .sort((a, b) => {
      const byCategory = annexureCategoryRank(a) - annexureCategoryRank(b);
      if (byCategory !== 0) return byCategory;
      const byExistingOrder = (a.annexureOrder ?? Number.MAX_SAFE_INTEGER) - (b.annexureOrder ?? Number.MAX_SAFE_INTEGER);
      if (byExistingOrder !== 0) return byExistingOrder;
      const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
      if (byCreatedAt !== 0) return byCreatedAt;
      return a.id.localeCompare(b.id);
    });

  return sorted.map((row, index) => ({
    evidence_item_id: row.id,
    annexure_order: index + 1
  }));
};

