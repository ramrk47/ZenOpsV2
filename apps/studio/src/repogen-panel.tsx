import { useEffect, useState } from 'react';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

interface RepogenListRow {
  id: string;
  report_type: string;
  bank_type: string;
  bank_name: string;
  value_slab: string;
  template_selector: string;
  status: string;
  readiness_score: number | null;
  created_at: string;
}

interface RepogenListResponse {
  items: RepogenListRow[];
}

interface RepogenDetailResponse {
  work_order: Record<string, unknown>;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadList = async () => {
    if (!token) {
      setRows([]);
      setDetail(null);
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

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, token]);

  return (
    <section className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
      <section className="rounded-xl border border-[var(--zen-border)] bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="m-0 text-base">Repogen Work Orders</h3>
            <p className="m-0 text-xs text-[var(--zen-muted)]">Studio read-only monitor for M5.4 spine readiness.</p>
          </div>
          <Button className="h-9 px-3" onClick={() => void loadList()} disabled={loading || !token}>
            Refresh
          </Button>
        </div>
        {error ? <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="max-h-[70vh] space-y-2 overflow-auto">
          {rows.map((row) => (
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
                Readiness: {row.readiness_score ?? 'NA'} · {new Date(row.created_at).toLocaleString()}
              </p>
            </button>
          ))}
          {rows.length === 0 && !loading ? <p className="text-sm text-[var(--zen-muted)]">No repogen work orders yet.</p> : null}
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
            <div className="grid gap-3 md:grid-cols-3">
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
            <section className="rounded-lg border border-[var(--zen-border)] p-3">
              <h4 className="m-0 text-sm">Evidence List</h4>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(detail.evidence_items, null, 2)}</pre>
            </section>
            <section className="rounded-lg border border-[var(--zen-border)] p-3">
              <h4 className="m-0 text-sm">Manual Comments</h4>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--zen-panel)] p-3 text-xs">{JSON.stringify(detail.comments, null, 2)}</pre>
            </section>
          </div>
        )}
      </section>
    </section>
  );
}
