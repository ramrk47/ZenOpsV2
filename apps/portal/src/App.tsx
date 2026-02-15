import { useEffect, useMemo, useState } from 'react';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

interface ChannelRow {
  id: string;
  channel_name?: string;
  name?: string;
}

interface ChannelRequestRow {
  id: string;
  channel_name: string;
  borrower_name: string;
  phone: string;
  property_city: string;
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  created_at: string;
}

export default function App() {
  const [token, setToken] = useState('');
  const [channelId, setChannelId] = useState('');
  const [borrowerName, setBorrowerName] = useState('');
  const [phone, setPhone] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [requests, setRequests] = useState<ChannelRequestRow[]>([]);
  const [message, setMessage] = useState('');

  const fileText = useMemo(() => {
    if (files.length === 0) return 'No attachments selected.';
    return files.map((f) => `${f.name} (${Math.ceil(f.size / 1024)} KB)`).join(', ');
  }, [files]);

  const load = async () => {
    if (!token) {
      setChannels([]);
      setRequests([]);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [channelsRes, requestsRes] = await Promise.all([
      fetch(`${API}/channels`, { headers }),
      fetch(`${API}/channel-requests?mine=true`, { headers })
    ]);
    if (channelsRes.ok) {
      const rows = (await channelsRes.json()) as ChannelRow[];
      setChannels(rows);
      if (!channelId && rows.length > 0) {
        setChannelId(rows[0]?.id ?? '');
      }
    } else {
      setChannels([]);
    }
    if (requestsRes.ok) {
      setRequests(await requestsRes.json());
    } else {
      setRequests([]);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const submitChannelRequest = async () => {
    setMessage('Submitting referral channel request...');
    const response = await fetch(`${API}/channel-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        channel_id: channelId,
        borrower_name: borrowerName,
        phone,
        property_city: propertyCity,
        property_address: propertyAddress,
        notes: notes || undefined
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      setMessage(`Failed: ${errorText}`);
      return;
    }

    const data = await response.json();
    setMessage(`Referral channel request submitted: ${data.id}`);
    setBorrowerName('');
    setPhone('');
    setPropertyCity('');
    setPropertyAddress('');
    setNotes('');
    await load();
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <section className="shell p-6">
        <p className="mb-1 text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">External Portal</p>
        <h1 className="mt-0 text-3xl">Referral Channel Request Intake</h1>
        <p className="text-sm text-[var(--zen-muted)]">
          Submit and track your referral channel requests with strict user-level isolation.
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
            Referral Channel
            <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={channelId} onChange={(event) => setChannelId(event.target.value)}>
              <option value="">Select referral channel</option>
              {channels.map((row) => (
                <option key={row.id} value={row.id}>{row.channel_name ?? row.name ?? row.id}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Borrower Name
            <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={borrowerName} onChange={(event) => setBorrowerName(event.target.value)} placeholder="Borrower name" />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Phone
            <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91..." />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Property City
            <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={propertyCity} onChange={(event) => setPropertyCity(event.target.value)} placeholder="Belgaum" />
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          Property Address
          <textarea
            className="min-h-28 rounded-lg border border-[var(--zen-border)] px-3 py-2"
            value={propertyAddress}
            onChange={(event) => setPropertyAddress(event.target.value)}
            placeholder="Address / locality"
          />
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          Notes
          <textarea
            className="min-h-20 rounded-lg border border-[var(--zen-border)] px-3 py-2"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Any additional details"
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
          <Button onClick={submitChannelRequest}>Submit Referral Request</Button>
          <Button onClick={() => void load()}>Refresh</Button>
          <span className="text-sm text-[var(--zen-muted)]">{message}</span>
        </div>

        <section className="mt-6">
          <h2 className="mt-0 text-lg">My Requests</h2>
          <ul className="m-0 list-none space-y-2 p-0">
            {requests.map((row) => (
              <li key={row.id} className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm">
                <p className="m-0"><strong>{row.borrower_name}</strong> · {row.property_city} · {row.status}</p>
                <p className="m-0 text-xs text-[var(--zen-muted)]">{new Date(row.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
          {requests.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No requests yet.</p> : null}
        </section>
      </section>
    </main>
  );
}
