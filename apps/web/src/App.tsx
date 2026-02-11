import { useMemo, useState } from 'react';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

interface ReportRequestRow {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

interface ReportJobRow {
  id: string;
  status: string;
  reportRequestId: string;
  createdAt: string;
}

export default function App() {
  const [token, setToken] = useState('');
  const [requests, setRequests] = useState<ReportRequestRow[]>([]);
  const [jobs, setJobs] = useState<ReportJobRow[]>([]);
  const [query, setQuery] = useState('');

  const load = async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const [reqRes, jobRes] = await Promise.all([
      fetch(`${API}/report-requests`, { headers }),
      fetch(`${API}/report-jobs`, { headers })
    ]);
    if (reqRes.ok) {
      setRequests(await reqRes.json());
    }
    if (jobRes.ok) {
      setJobs(await jobRes.json());
    }
  };

  const filtered = useMemo(() => {
    if (!query) return requests;
    const q = query.toLowerCase();
    return requests.filter((item) => item.title.toLowerCase().includes(q) || item.status.toLowerCase().includes(q));
  }, [requests, query]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <section className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">Tenant Plane</p>
          <h1 className="m-0 text-3xl font-bold">ZenOps Internal Queue</h1>
          <p className="text-sm text-[var(--zen-muted)]">Tenant dashboard and Tenant #1 production queue.</p>
        </div>
        <div className="card w-full max-w-xl">
          <label className="text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Bearer Token</label>
          <div className="mt-2 flex gap-2">
            <input
              className="w-full rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste web token"
            />
            <Button onClick={load}>Load</Button>
          </div>
        </div>
      </section>

      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <article className="card">
          <p className="text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Report Requests</p>
          <p className="text-2xl font-bold">{requests.length}</p>
        </article>
        <article className="card">
          <p className="text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Report Jobs</p>
          <p className="text-2xl font-bold">{jobs.length}</p>
        </article>
        <article className="card">
          <p className="text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Draft Ready</p>
          <p className="text-2xl font-bold">{requests.filter((r) => r.status === 'draft_ready').length}</p>
        </article>
      </section>

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-xl">Production Queue</h2>
          <input
            className="w-full max-w-sm rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search status or title"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-[var(--zen-border)] p-2 text-left">Request</th>
                <th className="border-b border-[var(--zen-border)] p-2 text-left">Status</th>
                <th className="border-b border-[var(--zen-border)] p-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td className="border-b border-[var(--zen-border)] p-2">{row.title}</td>
                  <td className="border-b border-[var(--zen-border)] p-2">{row.status}</td>
                  <td className="border-b border-[var(--zen-border)] p-2">{new Date(row.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-sm text-[var(--zen-muted)]">No rows loaded.</p>}
        </div>
      </section>
    </main>
  );
}
