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
  created_at: string;
};

type WorkOrderListResponse = { items: WorkOrderListRow[] };

type WorkOrderDetailResponse = {
  work_order: Record<string, unknown> & { id?: string; status?: string };
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
    warnings: string[];
  };
  evidence_items: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  rules_runs: Array<Record<string, unknown>>;
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
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to link evidence');
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
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to transition status');
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
              <div className="mt-1 text-xs text-[var(--zen-muted)]">Readiness {row.readiness_score ?? 'NA'} · {new Date(row.created_at).toLocaleString()}</div>
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
              <ul className="mt-2 space-y-1 pl-4 text-sm">
                {detail.readiness.warnings.map((value, index) => <li key={`warn-${index}`}>{value}</li>)}
                {detail.readiness.missing_fields.map((value, index) => <li key={`field-${index}`}>Missing field: {value}</li>)}
                {detail.readiness.missing_evidence.map((value, index) => <li key={`evidence-${index}`}>Missing evidence: {value}</li>)}
                {detail.readiness.warnings.length === 0 && detail.readiness.missing_fields.length === 0 && detail.readiness.missing_evidence.length === 0 ? <li>None</li> : null}
              </ul>
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
