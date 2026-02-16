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
  service_invoice_id?: string | null;
  service_invoice_status?: string | null;
  service_invoice_number?: string | null;
  service_invoice_total_amount?: number | null;
  service_invoice_amount_due?: number | null;
  service_invoice_is_paid?: boolean | null;
  created_at: string;
}

interface ServiceInvoiceDetail {
  id: string;
  account_id: string;
  invoice_number: string | null;
  status: 'DRAFT' | 'ISSUED' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
  currency: string;
  total_amount: number;
  amount_due: number;
  amount_paid: number;
  due_date: string | null;
  created_at: string;
}

interface PaymentOrderHandle {
  id: string;
  checkout_url: string | null;
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
  const [invoices, setInvoices] = useState<Record<string, ServiceInvoiceDetail>>({});
  const [payProvider, setPayProvider] = useState<'stripe' | 'razorpay'>('razorpay');
  const [payLinks, setPayLinks] = useState<Record<string, string>>({});
  const [proofRefByInvoice, setProofRefByInvoice] = useState<Record<string, string>>({});
  const [proofNameByInvoice, setProofNameByInvoice] = useState<Record<string, string>>({});
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
      const requestRows = (await requestsRes.json()) as ChannelRequestRow[];
      setRequests(requestRows);
      const invoiceIds = Array.from(new Set(requestRows.map((row) => row.service_invoice_id).filter((value): value is string => Boolean(value))));
      if (invoiceIds.length > 0) {
        const details = await Promise.all(
          invoiceIds.map(async (invoiceId) => {
            const response = await fetch(`${API}/service-invoices/${invoiceId}`, { headers });
            if (!response.ok) return null;
            const row = (await response.json()) as ServiceInvoiceDetail;
            return [invoiceId, row] as const;
          })
        );
        const mapped = details.filter((row): row is readonly [string, ServiceInvoiceDetail] => Boolean(row));
        setInvoices(Object.fromEntries(mapped));
      } else {
        setInvoices({});
      }
    } else {
      setRequests([]);
      setInvoices({});
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

  const submitPaymentProof = async (invoiceId: string) => {
    if (!token) {
      setMessage('Paste portal JWT first.');
      return;
    }

    const selectedFile = files[0] ?? null;
    const manualRef = (proofRefByInvoice[invoiceId] ?? '').trim();
    const manualName = (proofNameByInvoice[invoiceId] ?? '').trim();
    const suffix = manualRef || `proof-${Date.now()}`;
    const safeSuffix = suffix.replace(/[^A-Za-z0-9._-]/g, '-');
    const generatedName = selectedFile?.name || manualName || `payment-proof-${invoiceId}.txt`;

    const payload = {
      kind: 'payment_proof',
      original_name: generatedName,
      storage_key: `portal/payment-proof/${invoiceId}/${Date.now()}-${safeSuffix}`,
      mime_type: selectedFile?.type || 'text/plain',
      size_bytes: selectedFile?.size || 0
    };

    setMessage(`Uploading payment proof metadata for ${invoiceId}...`);
    const response = await fetch(`${API}/service-invoices/${invoiceId}/payment-proof`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      setMessage(`Payment proof failed: ${await response.text()}`);
      return;
    }
    setMessage(`Payment proof metadata submitted for ${invoiceId}.`);
    await load();
  };

  const createPayLink = async (invoice: ServiceInvoiceDetail) => {
    if (!token) {
      setMessage('Paste portal JWT first.');
      return;
    }
    const amount = invoice.amount_due > 0 ? invoice.amount_due : invoice.total_amount;
    setMessage(`Creating ${payProvider} checkout for ${invoice.invoice_number ?? invoice.id}...`);
    const response = await fetch(`${API}/payments/checkout-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        account_id: invoice.account_id,
        amount,
        currency: invoice.currency,
        purpose: 'invoice',
        provider: payProvider,
        ref_type: 'service_invoice',
        ref_id: invoice.id,
        service_invoice_id: invoice.id,
        idempotency_key: `portal:invoice_checkout:${invoice.id}:${payProvider}`
      })
    });
    if (!response.ok) {
      setMessage(`Pay link failed: ${await response.text()}`);
      return;
    }
    const created = (await response.json()) as PaymentOrderHandle;
    if (created.checkout_url) {
      setPayLinks((current) => ({
        ...current,
        [invoice.id]: created.checkout_url as string
      }));
      window.open(created.checkout_url, '_blank', 'noopener,noreferrer');
      setMessage(`Checkout link ready for ${invoice.invoice_number ?? invoice.id}.`);
    } else {
      setMessage(`Checkout created for ${invoice.invoice_number ?? invoice.id}, but no redirect URL returned.`);
    }
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
          <select
            className="rounded-lg border border-[var(--zen-border)] bg-white px-2 py-1 text-sm"
            value={payProvider}
            onChange={(event) => setPayProvider(event.target.value as 'stripe' | 'razorpay')}
          >
            <option value="razorpay">Razorpay</option>
            <option value="stripe">Stripe</option>
          </select>
          <span className="text-sm text-[var(--zen-muted)]">{message}</span>
        </div>

        <section className="mt-6">
          <h2 className="mt-0 text-lg">My Requests</h2>
          <ul className="m-0 list-none space-y-2 p-0">
            {requests.map((row) => (
              <li key={row.id} className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm">
                <p className="m-0"><strong>{row.borrower_name}</strong> · {row.property_city} · {row.status}</p>
                {row.service_invoice_id ? (
                  <p className="m-0 text-xs text-[var(--zen-muted)]">
                    Invoice {row.service_invoice_number ?? row.service_invoice_id} · {row.service_invoice_status ?? 'N/A'} · due{' '}
                    {row.service_invoice_amount_due ?? row.service_invoice_total_amount ?? 0}
                  </p>
                ) : null}
                <p className="m-0 text-xs text-[var(--zen-muted)]">{new Date(row.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
          {requests.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No requests yet.</p> : null}
        </section>

        <section className="mt-6">
          <h2 className="mt-0 text-lg">My Invoices</h2>
          <p className="text-xs text-[var(--zen-muted)]">
            Deliverables stay locked until invoice is paid in POSTPAID mode.
          </p>
          <ul className="m-0 list-none space-y-2 p-0">
            {Object.values(invoices)
              .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
              .map((invoice) => (
                <li key={invoice.id} className="rounded-lg border border-[var(--zen-border)] bg-white p-3 text-sm">
                  <p className="m-0">
                    <strong>{invoice.invoice_number ?? invoice.id}</strong> · {invoice.status} · {invoice.total_amount} {invoice.currency}
                  </p>
                  <p className="m-0 text-xs text-[var(--zen-muted)]">
                    Amount due: {invoice.amount_due} · Due date: {invoice.due_date ?? 'N/A'}
                  </p>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <input
                      className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
                      placeholder="Proof reference"
                      value={proofRefByInvoice[invoice.id] ?? ''}
                      onChange={(event) =>
                        setProofRefByInvoice((current) => ({ ...current, [invoice.id]: event.target.value }))
                      }
                    />
                    <input
                      className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
                      placeholder="Proof file name (optional)"
                      value={proofNameByInvoice[invoice.id] ?? ''}
                      onChange={(event) =>
                        setProofNameByInvoice((current) => ({ ...current, [invoice.id]: event.target.value }))
                      }
                    />
                    <Button onClick={() => void submitPaymentProof(invoice.id)}>Upload Payment Proof</Button>
                    {invoice.status !== 'PAID' && invoice.status !== 'VOID' ? (
                      <Button onClick={() => void createPayLink(invoice)}>Pay Now</Button>
                    ) : null}
                    {payLinks[invoice.id] ? (
                      <a className="inline-flex items-center rounded-lg border border-[var(--zen-border)] px-3 py-2 text-sm" href={payLinks[invoice.id]} target="_blank" rel="noreferrer">
                        Open Link
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
          </ul>
          {Object.keys(invoices).length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No invoices linked yet.</p> : null}
        </section>
      </section>
    </main>
  );
}
