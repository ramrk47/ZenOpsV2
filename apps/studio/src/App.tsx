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

interface NotificationRouteRow {
  id: string;
  channel: 'email' | 'whatsapp';
  is_active: boolean;
  group: {
    key: string;
    name: string;
  };
  to_contact_point: {
    id: string;
    value: string;
  };
}

export default function App() {
  const [token, setToken] = useState('');
  const [jobs, setJobs] = useState<ReportJob[]>([]);
  const [requests, setRequests] = useState<ReportRequest[]>([]);
  const [routes, setRoutes] = useState<NotificationRouteRow[]>([]);
  const [groupKey, setGroupKey] = useState('FINANCE');
  const [groupName, setGroupName] = useState('Finance Team');
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email');
  const [contactPointId, setContactPointId] = useState('');
  const [routeMessage, setRouteMessage] = useState('');

  const load = async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const [jobsRes, reqRes, routesRes] = await Promise.all([
      fetch(`${API}/studio/report-jobs`, { headers }),
      fetch(`${API}/report-requests`, { headers }),
      fetch(`${API}/notifications/routes`, { headers })
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

    if (routesRes.ok) {
      setRoutes(await routesRes.json());
    } else {
      setRoutes([]);
    }
  };

  const createRoute = async () => {
    setRouteMessage('');
    const response = await fetch(`${API}/notifications/routes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        group_key: groupKey,
        group_name: groupName,
        channel,
        to_contact_point_id: contactPointId,
        is_active: true
      })
    });

    if (!response.ok) {
      setRouteMessage(`Save failed (${response.status})`);
      return;
    }

    setRouteMessage('Route saved');
    await load();
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

      <section className="panel mt-6 p-4">
        <h2 className="mt-0 text-lg">Routing (M4.2)</h2>
        <p className="text-sm text-[var(--zen-muted)]">Configure role/team delivery targets used by event routing.</p>
        <div className="grid gap-2 md:grid-cols-4">
          <input
            className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
            value={groupKey}
            onChange={(event) => setGroupKey(event.target.value)}
            placeholder="Group key (e.g. FINANCE)"
          />
          <input
            className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Group name"
          />
          <select
            className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
            value={channel}
            onChange={(event) => setChannel(event.target.value as 'email' | 'whatsapp')}
          >
            <option value="email">email</option>
            <option value="whatsapp">whatsapp</option>
          </select>
          <input
            className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
            value={contactPointId}
            onChange={(event) => setContactPointId(event.target.value)}
            placeholder="Contact point id"
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={() => void createRoute()}>Save Route</Button>
          <Button onClick={load}>Refresh</Button>
          {routeMessage ? <span className="text-sm text-[var(--zen-muted)]">{routeMessage}</span> : null}
        </div>

        <ul className="mt-4 m-0 list-none space-y-2 p-0 text-sm">
          {routes.map((route) => (
            <li key={route.id} className="rounded-md border border-[var(--zen-border)] p-2">
              <strong>{route.group.key}</strong> ({route.group.name}) · {route.channel} · {route.to_contact_point.value}
            </li>
          ))}
        </ul>
        {routes.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No route targets configured.</p> : null}
      </section>
    </main>
  );
}
