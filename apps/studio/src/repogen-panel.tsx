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
  work_order: Record<string, unknown> & { org_id?: string; report_pack_id?: string | null };
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
    warnings: string[];
  };
  evidence_items: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  rules_runs: Array<Record<string, unknown>>;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');

  const loadList = async () => {
    if (!token) {
      setRows([]);
      setDetail(null);
      setPackLink(null);
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
      return;
    }
    try {
      const data = await apiRequest<RepogenPackLinkResponse>(token, `/repogen/work-orders/${id}/pack`);
      setPackLink(data);
    } catch (err) {
      setPackLink(null);
      setError(err instanceof Error ? err.message : 'Failed to load pack linkage');
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, token]);

  return (
    <section className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
      <section className="rounded-xl border border-[var(--zen-border)] bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="m-0 text-base">Repogen Work Orders</h3>
            <p className="m-0 text-xs text-[var(--zen-muted)]">Studio monitor for M5.5 factory flow: readiness, pack linkage, jobs, and release events.</p>
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
                <p className="m-0 mt-1 font-semibold">
                  {packLink?.pack ? `${packLink.pack.status} · v${packLink.pack.version}` : 'No pack'}
                </p>
                <p className="m-0 mt-1 text-xs text-[var(--zen-muted)]">{packLink?.generation_job?.status ?? 'No job'}</p>
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
                  {detail.readiness.warnings.length === 0 &&
                  detail.readiness.missing_fields.length === 0 &&
                  detail.readiness.missing_evidence.length === 0 ? (
                    <li>None</li>
                  ) : null}
                </ul>
              </section>
              <section className="rounded-lg border border-[var(--zen-border)] p-3">
                <h4 className="m-0 text-sm">Evidence / Comments</h4>
                <p className="m-0 mt-2 text-sm">Evidence items: {detail.evidence_items.length}</p>
                <p className="m-0 mt-1 text-sm">Manual comments: {detail.comments.length}</p>
                <p className="m-0 mt-1 text-sm">Rules runs: {detail.rules_runs.length}</p>
              </section>
            </div>

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
