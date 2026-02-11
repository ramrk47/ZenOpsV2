import { useMemo, useState } from 'react';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';
const EXTERNAL_TENANT_DEFAULT = '22222222-2222-2222-2222-222222222222';

export default function App() {
  const [token, setToken] = useState('');
  const [tenantId, setTenantId] = useState(EXTERNAL_TENANT_DEFAULT);
  const [portalUserId, setPortalUserId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');

  const fileText = useMemo(() => {
    if (files.length === 0) return 'No attachments selected.';
    return files.map((f) => `${f.name} (${Math.ceil(f.size / 1024)} KB)`).join(', ');
  }, [files]);

  const submitCommission = async () => {
    setMessage('Submitting...');

    const payload = {
      tenant_id: tenantId,
      portal_user_id: portalUserId,
      source: 'external',
      title,
      description
    };

    const response = await fetch(`${API}/work-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      setMessage(`Failed: ${errorText}`);
      return;
    }

    const data = await response.json();
    setMessage(`Commission submitted. Work order id: ${data.id}`);
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <section className="shell p-6">
        <p className="mb-1 text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">External Portal</p>
        <h1 className="mt-0 text-3xl">Commission Intake</h1>
        <p className="text-sm text-[var(--zen-muted)]">
          Creates work orders inside the dedicated external tenant lane with `portal_user_id` isolation.
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Portal JWT
            <input
              className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Bearer token"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            External Tenant ID
            <input
              className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Portal User ID
            <input
              className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
              value={portalUserId}
              onChange={(event) => setPortalUserId(event.target.value)}
              placeholder="UUID"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Title
            <input
              className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Property valuation request"
            />
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          Description
          <textarea
            className="min-h-28 rounded-lg border border-[var(--zen-border)] px-3 py-2"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add context for the factory team"
          />
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          Upload Stub
          <input
            type="file"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <span className="text-xs text-[var(--zen-muted)]">{fileText}</span>
        </label>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={submitCommission}>Submit Commission</Button>
          <span className="text-sm text-[var(--zen-muted)]">{message}</span>
        </div>
      </section>
    </main>
  );
}
