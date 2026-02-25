import { FormEvent, useEffect, useState } from 'react';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

type RepogenStatus = 'DRAFT' | 'EVIDENCE_PENDING' | 'DATA_PENDING' | 'READY_FOR_RENDER' | 'CANCELLED' | 'CLOSED';

type WorkOrderListRow = {
  id: string;
  report_type: string;
  bank_type: string;
  bank_name: string;
  value_slab: string;
  template_selector: string;
  status: RepogenStatus;
  readiness_score: number | null;
  report_pack_id?: string | null;
  evidence_count?: number;
  created_at: string;
};

type WorkOrderListResponse = { items: WorkOrderListRow[] };

type WorkOrderDetailResponse = {
  work_order: Record<string, unknown> & {
    id?: string;
    status?: string;
    report_pack_id?: string | null;
    evidence_profile_id?: string | null;
  };
  latest_snapshot: {
    id: string;
    version: number;
    contract_json: Record<string, unknown>;
    derived_json: Record<string, unknown>;
    readiness_json: Record<string, unknown>;
  } | null;
  readiness: {
    completeness_score: number;
    missing_fields: string[];
    missing_evidence: string[];
    missing_field_evidence_links?: string[];
    warnings: string[];
  };
  evidence_items: Array<
    Record<string, unknown> & {
      id: string;
      evidence_type?: string;
      doc_type?: string | null;
      annexure_order?: number | null;
      tags?: Record<string, unknown> | null;
      document_id?: string | null;
      file_ref?: string | null;
    }
  >;
  field_evidence_links?: Array<
    Record<string, unknown> & {
      id: string;
      snapshot_id: string;
      field_key: string;
      evidence_item_id: string;
    }
  >;
  ocr_jobs?: Array<
    Record<string, unknown> & {
      id: string;
      evidence_item_id: string;
      status: string;
      requested_at: string;
      finished_at: string | null;
      result_json?: Record<string, unknown> | null;
      error?: string | null;
    }
  >;
  comments: Array<Record<string, unknown>>;
  rules_runs: Array<Record<string, unknown>>;
};

type EvidenceChecklistItem = {
  id: string;
  label: string;
  evidence_type: string;
  doc_type: string | null;
  min_count: number;
  is_required: boolean;
  tags_json: Record<string, unknown> | null;
  order_hint: number | null;
  field_key_hint: string | null;
  current_count: number;
  missing_count: number;
  satisfied: boolean;
  matching_evidence_item_ids: string[];
};

type RepogenEvidenceProfileItem = {
  id: string;
  evidence_type: string;
  doc_type: string | null;
  min_count: number;
  is_required: boolean;
  tags_json: Record<string, unknown> | null;
  order_hint: number | null;
  label: string | null;
  field_key_hint: string | null;
};

type RepogenEvidenceProfile = {
  id: string;
  name: string;
  report_type: string;
  bank_type: string;
  value_slab: string;
  is_default: boolean;
  metadata_json: Record<string, unknown>;
  items?: RepogenEvidenceProfileItem[];
};

type RepogenFieldDef = {
  id: string;
  field_key: string;
  label: string;
  data_type: string;
  required_by_default: boolean;
  unit: string | null;
};

type RepogenFieldEvidenceLinkRow = {
  id: string;
  snapshot_id: string;
  field_key: string;
  evidence_item_id: string;
  confidence: number | null;
  note: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

type RepogenEvidenceProfilesResponse = {
  work_order_id: string;
  selected_profile_id: string | null;
  selected_profile: RepogenEvidenceProfile | null;
  profiles: RepogenEvidenceProfile[];
  checklist: EvidenceChecklistItem[];
  suggested_evidence_for_missing_fields: Array<{
    field_key: string;
    suggested_items: Array<{
      profile_item_id: string;
      label: string;
      current_count: number;
      min_count: number;
      satisfied: boolean;
      is_required: boolean;
    }>;
  }>;
  field_defs: RepogenFieldDef[];
  readiness: WorkOrderDetailResponse['readiness'];
};

type RepogenFieldEvidenceLinksResponse = {
  work_order_id: string;
  latest_snapshot_id: string | null;
  latest_snapshot_version: number | null;
  field_defs: RepogenFieldDef[];
  links: RepogenFieldEvidenceLinkRow[];
  readiness?: WorkOrderDetailResponse['readiness'];
};

type RepogenOcrEnqueueResponse = {
  work_order_id: string;
  queue_enqueued: boolean;
  ocr_job: {
    id: string;
    evidence_item_id: string;
    status: string;
    requested_at: string;
    finished_at: string | null;
    result_json: Record<string, unknown> | null;
    error: string | null;
  };
};

type RepogenPackArtifact = {
  id: string;
  kind: string;
  filename: string;
  storage_ref: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type RepogenPackLinkResponse = {
  work_order_id: string;
  work_order_status: RepogenStatus;
  readiness_score: number | null;
  value_slab: string;
  template_selector: string;
  pack: {
    id: string;
    assignment_id: string;
    work_order_id: string | null;
    template_key: string;
    report_family: string;
    version: number;
    status: string;
    context_snapshot: Record<string, unknown> | null;
    artifacts: RepogenPackArtifact[];
    created_at: string;
    updated_at: string;
    generated_at: string | null;
  } | null;
  generation_job: {
    id: string;
    report_pack_id: string | null;
    status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | string;
    attempts: number;
    error_message: string | null;
    request_payload: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    queued_at: string | null;
    started_at: string | null;
    finished_at: string | null;
  } | null;
  deliverable_releases: Array<{
    id: string;
    released_at: string;
    billing_gate_result: 'PAID' | 'CREDIT_CONSUMED' | 'OVERRIDE' | 'BLOCKED';
    billing_mode_at_release: 'POSTPAID' | 'CREDIT';
    override_reason: string | null;
    idempotency_key: string;
    metadata_json: Record<string, unknown>;
  }>;
  billing_gate_status: {
    mode: 'POSTPAID' | 'CREDIT' | null;
    reservation_id_present: boolean;
    service_invoice_id: string | null;
    service_invoice_status: string | null;
    service_invoice_is_paid: boolean | null;
    releasable_without_override: boolean;
  } | null;
};

type RepogenCreatePackResponse = {
  idempotent: boolean;
  queue_enqueued: boolean;
  pack_link: RepogenPackLinkResponse;
};

type RepogenReleaseDeliverablesResponse = {
  idempotent: boolean;
  blocked: boolean;
  pack_link: RepogenPackLinkResponse;
  release: {
    id: string;
    billing_gate_result: string;
    billing_mode_at_release: string;
    released_at: string;
    override_reason: string | null;
  };
};

type DocumentsListItem = {
  id: string;
  original_filename: string | null;
  classification: string;
  source: string;
  created_at: string;
};

const statusOptions: RepogenStatus[] = ['DRAFT', 'EVIDENCE_PENDING', 'DATA_PENDING', 'READY_FOR_RENDER', 'CANCELLED', 'CLOSED'];
const reportTypeOptions = ['VALUATION', 'DPR', 'REVALUATION', 'STAGE_PROGRESS'] as const;
const bankTypeOptions = ['SBI', 'PSU_GENERIC', 'COOP', 'AGRI', 'OTHER'] as const;
const sourceTypeOptions = ['TENANT', 'EXTERNAL', 'CHANNEL'] as const;
const evidenceTypeOptions = ['DOCUMENT', 'PHOTO', 'SCREENSHOT', 'GEO', 'OTHER'] as const;
const docTypeOptions = ['SALE_DEED', 'RTC', 'EC', 'KHATA', 'TAX', 'NA_ORDER', 'PLAN', 'ID_PROOF', 'BANK_LETTER', 'OTHER'] as const;
const commentTypeOptions = ['JUSTIFICATION', 'ENCLOSURES', 'CHECKLIST', 'NOTES'] as const;

const readErrorBody = async (response: Response): Promise<string> => {
  const body = await response.text();
  return body || `HTTP ${response.status}`;
};

const makeRepogenIdempotencyKey = (scope: string, workOrderId: string): string =>
  `web:${scope}:${workOrderId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

const getEvidenceCategory = (row: WorkOrderDetailResponse['evidence_items'][number]): string => {
  const tags = row.tags;
  if (tags && typeof tags === 'object' && !Array.isArray(tags) && typeof (tags as any).category === 'string') {
    return ((tags as any).category as string).toLowerCase();
  }
  return '';
};

const annexureRank = (row: WorkOrderDetailResponse['evidence_items'][number]): number => {
  const category = getEvidenceCategory(row);
  if (category === 'exterior') return 10;
  if (category === 'interior') return 20;
  if (category === 'surroundings') return 30;
  if (category === 'gps') return 40;
  if (category === 'google_map') return 50;
  if (category === 'route_map') return 60;
  if ((row.evidence_type ?? '') === 'SCREENSHOT') return 70;
  if ((row.evidence_type ?? '') === 'GEO') return 80;
  if ((row.evidence_type ?? '') === 'PHOTO') return 90;
  if ((row.evidence_type ?? '') === 'DOCUMENT') return 100;
  return 200;
};

async function apiRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(await readErrorBody(response));
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

const defaultPatchJson = JSON.stringify(
  {
    property: {
      address: 'Site address / village',
      land_area: { value: 1200, unit: 'sqft' }
    },
    valuation_inputs: {
      market_rate_input: { value: 2500, unit: 'sqft' },
      guideline_rate_input: { value: 1800, unit: 'sqft' },
      land_value: 1800000,
      building_value: 2200000,
      depreciation_percent: 12
    },
    manual_fields: {
      justification_text: 'Manual justification placeholder'
    }
  },
  null,
  2
);

export function RepogenQueuePage({ token }: { token: string }) {
  const [rows, setRows] = useState<WorkOrderListRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<WorkOrderDetailResponse | null>(null);
  const [exportBundle, setExportBundle] = useState<Record<string, unknown> | null>(null);
  const [packLink, setPackLink] = useState<RepogenPackLinkResponse | null>(null);
  const [evidenceProfilesView, setEvidenceProfilesView] = useState<RepogenEvidenceProfilesResponse | null>(null);
  const [fieldEvidenceLinksView, setFieldEvidenceLinksView] = useState<RepogenFieldEvidenceLinksResponse | null>(null);
  const [documents, setDocuments] = useState<DocumentsListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [reportType, setReportType] = useState<(typeof reportTypeOptions)[number]>('VALUATION');
  const [bankType, setBankType] = useState<(typeof bankTypeOptions)[number]>('SBI');
  const [sourceType, setSourceType] = useState<(typeof sourceTypeOptions)[number]>('TENANT');
  const [bankName, setBankName] = useState('State Bank of India');
  const [sourceRefId, setSourceRefId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');

  const [patchJson, setPatchJson] = useState(defaultPatchJson);
  const [evidenceType, setEvidenceType] = useState<(typeof evidenceTypeOptions)[number]>('PHOTO');
  const [evidenceDocType, setEvidenceDocType] = useState<(typeof docTypeOptions)[number]>('OTHER');
  const [evidenceDocumentId, setEvidenceDocumentId] = useState('');
  const [evidenceFileRef, setEvidenceFileRef] = useState('');
  const [annexureOrder, setAnnexureOrder] = useState('');
  const [commentType, setCommentType] = useState<(typeof commentTypeOptions)[number]>('JUSTIFICATION');
  const [commentBody, setCommentBody] = useState('');
  const [nextStatus, setNextStatus] = useState<RepogenStatus>('EVIDENCE_PENDING');
  const [statusNote, setStatusNote] = useState('');
  const [releaseOverride, setReleaseOverride] = useState(false);
  const [releaseOverrideReason, setReleaseOverrideReason] = useState('');
  const [releaseIdempotencyKey, setReleaseIdempotencyKey] = useState('');
  const [selectedEvidenceProfileId, setSelectedEvidenceProfileId] = useState('');
  const [fieldLinkFieldKey, setFieldLinkFieldKey] = useState('');
  const [fieldLinkEvidenceItemId, setFieldLinkEvidenceItemId] = useState('');
  const [fieldLinkConfidence, setFieldLinkConfidence] = useState('1');
  const [fieldLinkNote, setFieldLinkNote] = useState('');

  const setErrorMessage = (value: string) => {
    setError(value);
    if (value) setNotice('');
  };

  const loadList = async () => {
    if (!token) {
      setRows([]);
      setDetail(null);
      setSelectedId('');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      const response = await apiRequest<WorkOrderListResponse>(token, '/repogen/work-orders');
      setRows(response.items ?? []);
      if (!selectedId && response.items?.[0]) {
        setSelectedId(response.items[0].id);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load repogen queue');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    if (!token || !id) {
      setDetail(null);
      setExportBundle(null);
      setPackLink(null);
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      const data = await apiRequest<WorkOrderDetailResponse>(token, `/repogen/work-orders/${id}`);
      setDetail(data);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load repogen work order');
    } finally {
      setLoading(false);
    }
  };

  const loadPackLink = async (id: string) => {
    if (!token || !id) {
      setPackLink(null);
      return;
    }
    try {
      const data = await apiRequest<RepogenPackLinkResponse>(token, `/repogen/work-orders/${id}/pack`);
      setPackLink(data);
    } catch (err) {
      setPackLink(null);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load pack linkage');
    }
  };

  const loadEvidenceProfilesView = async (id: string) => {
    if (!token || !id) {
      setEvidenceProfilesView(null);
      return;
    }
    try {
      const data = await apiRequest<RepogenEvidenceProfilesResponse>(token, `/repogen/work-orders/${id}/evidence-profiles`);
      setEvidenceProfilesView(data);
      setSelectedEvidenceProfileId(data.selected_profile_id ?? '');
      if (!fieldLinkFieldKey && data.field_defs[0]) {
        setFieldLinkFieldKey(data.field_defs[0].field_key);
      }
    } catch (err) {
      setEvidenceProfilesView(null);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load evidence profile checklist');
    }
  };

  const loadFieldEvidenceLinksView = async (id: string) => {
    if (!token || !id) {
      setFieldEvidenceLinksView(null);
      return;
    }
    try {
      const data = await apiRequest<RepogenFieldEvidenceLinksResponse>(token, `/repogen/work-orders/${id}/field-evidence-links`);
      setFieldEvidenceLinksView(data);
      if (!fieldLinkFieldKey && data.field_defs[0]) {
        setFieldLinkFieldKey(data.field_defs[0].field_key);
      }
    } catch (err) {
      setFieldEvidenceLinksView(null);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load field evidence links');
    }
  };

  const loadDocuments = async () => {
    if (!token) {
      setDocuments([]);
      return;
    }
    try {
      const data = await apiRequest<DocumentsListItem[]>(token, '/documents');
      setDocuments((data ?? []).slice(0, 20));
    } catch {
      // Keep UI usable even when docs list is unavailable.
      setDocuments([]);
    }
  };

  const loadExport = async (id: string) => {
    if (!token || !id) return;
    setWorking(true);
    setErrorMessage('');
    try {
      const data = await apiRequest<{ export_bundle: Record<string, unknown> }>(token, `/repogen/work-orders/${id}/export`);
      setExportBundle(data.export_bundle ?? null);
      setNotice('Export bundle refreshed');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load export bundle');
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    void loadList();
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
      void loadExport(selectedId);
      void loadPackLink(selectedId);
      void loadEvidenceProfilesView(selectedId);
      void loadFieldEvidenceLinksView(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, token]);

  const createWorkOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setWorking(true);
    setErrorMessage('');
    try {
      const payload: Record<string, unknown> = {
        report_type: reportType,
        bank_name: bankName,
        bank_type: bankType,
        source_type: sourceType
      };
      if (sourceRefId.trim()) payload.source_ref_id = sourceRefId.trim();
      if (assignmentId.trim()) payload.assignment_id = assignmentId.trim();
      const response = await apiRequest<{ work_order_id: string }>(token, '/repogen/work-orders', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setNotice(`Created work order ${response.work_order_id}`);
      await loadList();
      if (response.work_order_id) setSelectedId(response.work_order_id);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create work order');
    } finally {
      setWorking(false);
    }
  };

  const patchContract = async () => {
    if (!token || !selectedId) return;
    let parsedPatch: unknown;
    try {
      parsedPatch = JSON.parse(patchJson);
    } catch {
      setErrorMessage('Contract patch JSON is invalid');
      return;
    }

    setWorking(true);
    setErrorMessage('');
    try {
      await apiRequest(token, `/repogen/work-orders/${selectedId}/contract`, {
        method: 'PATCH',
        body: JSON.stringify({ patch: parsedPatch, ruleset_version: 'm5.4-v1' })
      });
      setNotice('Contract patched and snapshot recomputed');
      await loadList();
      await loadDetail(selectedId);
      await loadExport(selectedId);
      await loadPackLink(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadFieldEvidenceLinksView(selectedId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to patch contract');
    } finally {
      setWorking(false);
    }
  };

  const linkEvidence = async () => {
    if (!token || !selectedId) return;
    if (!evidenceDocumentId.trim() && !evidenceFileRef.trim()) {
      setErrorMessage('Provide a document_id or file_ref for evidence link');
      return;
    }
    setWorking(true);
    setErrorMessage('');
    try {
      const item: Record<string, unknown> = {
        evidence_type: evidenceType,
        doc_type: evidenceDocType,
        annexure_order: annexureOrder.trim() ? Number(annexureOrder) : null
      };
      if (evidenceDocumentId.trim()) item.document_id = evidenceDocumentId.trim();
      if (evidenceFileRef.trim()) item.file_ref = evidenceFileRef.trim();
      await apiRequest(token, `/repogen/work-orders/${selectedId}/evidence/link`, {
        method: 'POST',
        body: JSON.stringify({ items: [item] })
      });
      setNotice('Evidence linked');
      setEvidenceFileRef('');
      await loadDetail(selectedId);
      await loadExport(selectedId);
      await loadList();
      await loadPackLink(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadFieldEvidenceLinksView(selectedId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to link evidence');
    } finally {
      setWorking(false);
    }
  };

  const selectEvidenceProfile = async () => {
    if (!token || !selectedId) return;
    setWorking(true);
    setErrorMessage('');
    try {
      const payload =
        selectedEvidenceProfileId.trim().length > 0
          ? { profile_id: selectedEvidenceProfileId.trim() }
          : { use_default: true };
      const response = await apiRequest<RepogenEvidenceProfilesResponse>(token, `/repogen/work-orders/${selectedId}/evidence-profile`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setEvidenceProfilesView(response);
      setSelectedEvidenceProfileId(response.selected_profile_id ?? '');
      setNotice('Evidence profile updated');
      await loadList();
      await loadDetail(selectedId);
      await loadFieldEvidenceLinksView(selectedId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to select evidence profile');
    } finally {
      setWorking(false);
    }
  };

  const upsertFieldEvidenceLink = async () => {
    if (!token || !selectedId) return;
    if (!fieldLinkFieldKey.trim() || !fieldLinkEvidenceItemId.trim()) {
      setErrorMessage('Select a field and an evidence item');
      return;
    }
    setWorking(true);
    setErrorMessage('');
    try {
      const response = await apiRequest<RepogenFieldEvidenceLinksResponse>(token, `/repogen/work-orders/${selectedId}/field-evidence-links`, {
        method: 'POST',
        body: JSON.stringify({
          links: [
            {
              snapshot_id: fieldEvidenceLinksView?.latest_snapshot_id ?? undefined,
              field_key: fieldLinkFieldKey.trim(),
              evidence_item_id: fieldLinkEvidenceItemId.trim(),
              confidence: fieldLinkConfidence.trim() ? Number(fieldLinkConfidence) : undefined,
              note: fieldLinkNote.trim() || undefined
            }
          ]
        })
      });
      setFieldEvidenceLinksView(response);
      setNotice('Field linked to evidence');
      setFieldLinkNote('');
      await loadDetail(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadList();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to link field to evidence');
    } finally {
      setWorking(false);
    }
  };

  const removeFieldEvidenceLink = async (link: RepogenFieldEvidenceLinkRow) => {
    if (!token || !selectedId) return;
    setWorking(true);
    setErrorMessage('');
    try {
      const response = await apiRequest<RepogenFieldEvidenceLinksResponse>(token, `/repogen/work-orders/${selectedId}/field-evidence-links`, {
        method: 'POST',
        body: JSON.stringify({
          links: [
            {
              id: link.id,
              snapshot_id: link.snapshot_id,
              field_key: link.field_key,
              evidence_item_id: link.evidence_item_id,
              remove: true
            }
          ]
        })
      });
      setFieldEvidenceLinksView(response);
      setNotice('Field-evidence link removed');
      await loadDetail(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadList();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to remove field-evidence link');
    } finally {
      setWorking(false);
    }
  };

  const enqueueOcrPlaceholder = async (evidenceItemId: string) => {
    if (!token || !selectedId || !evidenceItemId) return;
    setWorking(true);
    setErrorMessage('');
    try {
      const result = await apiRequest<RepogenOcrEnqueueResponse>(token, `/repogen/work-orders/${selectedId}/ocr/enqueue`, {
        method: 'POST',
        body: JSON.stringify({ evidence_item_id: evidenceItemId })
      });
      setNotice(result.queue_enqueued ? `OCR placeholder queued (${result.ocr_job.id})` : `OCR job created (${result.ocr_job.id})`);
      await loadDetail(selectedId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to enqueue OCR placeholder');
    } finally {
      setWorking(false);
    }
  };

  const autoOrderAnnexure = async () => {
    if (!token || !selectedId || !detail?.evidence_items?.length) return;
    const sorted = detail.evidence_items
      .slice()
      .sort((a, b) => {
        const byRank = annexureRank(a) - annexureRank(b);
        if (byRank !== 0) return byRank;
        const byExisting = (typeof a.annexure_order === 'number' ? a.annexure_order : Number.MAX_SAFE_INTEGER) -
          (typeof b.annexure_order === 'number' ? b.annexure_order : Number.MAX_SAFE_INTEGER);
        if (byExisting !== 0) return byExisting;
        return String(a.id).localeCompare(String(b.id));
      });

    setWorking(true);
    setErrorMessage('');
    try {
      await apiRequest(token, `/repogen/work-orders/${selectedId}/evidence/link`, {
        method: 'POST',
        body: JSON.stringify({
          items: sorted.map((row, index) => ({
            id: row.id,
            evidence_type: row.evidence_type ?? 'OTHER',
            doc_type: row.doc_type ?? 'OTHER',
            document_id: row.document_id ?? undefined,
            file_ref: row.file_ref ?? undefined,
            annexure_order: index + 1,
            tags: row.tags ?? undefined
          }))
        })
      });
      setNotice('Annexure order auto-updated (editable)');
      await loadDetail(selectedId);
      await loadExport(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadList();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to auto-order annexure');
    } finally {
      setWorking(false);
    }
  };

  const markChecklistItemReceived = async (item: EvidenceChecklistItem) => {
    if (!token || !selectedId) return;
    setWorking(true);
    setErrorMessage('');
    try {
      await apiRequest(token, `/repogen/work-orders/${selectedId}/evidence/link`, {
        method: 'POST',
        body: JSON.stringify({
          items: [
            {
              evidence_type: item.evidence_type,
              doc_type: item.doc_type ?? 'OTHER',
              file_ref: `received://manual/${item.id}/${Date.now()}`,
              tags: item.tags_json ?? undefined,
              annexure_order: null
            }
          ]
        })
      });
      setNotice(`Marked received: ${item.label}`);
      await loadDetail(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadExport(selectedId);
      await loadList();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to mark checklist item as received');
    } finally {
      setWorking(false);
    }
  };

  const addComment = async () => {
    if (!token || !selectedId || !commentBody.trim()) return;
    setWorking(true);
    setErrorMessage('');
    try {
      await apiRequest(token, `/repogen/work-orders/${selectedId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ comment_type: commentType, body: commentBody.trim() })
      });
      setNotice(`${commentType} comment added`);
      setCommentBody('');
      await loadDetail(selectedId);
      await loadPackLink(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadFieldEvidenceLinksView(selectedId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to add comment');
    } finally {
      setWorking(false);
    }
  };

  const transitionStatus = async () => {
    if (!token || !selectedId) return;
    setWorking(true);
    setErrorMessage('');
    try {
      await apiRequest(token, `/repogen/work-orders/${selectedId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus, note: statusNote.trim() || undefined })
      });
      setNotice(`Status moved to ${nextStatus}`);
      await loadList();
      await loadDetail(selectedId);
      await loadExport(selectedId);
      await loadPackLink(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadFieldEvidenceLinksView(selectedId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to transition status');
    } finally {
      setWorking(false);
    }
  };

  const createPack = async () => {
    if (!token || !selectedId) return;
    setWorking(true);
    setErrorMessage('');
    try {
      const result = await apiRequest<RepogenCreatePackResponse>(token, `/repogen/work-orders/${selectedId}/create-pack`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      setPackLink(result.pack_link);
      setNotice(result.idempotent ? 'Existing pack linkage returned' : 'Pack created and generation queued');
      await loadList();
      await loadDetail(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadFieldEvidenceLinksView(selectedId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create pack');
    } finally {
      setWorking(false);
    }
  };

  const releaseDeliverables = async () => {
    if (!token || !selectedId || !packLink?.pack) return;
    if (releaseOverride && !releaseOverrideReason.trim()) {
      setErrorMessage('Override reason is required when override is selected');
      return;
    }

    const predictedGate = packLink.billing_gate_status?.releasable_without_override
      ? 'Expected: release allowed'
      : releaseOverride
        ? 'Expected: override release (audited)'
        : 'Expected: blocked by billing gate';
    if (!window.confirm(`Release deliverables for this pack?\n${predictedGate}`)) {
      return;
    }

    const idempotencyKey = releaseIdempotencyKey.trim() || makeRepogenIdempotencyKey('release', selectedId);
    if (!releaseIdempotencyKey.trim()) {
      setReleaseIdempotencyKey(idempotencyKey);
    }

    setWorking(true);
    setErrorMessage('');
    try {
      const result = await apiRequest<RepogenReleaseDeliverablesResponse>(
        token,
        `/repogen/work-orders/${selectedId}/release-deliverables`,
        {
          method: 'POST',
          body: JSON.stringify({
            idempotency_key: idempotencyKey,
            override: releaseOverride || undefined,
            override_reason: releaseOverride ? releaseOverrideReason.trim() : undefined
          })
        }
      );
      setPackLink(result.pack_link);
      setNotice(
        result.blocked
          ? `Release blocked by billing gate (${result.release.billing_mode_at_release})`
          : `Deliverables released (${result.release.billing_gate_result})`
      );
      await loadDetail(selectedId);
      await loadEvidenceProfilesView(selectedId);
      await loadFieldEvidenceLinksView(selectedId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to release deliverables');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[430px_minmax(0,1fr)]">
      <section className="card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg">Production Queue: Repogen</h2>
            <p className="m-0 text-sm text-[var(--zen-muted)]">M5.4 data spine workflow: evidence → contract → readiness → export (no DOCX).</p>
          </div>
          <Button className="h-9 px-3" onClick={() => void loadList()} disabled={!token || loading}>
            Refresh
          </Button>
        </div>

        <form className="mt-4 grid gap-2" onSubmit={createWorkOrder}>
          <p className="m-0 text-sm font-semibold">Create Work Order</p>
          <div className="grid gap-2 md:grid-cols-2">
            <select className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={reportType} onChange={(event) => setReportType(event.target.value as (typeof reportTypeOptions)[number])}>
              {reportTypeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <select className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={bankType} onChange={(event) => setBankType(event.target.value as (typeof bankTypeOptions)[number])}>
              {bankTypeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <select className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={sourceType} onChange={(event) => setSourceType(event.target.value as (typeof sourceTypeOptions)[number])}>
              {sourceTypeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <input className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={bankName} onChange={(event) => setBankName(event.target.value)} placeholder="Bank name" />
            <input className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={sourceRefId} onChange={(event) => setSourceRefId(event.target.value)} placeholder="source_ref_id (optional)" />
            <input className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)} placeholder="assignment_id (optional)" />
          </div>
          <div>
            <Button type="submit" disabled={!token || working}>Create Work Order</Button>
          </div>
        </form>

        <div className="mt-4 max-h-[55vh] space-y-2 overflow-auto">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSelectedId(row.id)}
              className={`w-full rounded-lg border p-3 text-left ${selectedId === row.id ? 'border-[var(--zen-primary)] bg-white' : 'border-[var(--zen-border)] bg-[var(--zen-panel)]'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{row.report_type}</strong>
                <span className="text-xs">{row.status}</span>
              </div>
              <div className="mt-1 text-sm">{row.bank_name}</div>
              <div className="mt-1 text-xs text-[var(--zen-muted)]">{row.bank_type} · {row.value_slab} · {row.template_selector}</div>
              <div className="mt-1 text-xs text-[var(--zen-muted)]">
                Readiness {row.readiness_score ?? 'NA'} · Evidence {row.evidence_count ?? 'NA'} · {row.report_pack_id ? 'Pack linked' : 'No pack'} · {new Date(row.created_at).toLocaleString()}
              </div>
            </button>
          ))}
          {rows.length === 0 && !loading ? <p className="text-sm text-[var(--zen-muted)]">No work orders yet.</p> : null}
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg">Repogen Work Order Detail</h2>
            <p className="m-0 text-sm text-[var(--zen-muted)]">Upload-first evidence linking, manual zones, readiness, and deterministic export snapshot.</p>
          </div>
          <div className="flex gap-2">
            <Button className="h-9 px-3" disabled={!selectedId || working} onClick={() => selectedId && void loadDetail(selectedId)}>Reload</Button>
            <Button className="h-9 px-3" disabled={!selectedId || working} onClick={() => selectedId && void loadExport(selectedId)}>Refresh Export</Button>
          </div>
        </div>

        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}

        {!detail ? (
          <p className="text-sm text-[var(--zen-muted)]">Select a work order to edit contract data, link evidence, add manual comments, and move statuses.</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-[var(--zen-border)] p-3">
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Status</p>
                <p className="m-0 mt-1 font-semibold">{String(detail.work_order.status ?? '')}</p>
              </div>
              <div className="rounded-lg border border-[var(--zen-border)] p-3">
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Readiness</p>
                <p className="m-0 mt-1 font-semibold">{detail.readiness.completeness_score}%</p>
              </div>
              <div className="rounded-lg border border-[var(--zen-border)] p-3">
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Snapshot</p>
                <p className="m-0 mt-1 font-semibold">{detail.latest_snapshot ? `v${detail.latest_snapshot.version}` : 'None'}</p>
              </div>
              <div className="rounded-lg border border-[var(--zen-border)] p-3">
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Evidence</p>
                <p className="m-0 mt-1 font-semibold">{detail.evidence_items.length}</p>
              </div>
            </div>

            <section className="rounded-lg border border-[var(--zen-border)] p-3">
              <h3 className="m-0 text-sm">Warnings / Missing Inputs</h3>
              <p className="m-0 mt-2 text-xs text-[var(--zen-muted)]">
                Next action:{' '}
                {detail.work_order.status !== 'READY_FOR_RENDER'
                  ? `Move to READY_FOR_RENDER after clearing missing items (${detail.readiness.missing_fields.length + detail.readiness.missing_evidence.length} missing)`
                  : !packLink?.pack
                    ? 'Create Pack'
                    : packLink.generation_job?.status !== 'completed'
                      ? `Wait for generation (${packLink?.generation_job?.status ?? 'unknown'})`
                      : packLink.deliverable_releases.some((row) => row.billing_gate_result !== 'BLOCKED')
                        ? 'Delivered / released'
                        : 'Release Deliverables'}
              </p>
              <ul className="mt-2 space-y-1 pl-4 text-sm">
                {detail.readiness.warnings.map((value, index) => <li key={`warn-${index}`}>{value}</li>)}
                {detail.readiness.missing_fields.map((value, index) => <li key={`field-${index}`}>Missing field: {value}</li>)}
                {detail.readiness.missing_evidence.map((value, index) => <li key={`evidence-${index}`}>Missing evidence: {value}</li>)}
                {(detail.readiness.missing_field_evidence_links ?? []).map((value, index) => (
                  <li key={`field-link-${index}`}>Field missing evidence link: {value}</li>
                ))}
                {detail.readiness.warnings.length === 0 &&
                  detail.readiness.missing_fields.length === 0 &&
                  detail.readiness.missing_evidence.length === 0 &&
                  (detail.readiness.missing_field_evidence_links ?? []).length === 0 ? <li>None</li> : null}
              </ul>
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <article className="rounded-lg border border-[var(--zen-border)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="m-0 text-sm">Evidence Checklist Panel</h3>
                    <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">
                      Profile-based requirements (M5.6). Missing evidence blocks READY_FOR_RENDER.
                    </p>
                  </div>
                  <Button className="h-8 px-3" disabled={working || !selectedId} onClick={() => selectedId && void loadEvidenceProfilesView(selectedId)}>
                    Reload
                  </Button>
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                  <select
                    className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
                    value={selectedEvidenceProfileId}
                    onChange={(event) => setSelectedEvidenceProfileId(event.target.value)}
                  >
                    <option value="">Use default profile</option>
                    {(evidenceProfilesView?.profiles ?? []).map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.bank_type}/{profile.value_slab}){profile.is_default ? ' [default]' : ''}
                      </option>
                    ))}
                  </select>
                  <Button className="h-10 px-3" disabled={working || !selectedId} onClick={() => void selectEvidenceProfile()}>
                    Save Profile
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button className="h-8 px-3" disabled={working || !detail.evidence_items.length} onClick={() => void autoOrderAnnexure()}>
                    Auto-order Annexure
                  </Button>
                  <span className="text-xs text-[var(--zen-muted)]">
                    Annexure rule order: exterior → interior → surroundings → GPS → screenshots (editable after auto-order).
                  </span>
                </div>

                <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                  {(evidenceProfilesView?.checklist ?? []).map((item) => (
                    <div key={item.id} className={`rounded border p-2 ${item.satisfied ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="m-0 text-sm font-semibold">{item.label}</p>
                          <p className="m-0 text-xs text-[var(--zen-muted)]">
                            {item.evidence_type}{item.doc_type ? `/${item.doc_type}` : ''} · min {item.min_count} · current {item.current_count}
                            {item.field_key_hint ? ` · field ${item.field_key_hint}` : ''}
                          </p>
                        </div>
                        <span className="text-xs">{item.satisfied ? 'OK' : `Missing ${item.missing_count}`}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          className="h-7 px-2 text-xs"
                          disabled={working}
                          onClick={() => {
                            setEvidenceType(item.evidence_type as (typeof evidenceTypeOptions)[number]);
                            setEvidenceDocType(((item.doc_type ?? 'OTHER') as (typeof docTypeOptions)[number]));
                            setNotice(`Prefilled evidence form for ${item.label}`);
                          }}
                        >
                          Add Doc Link
                        </Button>
                        <Button className="h-7 px-2 text-xs" disabled={working} onClick={() => void markChecklistItemReceived(item)}>
                          Mark as Received
                        </Button>
                        <Button
                          className="h-7 px-2 text-xs"
                          disabled={working || item.matching_evidence_item_ids.length === 0}
                          onClick={() => {
                            const target = detail.evidence_items.find((row) => item.matching_evidence_item_ids.includes(row.id));
                            if (target) setAnnexureOrder(String(target.annexure_order ?? ''));
                          }}
                        >
                          Set Annexure Order
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(evidenceProfilesView?.checklist ?? []).length === 0 ? (
                    <p className="text-sm text-[var(--zen-muted)]">No evidence profile/checklist loaded yet.</p>
                  ) : null}
                </div>

                <div className="mt-3 rounded-lg border border-[var(--zen-border)] p-2">
                  <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Suggested Evidence For Missing Fields</p>
                  <div className="mt-2 space-y-2">
                    {(evidenceProfilesView?.suggested_evidence_for_missing_fields ?? []).map((row) => (
                      <div key={row.field_key} className="rounded border border-[var(--zen-border)] bg-white p-2">
                        <p className="m-0 text-xs font-semibold">{row.field_key}</p>
                        <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">
                          {row.suggested_items.map((item) => `${item.label} (${item.current_count}/${item.min_count})`).join(' · ')}
                        </p>
                      </div>
                    ))}
                    {(evidenceProfilesView?.suggested_evidence_for_missing_fields ?? []).length === 0 ? (
                      <p className="text-xs text-[var(--zen-muted)]">No suggestions pending.</p>
                    ) : null}
                  </div>
                </div>
              </article>

              <article className="rounded-lg border border-[var(--zen-border)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="m-0 text-sm">Field ↔ Evidence Links (Audit)</h3>
                    <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">
                      Manual operator linking for current snapshot. Missing links warn in readiness.
                    </p>
                  </div>
                  <Button className="h-8 px-3" disabled={working || !selectedId} onClick={() => selectedId && void loadFieldEvidenceLinksView(selectedId)}>
                    Reload
                  </Button>
                </div>

                <div className="mt-2 grid gap-2">
                  <select
                    className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
                    value={fieldLinkFieldKey}
                    onChange={(event) => setFieldLinkFieldKey(event.target.value)}
                  >
                    <option value="">Select field</option>
                    {(fieldEvidenceLinksView?.field_defs ?? evidenceProfilesView?.field_defs ?? []).map((field) => (
                      <option key={field.id} value={field.field_key}>
                        {field.label} ({field.field_key})
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
                    value={fieldLinkEvidenceItemId}
                    onChange={(event) => setFieldLinkEvidenceItemId(event.target.value)}
                  >
                    <option value="">Select evidence item</option>
                    {detail.evidence_items.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.id} · {String(row.evidence_type ?? 'OTHER')} {row.doc_type ? `/${String(row.doc_type)}` : ''} · annex {row.annexure_order ?? 'NA'}
                      </option>
                    ))}
                  </select>
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
                      value={fieldLinkConfidence}
                      onChange={(event) => setFieldLinkConfidence(event.target.value)}
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      placeholder="confidence 0..1"
                    />
                    <input
                      className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
                      value={fieldLinkNote}
                      onChange={(event) => setFieldLinkNote(event.target.value)}
                      placeholder="link note (optional)"
                    />
                  </div>
                  <Button disabled={working || !fieldEvidenceLinksView?.latest_snapshot_id} onClick={() => void upsertFieldEvidenceLink()}>
                    Link Field to Evidence
                  </Button>
                  {!fieldEvidenceLinksView?.latest_snapshot_id ? (
                    <p className="m-0 text-xs text-[var(--zen-muted)]">Create/compute a contract snapshot first; field links are snapshot-scoped.</p>
                  ) : null}
                </div>

                <div className="mt-3 max-h-56 space-y-2 overflow-auto">
                  {(fieldEvidenceLinksView?.links ?? []).map((link) => (
                    <div key={link.id} className="rounded border border-[var(--zen-border)] bg-white p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="m-0 text-xs font-semibold">{link.field_key}</p>
                          <p className="m-0 text-xs text-[var(--zen-muted)]">
                            evidence {link.evidence_item_id} · confidence {link.confidence ?? 'NA'} · {new Date(link.created_at).toLocaleString()}
                          </p>
                        </div>
                        <Button className="h-7 px-2 text-xs" disabled={working} onClick={() => void removeFieldEvidenceLink(link)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(fieldEvidenceLinksView?.links ?? []).length === 0 ? <p className="text-xs text-[var(--zen-muted)]">No field-evidence links for current snapshot.</p> : null}
                </div>

                <div className="mt-3 rounded-lg border border-[var(--zen-border)] p-2">
                  <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">OCR Placeholder Queue</p>
                  <div className="mt-2 max-h-44 space-y-2 overflow-auto">
                    {detail.evidence_items.map((row) => {
                      const latestOcr = (detail.ocr_jobs ?? []).find((job) => job.evidence_item_id === row.id);
                      return (
                        <div key={`ocr-${row.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--zen-border)] bg-white p-2">
                          <div>
                            <p className="m-0 text-xs font-semibold">{row.id}</p>
                            <p className="m-0 text-xs text-[var(--zen-muted)]">
                              {String(row.evidence_type ?? 'OTHER')}{row.doc_type ? `/${String(row.doc_type)}` : ''} · OCR {latestOcr?.status ?? 'NOT_QUEUED'}
                            </p>
                          </div>
                          <Button className="h-7 px-2 text-xs" disabled={working} onClick={() => void enqueueOcrPlaceholder(row.id)}>
                            OCR Enqueue
                          </Button>
                        </div>
                      );
                    })}
                    {detail.evidence_items.length === 0 ? <p className="text-xs text-[var(--zen-muted)]">No evidence items yet.</p> : null}
                  </div>
                </div>
              </article>
            </section>

            <section className="rounded-lg border border-[var(--zen-border)] p-3">
              <h3 className="m-0 text-sm">Draft Contract Patch (JSON)</h3>
              <textarea className="mt-2 min-h-[220px] w-full rounded-lg border border-[var(--zen-border)] bg-white p-3 font-mono text-xs" value={patchJson} onChange={(event) => setPatchJson(event.target.value)} />
              <div className="mt-2">
                <Button disabled={working} onClick={() => void patchContract()}>Patch Contract + Compute</Button>
              </div>
            </section>

            <section className="grid gap-3 md:grid-cols-2">
              <article className="rounded-lg border border-[var(--zen-border)] p-3">
                <h3 className="m-0 text-sm">Link Evidence</h3>
                <div className="mt-2 grid gap-2">
                  <select className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={evidenceType} onChange={(event) => setEvidenceType(event.target.value as (typeof evidenceTypeOptions)[number])}>
                    {evidenceTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={evidenceDocType} onChange={(event) => setEvidenceDocType(event.target.value as (typeof docTypeOptions)[number])}>
                    {docTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={evidenceDocumentId} onChange={(event) => setEvidenceDocumentId(event.target.value)} placeholder="document_id" />
                  <input className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={evidenceFileRef} onChange={(event) => setEvidenceFileRef(event.target.value)} placeholder="file_ref (future external upload)" />
                  <input className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={annexureOrder} onChange={(event) => setAnnexureOrder(event.target.value)} placeholder="annexure_order" type="number" min={0} />
                  <Button disabled={working} onClick={() => void linkEvidence()}>Link Evidence</Button>
                </div>
                <div className="mt-3">
                  <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Recent Documents (click to pick)</p>
                  <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                    {documents.map((doc) => (
                      <button key={doc.id} type="button" className="w-full rounded border border-[var(--zen-border)] px-2 py-1 text-left text-xs hover:bg-[var(--zen-panel)]" onClick={() => setEvidenceDocumentId(doc.id)}>
                        {doc.original_filename ?? doc.id} · {doc.classification} · {doc.source}
                      </button>
                    ))}
                    {documents.length === 0 ? <p className="text-xs text-[var(--zen-muted)]">No visible documents (or endpoint unavailable).</p> : null}
                  </div>
                </div>
              </article>

              <article className="rounded-lg border border-[var(--zen-border)] p-3">
                <h3 className="m-0 text-sm">Manual Zones + Status</h3>
                <div className="mt-2 grid gap-2">
                  <select className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={commentType} onChange={(event) => setCommentType(event.target.value as (typeof commentTypeOptions)[number])}>
                    {commentTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <textarea className="min-h-24 rounded-lg border border-[var(--zen-border)] bg-white p-3 text-sm" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Justification / enclosures / checklist notes" />
                  <Button disabled={working || !commentBody.trim()} onClick={() => void addComment()}>Add Manual Comment</Button>

                  <hr className="my-1 border-[var(--zen-border)]" />

                  <select className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as RepogenStatus)}>
                    {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder="Status note (optional)" />
                  <Button disabled={working} onClick={() => void transitionStatus()}>Move Status</Button>
                </div>
              </article>
            </section>

            <section className="rounded-lg border border-[var(--zen-border)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="m-0 text-sm">Core Tenant Pack + Deliverables Release</h3>
                  <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">
                    M5.5 bridge: READY_FOR_RENDER auto-creates pack/job. Release is manual and billing-gated.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={working || detail.work_order.status !== 'READY_FOR_RENDER' || Boolean(packLink?.pack)}
                    onClick={() => void createPack()}
                  >
                    Create Pack
                  </Button>
                  <Button disabled={working || !selectedId} onClick={() => selectedId && void loadPackLink(selectedId)}>
                    Reload Pack
                  </Button>
                </div>
              </div>

              {!packLink ? (
                <p className="mt-3 text-sm text-[var(--zen-muted)]">Pack linkage not loaded.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-lg border border-[var(--zen-border)] p-3">
                      <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Template</p>
                      <p className="m-0 mt-1 text-sm font-semibold">{packLink.template_selector}</p>
                      <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">{packLink.value_slab}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--zen-border)] p-3">
                      <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Pack</p>
                      <p className="m-0 mt-1 text-sm font-semibold">{packLink.pack ? `${packLink.pack.status} · v${packLink.pack.version}` : 'Not created'}</p>
                      <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">{packLink.pack?.id ?? '—'}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--zen-border)] p-3">
                      <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Generation Job</p>
                      <p className="m-0 mt-1 text-sm font-semibold">{packLink.generation_job?.status ?? 'None'}</p>
                      <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">
                        Attempts {packLink.generation_job?.attempts ?? 0} · Artifacts {packLink.pack?.artifacts.length ?? 0}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[var(--zen-border)] p-3">
                      <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Billing Gate</p>
                      <p className="m-0 mt-1 text-sm font-semibold">{packLink.billing_gate_status?.mode ?? 'Unknown'}</p>
                      <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">
                        {packLink.billing_gate_status?.mode === 'CREDIT'
                          ? `Reservation ${packLink.billing_gate_status.reservation_id_present ? 'present' : 'missing'}`
                          : packLink.billing_gate_status?.mode === 'POSTPAID'
                            ? `Invoice ${packLink.billing_gate_status.service_invoice_status ?? 'missing'}`
                            : 'No billing hook yet'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--zen-border)] p-3">
                    <h4 className="m-0 text-sm">Release Deliverables (Manual)</h4>
                    <div className="mt-2 grid gap-2 md:grid-cols-[auto_1fr] md:items-center">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={releaseOverride}
                          onChange={(event) => setReleaseOverride(event.target.checked)}
                        />
                        Override billing gate
                      </label>
                      <input
                        className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
                        value={releaseOverrideReason}
                        onChange={(event) => setReleaseOverrideReason(event.target.value)}
                        placeholder="Override reason (required if override checked)"
                      />
                      <span className="text-xs text-[var(--zen-muted)] md:col-span-1">Idempotency key</span>
                      <input
                        className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
                        value={releaseIdempotencyKey}
                        onChange={(event) => setReleaseIdempotencyKey(event.target.value)}
                        placeholder="Optional; auto-generated if blank"
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        disabled={working || !packLink.pack || packLink.generation_job?.status !== 'completed'}
                        onClick={() => void releaseDeliverables()}
                      >
                        Release Deliverables
                      </Button>
                      <span className="text-xs text-[var(--zen-muted)]">
                        {packLink.generation_job?.status === 'completed'
                          ? packLink.billing_gate_status?.releasable_without_override
                            ? 'Release allowed without override'
                            : 'Billing gate will block unless override'
                          : 'Generation must complete before release'}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <article className="rounded-lg border border-[var(--zen-border)] p-3">
                      <h4 className="m-0 text-sm">Artifacts</h4>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">
                        {JSON.stringify(packLink.pack?.artifacts ?? [], null, 2)}
                      </pre>
                    </article>
                    <article className="rounded-lg border border-[var(--zen-border)] p-3">
                      <h4 className="m-0 text-sm">Release Events</h4>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">
                        {JSON.stringify(packLink.deliverable_releases ?? [], null, 2)}
                      </pre>
                    </article>
                  </div>
                </div>
              )}
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <article className="rounded-lg border border-[var(--zen-border)] p-3">
                <h3 className="m-0 text-sm">Derived JSON</h3>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(detail.latest_snapshot?.derived_json ?? {}, null, 2)}</pre>
              </article>
              <article className="rounded-lg border border-[var(--zen-border)] p-3">
                <h3 className="m-0 text-sm">Export Bundle JSON</h3>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(exportBundle ?? {}, null, 2)}</pre>
              </article>
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <article className="rounded-lg border border-[var(--zen-border)] p-3">
                <h3 className="m-0 text-sm">Evidence Items</h3>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(detail.evidence_items, null, 2)}</pre>
              </article>
              <article className="rounded-lg border border-[var(--zen-border)] p-3">
                <h3 className="m-0 text-sm">Manual Comments</h3>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(detail.comments, null, 2)}</pre>
              </article>
            </section>
          </>
        )}
      </section>
    </section>
  );
}
