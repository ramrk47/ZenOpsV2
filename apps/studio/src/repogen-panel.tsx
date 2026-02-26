import { useEffect, useState } from 'react';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

interface RepogenListRow {
  id: string;
  org_id?: string;
  report_type: string;
  bank_type: string;
  bank_name: string;
  value_slab: string;
  template_selector: string;
  status: string;
  readiness_score: number | null;
  report_pack_id?: string | null;
  billing?: {
    account_id?: string | null;
    mode_cache?: string | null;
  };
  created_at: string;
}

interface RepogenListResponse {
  items: RepogenListRow[];
}

interface RepogenDetailResponse {
  work_order: Record<string, unknown> & { org_id?: string; report_pack_id?: string | null; evidence_profile_id?: string | null };
  latest_snapshot: {
    id: string;
    version: number;
    contract_json: Record<string, unknown>;
    derived_json: Record<string, unknown>;
    readiness_json: Record<string, unknown>;
    created_at: string;
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
    }
  >;
  field_evidence_links?: Array<Record<string, unknown>>;
  ocr_jobs?: Array<Record<string, unknown> & { evidence_item_id?: string; status?: string }>;
  comments: Array<Record<string, unknown>>;
  rules_runs: Array<Record<string, unknown>>;
}

interface RepogenFieldDef {
  id: string;
  field_key: string;
  label: string;
}

interface EvidenceChecklistItem {
  id: string;
  label: string;
  evidence_type: string;
  doc_type: string | null;
  min_count: number;
  current_count: number;
  missing_count: number;
  satisfied: boolean;
  field_key_hint: string | null;
}

interface RepogenEvidenceProfilesResponse {
  work_order_id: string;
  selected_profile_id: string | null;
  profiles: Array<{
    id: string;
    name: string;
    bank_type: string;
    value_slab: string;
    is_default: boolean;
  }>;
  checklist: EvidenceChecklistItem[];
  suggested_evidence_for_missing_fields: Array<{
    field_key: string;
    suggested_items: Array<{ label: string; current_count: number; min_count: number }>;
  }>;
  field_defs: RepogenFieldDef[];
}

interface RepogenFieldEvidenceLinksResponse {
  work_order_id: string;
  latest_snapshot_id: string | null;
  latest_snapshot_version: number | null;
  field_defs: RepogenFieldDef[];
  links: Array<{
    id: string;
    snapshot_id: string;
    field_key: string;
    evidence_item_id: string;
    confidence: number | null;
    note: string | null;
    created_at: string;
  }>;
}

interface RepogenPackLinkResponse {
  work_order_id: string;
  pack: {
    id: string;
    assignment_id: string;
    template_key: string;
    version: number;
    status: string;
    artifacts: Array<Record<string, unknown>>;
    context_snapshot: Record<string, unknown> | null;
  } | null;
  generation_job: {
    id: string;
    status: string;
    attempts: number;
    error_message: string | null;
    queued_at: string | null;
    started_at: string | null;
    finished_at: string | null;
  } | null;
  deliverable_releases: Array<Record<string, unknown>>;
  billing_gate_status: {
    mode: string | null;
    reservation_id_present: boolean;
    service_invoice_id: string | null;
    service_invoice_status: string | null;
    service_invoice_is_paid: boolean | null;
    releasable_without_override: boolean;
  } | null;
}

export interface ArtifactInfo {
  id: string;
  kind: 'docx' | 'pdf' | 'zip';
  filename: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

const readError = async (response: Response): Promise<string> => {
  const text = await response.text();
  return text || `HTTP ${response.status}`;
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
    throw new Error(await readError(response));
  }

  return (await response.json()) as T;
}

export function RepogenStudioPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<RepogenListRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<RepogenDetailResponse | null>(null);
  const [packLink, setPackLink] = useState<RepogenPackLinkResponse | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [evidenceProfilesView, setEvidenceProfilesView] = useState<RepogenEvidenceProfilesResponse | null>(null);
  const [fieldLinksView, setFieldLinksView] = useState<RepogenFieldEvidenceLinksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [fieldLinkFieldKey, setFieldLinkFieldKey] = useState('');
  const [fieldLinkEvidenceId, setFieldLinkEvidenceId] = useState('');
  const [fieldLinkConfidence, setFieldLinkConfidence] = useState('1');
  const [fieldLinkNote, setFieldLinkNote] = useState('');

  const loadList = async () => {
    if (!token) {
      setRows([]);
      setDetail(null);
      setPackLink(null);
      setArtifacts([]);
      setSelectedId('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<RepogenListResponse>(token, '/repogen/work-orders');
      setRows(data.items ?? []);
      if (!selectedId && data.items[0]) {
        setSelectedId(data.items[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repogen work orders');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    if (!token || !id) {
      setDetail(null);
      setPackLink(null);
      setArtifacts([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<RepogenDetailResponse>(token, `/repogen/work-orders/${id}`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repogen detail');
    } finally {
      setLoading(false);
    }
  };

  const loadPackLink = async (id: string) => {
    if (!token || !id) {
      setPackLink(null);
      setArtifacts([]);
      return;
    }
    try {
      const data = await apiRequest<RepogenPackLinkResponse>(token, `/repogen/work-orders/${id}/pack`);
      setPackLink(data);

      if (data.pack?.id) {
        setArtifactsLoading(true);
        try {
          const artifactsData = await apiRequest<{ artifacts: ArtifactInfo[] }>(token, `/assignments/${id}/report-generation/packs/${data.pack.id}/artifacts`);
          setArtifacts(artifactsData.artifacts || []);
        } catch (err) {
          console.error('Failed to load artifacts', err);
          setArtifacts([]);
        } finally {
          setArtifactsLoading(false);
        }
      } else {
        setArtifacts([]);
      }
    } catch (err) {
      setPackLink(null);
      setArtifacts([]);
      setError(err instanceof Error ? err.message : 'Failed to load pack linkage');
    }
  };

  const handleFinalize = async (packId: string) => {
    if (!confirm('This will mark the current draft outputs as FINAL. Are you sure?')) return;
    try {
      setLoading(true);
      await apiRequest(token, `/assignments/${selectedId}/report-generation/packs/${packId}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Finalized from Studio' })
      });
      setNotice('Pack finalized successfully');
      await loadPackLink(selectedId);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize pack');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadArtifact = async (artifactId: string) => {
    try {
      setLoading(true);
      const res = await apiRequest<{ url: string; expiresAt: string }>(token, `/report-generation/artifacts/${artifactId}/presigned`);
      window.open(res.url, '_blank');
      setNotice('Opening presigned URL...');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get artifact URL');
    } finally {
      setLoading(false);
    }
  };

  const loadEvidenceProfiles = async (id: string) => {
    if (!token || !id) {
      setEvidenceProfilesView(null);
      return;
    }
    try {
      const data = await apiRequest<RepogenEvidenceProfilesResponse>(token, `/repogen/work-orders/${id}/evidence-profiles`);
      setEvidenceProfilesView(data);
      setSelectedProfileId(data.selected_profile_id ?? '');
      if (!fieldLinkFieldKey && data.field_defs[0]) {
        setFieldLinkFieldKey(data.field_defs[0].field_key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load evidence profiles');
    }
  };

  const loadFieldLinks = async (id: string) => {
    if (!token || !id) {
      setFieldLinksView(null);
      return;
    }
    try {
      const data = await apiRequest<RepogenFieldEvidenceLinksResponse>(token, `/repogen/work-orders/${id}/field-evidence-links`);
      setFieldLinksView(data);
      if (!fieldLinkFieldKey && data.field_defs[0]) {
        setFieldLinkFieldKey(data.field_defs[0].field_key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load field-evidence links');
    }
  };

  const selectEvidenceProfile = async () => {
    if (!token || !selectedId) return;
    setLoading(true);
    setError('');
    try {
      const payload = selectedProfileId ? { profile_id: selectedProfileId } : { use_default: true };
      const data = await apiRequest<RepogenEvidenceProfilesResponse>(token, `/repogen/work-orders/${selectedId}/evidence-profile`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setEvidenceProfilesView(data);
      setSelectedProfileId(data.selected_profile_id ?? '');
      setNotice('Evidence profile updated');
      await loadDetail(selectedId);
      await loadFieldLinks(selectedId);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update evidence profile');
    } finally {
      setLoading(false);
    }
  };

  const upsertFieldLink = async () => {
    if (!token || !selectedId || !fieldLinkFieldKey || !fieldLinkEvidenceId) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<RepogenFieldEvidenceLinksResponse>(token, `/repogen/work-orders/${selectedId}/field-evidence-links`, {
        method: 'POST',
        body: JSON.stringify({
          links: [
            {
              snapshot_id: fieldLinksView?.latest_snapshot_id ?? undefined,
              field_key: fieldLinkFieldKey,
              evidence_item_id: fieldLinkEvidenceId,
              confidence: fieldLinkConfidence.trim() ? Number(fieldLinkConfidence) : undefined,
              note: fieldLinkNote.trim() || undefined
            }
          ]
        })
      });
      setFieldLinksView(data);
      setFieldLinkNote('');
      setNotice('Field linked to evidence');
      await loadDetail(selectedId);
      await loadEvidenceProfiles(selectedId);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link field evidence');
    } finally {
      setLoading(false);
    }
  };

  const removeFieldLink = async (linkId: string, snapshotId: string, fieldKey: string, evidenceItemId: string) => {
    if (!token || !selectedId) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<RepogenFieldEvidenceLinksResponse>(token, `/repogen/work-orders/${selectedId}/field-evidence-links`, {
        method: 'POST',
        body: JSON.stringify({
          links: [
            {
              id: linkId,
              snapshot_id: snapshotId,
              field_key: fieldKey,
              evidence_item_id: evidenceItemId,
              remove: true
            }
          ]
        })
      });
      setFieldLinksView(data);
      setNotice('Field-evidence link removed');
      await loadDetail(selectedId);
      await loadEvidenceProfiles(selectedId);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove field-evidence link');
    } finally {
      setLoading(false);
    }
  };

  const filteredRows = rows.filter((row) => {
    const matchesTenant = tenantFilter.trim()
      ? (row.org_id ?? '').toLowerCase().includes(tenantFilter.trim().toLowerCase())
      : true;
    const matchesAccount = accountFilter.trim()
      ? (row.billing?.account_id ?? '').toLowerCase().includes(accountFilter.trim().toLowerCase())
      : true;
    return matchesTenant && matchesAccount;
  });

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
      void loadPackLink(selectedId);
      void loadEvidenceProfiles(selectedId);
      void loadFieldLinks(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, token]);

  return (
    <section className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
      <section className="rounded-xl border border-[var(--zen-border)] bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="m-0 text-base">Repogen Work Orders</h3>
            <p className="m-0 text-xs text-[var(--zen-muted)]">Control Plane monitor for M5.5 factory flow: readiness, pack linkage, jobs, and release events.</p>
          </div>
          <Button className="h-9 px-3" onClick={() => void loadList()} disabled={loading || !token}>
            Refresh
          </Button>
        </div>
        <div className="mb-3 grid gap-2 md:grid-cols-2">
          <input
            className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
            value={tenantFilter}
            onChange={(event) => setTenantFilter(event.target.value)}
            placeholder="Filter by tenant org_id"
          />
          <input
            className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
            value={accountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            placeholder="Filter by billing account_id"
          />
        </div>
        {error ? <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="max-h-[70vh] space-y-2 overflow-auto">
          {filteredRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSelectedId(row.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${selectedId === row.id ? 'border-[var(--zen-primary)] bg-[var(--zen-panel)]' : 'border-[var(--zen-border)] bg-white hover:bg-[var(--zen-panel)]'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{row.report_type}</strong>
                <span className="text-xs text-[var(--zen-muted)]">{row.status}</span>
              </div>
              <p className="m-0 mt-1 text-sm">{row.bank_name}</p>
              <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">
                {row.bank_type} · {row.value_slab} · {row.template_selector}
              </p>
              <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">
                Tenant: {row.org_id ?? 'NA'} · Account: {row.billing?.account_id ?? 'NA'} · {row.report_pack_id ? 'Pack linked' : 'No pack'} · Readiness: {row.readiness_score ?? 'NA'} · {new Date(row.created_at).toLocaleString()}
              </p>
            </button>
          ))}
          {filteredRows.length === 0 && !loading ? <p className="text-sm text-[var(--zen-muted)]">No repogen work orders match the filters.</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--zen-border)] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="m-0 text-base">Detail</h3>
          {selectedId ? (
            <Button className="h-9 px-3" onClick={() => void loadDetail(selectedId)} disabled={loading || !token}>
              Reload Detail
            </Button>
          ) : null}
        </div>
        {notice ? <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}
        {!detail ? (
          <p className="text-sm text-[var(--zen-muted)]">Select a work order to inspect snapshots, derived values, evidence, and comments.</p>
        ) : (
          <div className="space-y-4">
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
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--zen-muted)]">Pack / Job</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="m-0 mt-1 font-semibold">
                      {packLink?.pack ? `${packLink.pack.status} · v${packLink.pack.version}` : 'No pack'}
                    </p>
                    <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">{packLink?.generation_job?.status ?? 'No job'}</p>
                    {artifactsLoading && <p className="m-0 mt-1 text-xs text-blue-500">Loading artifacts...</p>}
                  </div>
                </div>
                {packLink?.pack && !artifactsLoading && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-[var(--zen-border)] pt-3">
                    {(() => {
                      const isPackFinal = packLink.pack?.status === 'finalized';
                      const docxDraft = artifacts.find(a => a.kind === 'docx');
                      const pdfDraft = artifacts.find(a => a.kind === 'pdf');
                      const zipFinal = artifacts.find(a => a.kind === 'zip');

                      const pdfHasError = pdfDraft?.metadata_json?.error;
                      const pdfHasWarning = pdfDraft?.metadata_json?.skipped;

                      if (!isPackFinal) {
                        return (
                          <>
                            {pdfDraft && !pdfHasError && !pdfHasWarning ? (
                              <Button
                                className="bg-slate-200 text-slate-800 hover:bg-slate-300 h-8 px-3 text-xs"
                                onClick={() => handleDownloadArtifact(pdfDraft.id)}
                              >
                                View Draft PDF
                              </Button>
                            ) : docxDraft ? (
                              <Button
                                className="border border-slate-300 bg-transparent text-slate-800 hover:bg-slate-50 h-8 px-3 text-xs"
                                onClick={() => handleDownloadArtifact(docxDraft.id)}
                              >
                                View Draft DOCX
                              </Button>
                            ) : null}

                            {pdfHasError && <span className="inline-flex max-w-max items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-800">PDF Failed</span>}
                            {pdfHasWarning && <span className="inline-flex max-w-max items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800">PDF Skipped</span>}

                            <Button
                              className="h-8 px-3 text-xs"
                              onClick={() => handleFinalize(packLink.pack!.id)}
                              disabled={packLink.generation_job?.status !== 'COMPLETED'}
                            >
                              Make Final
                            </Button>
                            {packLink.generation_job?.status !== 'COMPLETED' && (
                              <p className="text-[10px] text-[var(--zen-muted)] leading-tight">Must wait for generation to complete.</p>
                            )}
                          </>
                        );
                      } else {
                        return (
                          <>
                            {zipFinal && (
                              <Button
                                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3 text-xs"
                                onClick={() => handleDownloadArtifact(zipFinal.id)}
                              >
                                Download Pack (Final ZIP)
                              </Button>
                            )}
                            {pdfDraft ? (
                              <Button
                                className="border border-slate-300 bg-transparent text-slate-800 hover:bg-slate-50 h-8 px-3 text-xs"
                                onClick={() => handleDownloadArtifact(pdfDraft.id)}
                              >
                                View Final PDF
                              </Button>
                            ) : docxDraft ? (
                              <Button
                                className="border border-slate-300 bg-transparent text-slate-800 hover:bg-slate-50 h-8 px-3 text-xs"
                                onClick={() => handleDownloadArtifact(docxDraft.id)}
                              >
                                View Final DOCX
                              </Button>
                            ) : null}
                          </>
                        );
                      }
                    })()}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <section className="rounded-lg border border-[var(--zen-border)] p-3">
                <h4 className="m-0 text-sm">Warnings / Missing</h4>
                <ul className="mt-2 space-y-1 pl-4 text-sm">
                  {detail.readiness.warnings.map((item, idx) => (
                    <li key={`warn-${idx}`}>{item}</li>
                  ))}
                  {detail.readiness.missing_fields.map((item, idx) => (
                    <li key={`field-${idx}`}>Missing field: {item}</li>
                  ))}
                  {detail.readiness.missing_evidence.map((item, idx) => (
                    <li key={`evidence-${idx}`}>Missing evidence: {item}</li>
                  ))}
                  {(detail.readiness.missing_field_evidence_links ?? []).map((item, idx) => (
                    <li key={`field-link-${idx}`}>Field missing evidence link: {item}</li>
                  ))}
                  {detail.readiness.warnings.length === 0 &&
                    detail.readiness.missing_fields.length === 0 &&
                    detail.readiness.missing_evidence.length === 0 &&
                    (detail.readiness.missing_field_evidence_links ?? []).length === 0 ? (
                    <li>None</li>
                  ) : null}
                </ul>
              </section>
              <section className="rounded-lg border border-[var(--zen-border)] p-3">
                <h4 className="m-0 text-sm">Evidence / Comments</h4>
                <p className="m-0 mt-2 text-sm">Evidence items: {detail.evidence_items.length}</p>
                <p className="m-0 mt-1 text-sm">Manual comments: {detail.comments.length}</p>
                <p className="m-0 mt-1 text-sm">Rules runs: {detail.rules_runs.length}</p>
                <p className="m-0 mt-1 text-sm">OCR jobs: {detail.ocr_jobs?.length ?? 0}</p>
              </section>
            </div>

            <section className="grid gap-3 md:grid-cols-2">
              <section className="rounded-lg border border-[var(--zen-border)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="m-0 text-sm">Evidence Profile + Checklist</h4>
                    <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">M5.6 profile-based missing evidence and field-link suggestions.</p>
                  </div>
                  <Button className="h-8 px-3" onClick={() => selectedId && void loadEvidenceProfiles(selectedId)} disabled={loading || !selectedId}>
                    Reload
                  </Button>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                  <select
                    className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
                    value={selectedProfileId}
                    onChange={(event) => setSelectedProfileId(event.target.value)}
                  >
                    <option value="">Use default profile</option>
                    {(evidenceProfilesView?.profiles ?? []).map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.bank_type}/{profile.value_slab}){profile.is_default ? ' [default]' : ''}
                      </option>
                    ))}
                  </select>
                  <Button className="h-10 px-3" onClick={() => void selectEvidenceProfile()} disabled={loading || !selectedId}>
                    Save
                  </Button>
                </div>
                <div className="mt-3 max-h-52 space-y-2 overflow-auto">
                  {(evidenceProfilesView?.checklist ?? []).map((item) => (
                    <div key={item.id} className={`rounded border p-2 ${item.satisfied ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                      <p className="m-0 text-xs font-semibold">{item.label}</p>
                      <p className="m-0 text-xs text-[var(--zen-muted)]">
                        {item.evidence_type}{item.doc_type ? `/${item.doc_type}` : ''} · {item.current_count}/{item.min_count}
                        {item.field_key_hint ? ` · ${item.field_key_hint}` : ''}
                      </p>
                    </div>
                  ))}
                  {(evidenceProfilesView?.checklist ?? []).length === 0 ? <p className="text-xs text-[var(--zen-muted)]">No checklist data loaded.</p> : null}
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
                    {(evidenceProfilesView?.suggested_evidence_for_missing_fields ?? []).length === 0 ? <p className="text-xs text-[var(--zen-muted)]">None</p> : null}
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-[var(--zen-border)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="m-0 text-sm">Field ↔ Evidence Linking</h4>
                    <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">Manual dropdown linking, audit-visible via notes timeline.</p>
                  </div>
                  <Button className="h-8 px-3" onClick={() => selectedId && void loadFieldLinks(selectedId)} disabled={loading || !selectedId}>
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
                    {(fieldLinksView?.field_defs ?? evidenceProfilesView?.field_defs ?? []).map((field) => (
                      <option key={field.id} value={field.field_key}>
                        {field.label} ({field.field_key})
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
                    value={fieldLinkEvidenceId}
                    onChange={(event) => setFieldLinkEvidenceId(event.target.value)}
                  >
                    <option value="">Select evidence item</option>
                    {detail.evidence_items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.id} · {String(item.evidence_type ?? 'OTHER')}{item.doc_type ? `/${String(item.doc_type)}` : ''} · annex {item.annexure_order ?? 'NA'}
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
                      placeholder="note"
                    />
                  </div>
                  <Button disabled={loading || !fieldLinksView?.latest_snapshot_id} onClick={() => void upsertFieldLink()}>
                    Link Field
                  </Button>
                </div>
                <div className="mt-3 max-h-52 space-y-2 overflow-auto">
                  {(fieldLinksView?.links ?? []).map((link) => (
                    <div key={link.id} className="rounded border border-[var(--zen-border)] bg-white p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="m-0 text-xs font-semibold">{link.field_key}</p>
                          <p className="m-0 text-xs text-[var(--zen-muted)]">
                            evidence {link.evidence_item_id} · confidence {link.confidence ?? 'NA'}
                          </p>
                        </div>
                        <Button className="h-7 px-2 text-xs" disabled={loading} onClick={() => void removeFieldLink(link.id, link.snapshot_id, link.field_key, link.evidence_item_id)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(fieldLinksView?.links ?? []).length === 0 ? <p className="text-xs text-[var(--zen-muted)]">No links for current snapshot.</p> : null}
                </div>
              </section>
            </section>

            <section className="rounded-lg border border-[var(--zen-border)] p-3">
              <h4 className="m-0 text-sm">Latest Snapshot JSON</h4>
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(detail.latest_snapshot, null, 2)}</pre>
            </section>
            <section className="rounded-lg border border-[var(--zen-border)] p-3">
              <h4 className="m-0 text-sm">Derived Values</h4>
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(detail.latest_snapshot?.derived_json ?? {}, null, 2)}</pre>
            </section>
            <section className="grid gap-3 md:grid-cols-2">
              <section className="rounded-lg border border-[var(--zen-border)] p-3">
                <h4 className="m-0 text-sm">Factory Pack / Billing Gate</h4>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(packLink, null, 2)}</pre>
              </section>
              <section className="rounded-lg border border-[var(--zen-border)] p-3">
                <h4 className="m-0 text-sm">Release Events</h4>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(packLink?.deliverable_releases ?? [], null, 2)}</pre>
              </section>
            </section>
            <section className="rounded-lg border border-[var(--zen-border)] p-3">
              <h4 className="m-0 text-sm">Evidence List</h4>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(detail.evidence_items, null, 2)}</pre>
            </section>
            <section className="rounded-lg border border-[var(--zen-border)] p-3">
              <h4 className="m-0 text-sm">Audit Timeline (Rules + Comments + Releases)</h4>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">
                {JSON.stringify(
                  [
                    ...detail.comments.map((item) => ({ type: 'comment', ...item })),
                    ...detail.rules_runs.map((item) => ({ type: 'rules_run', ...item })),
                    ...(packLink?.deliverable_releases ?? []).map((item) => ({ type: 'deliverable_release', ...item }))
                  ],
                  null,
                  2
                )}
              </pre>
            </section>
          </div>
        )}
      </section>
    </section>
  );
}
