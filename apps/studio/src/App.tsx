import { useState } from 'react';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

interface ReportJob {
  id: string;
  status: string;
  reportRequestId: string;
  createdAt: string;
}

interface ReportRequest {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

export default function App() {
  const [token, setToken] = useState('');
  const [jobs, setJobs] = useState<ReportJob[]>([]);
  const [requests, setRequests] = useState<ReportRequest[]>([]);

  const load = async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const [jobsRes, reqRes] = await Promise.all([
      fetch(`${API}/studio/report-jobs`, { headers }),
      fetch(`${API}/report-requests`, { headers })
    ]);

    if (jobsRes.ok) {
      setJobs(await jobsRes.json());
    } else {
      setJobs([]);
    }

    if (reqRes.ok) {
      setRequests(await reqRes.json());
    } else {
      setRequests([]);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">Studio Plane</p>
          <h1 className="m-0 text-3xl font-bold">Control Plane Diagnostics</h1>
          <p className="text-sm text-[var(--zen-muted)]">Read-only cross-tenant views gated by aud=studio.</p>
        </div>
        <section className="panel p-4">
          <label className="text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Studio Token</label>
          <div className="mt-2 flex gap-2">
            <input
              className="w-full rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste studio token"
            />
            <Button onClick={load}>Load</Button>
          </div>
        </section>
      </header>

      <section className="mb-6 grid gap-4 md:grid-cols-2">
        <article className="panel p-4">
          <h2 className="mt-0 text-lg">Report Jobs</h2>
          <ul className="m-0 list-none space-y-2 p-0 text-sm">
            {jobs.map((job) => (
              <li key={job.id} className="rounded-md border border-[var(--zen-border)] p-2">
                <strong>{job.status}</strong> · {job.reportRequestId}
              </li>
            ))}
          </ul>
          {jobs.length === 0 && <p className="text-sm text-[var(--zen-muted)]">No jobs visible.</p>}
        </article>

        <article className="panel p-4">
          <h2 className="mt-0 text-lg">Report Requests</h2>
          <ul className="m-0 list-none space-y-2 p-0 text-sm">
            {requests.map((request) => (
              <li key={request.id} className="rounded-md border border-[var(--zen-border)] p-2">
                <strong>{request.title}</strong> · {request.status}
              </li>
            ))}
          </ul>
          {requests.length === 0 && <p className="text-sm text-[var(--zen-muted)]">No requests visible.</p>}
        </article>
      </section>

      <section className="panel p-4">
        <h2 className="mt-0 text-lg">Template Placeholders</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <article className="rounded-md border border-[var(--zen-border)] p-3">
            <h3 className="m-0 text-base">Residential v2</h3>
            <p className="text-sm text-[var(--zen-muted)]">Workflow hooks pending.</p>
          </article>
          <article className="rounded-md border border-[var(--zen-border)] p-3">
            <h3 className="m-0 text-base">Commercial Lite</h3>
            <p className="text-sm text-[var(--zen-muted)]">Versioning scaffold active.</p>
          </article>
          <article className="rounded-md border border-[var(--zen-border)] p-3">
            <h3 className="m-0 text-base">Legal Summary Pack</h3>
            <p className="text-sm text-[var(--zen-muted)]">Pending editor integration.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
