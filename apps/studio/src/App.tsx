import { useEffect, useMemo, useState } from 'react';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

type BillingMode = 'POSTPAID' | 'CREDIT';
type ReservationStatus = 'ACTIVE' | 'CONSUMED' | 'RELEASED';

type StudioTab = 'credits' | 'invoices';

interface BillingAccountRow {
  id: string;
  tenant_id: string;
  account_type: 'TENANT' | 'EXTERNAL_ASSOCIATE';
  external_key: string;
  display_name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  policy: {
    billing_mode: BillingMode;
    payment_terms_days: number;
    credit_cost_model: string;
    currency: string;
    is_enabled: boolean;
  };
  credit: {
    wallet: number;
    reserved: number;
    available: number;
  };
}

interface AccountBillingStatus {
  account_id: string;
  tenant_id: string;
  account_type: string;
  external_key: string;
  display_name: string;
  account_status: string;
  billing_mode: BillingMode;
  payment_terms_days: number;
  credit_cost_model: string;
  currency: string;
  is_enabled: boolean;
  credit: {
    wallet: number;
    reserved: number;
    available: number;
  };
}

interface CreditLedgerRow {
  id: string;
  tenant_id: string;
  account_id: string;
  reservation_id: string | null;
  delta: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  idempotency_key: string;
  created_at: string;
}

interface CreditReservationRow {
  id: string;
  tenant_id: string;
  account_id: string;
  amount: number;
  status: ReservationStatus;
  ref_type: string;
  ref_id: string;
  idempotency_key: string;
  created_at: string;
  consumed_at: string | null;
  released_at: string | null;
}

interface TenantCreditSummary {
  tenant_id: string;
  account_count: number;
  balance_total: number;
  reserved_total: number;
  available_total: number;
}

interface BillingTimelineRow {
  timestamp: string;
  source: string;
  account_id: string | null;
  tenant_id: string;
  event_type: string;
  ref_type: string | null;
  ref_id: string | null;
  amount: number | null;
  idempotency_key: string | null;
}

interface ServiceInvoiceRow {
  id: string;
  account_id: string;
  invoice_number: string | null;
  status: 'DRAFT' | 'ISSUED' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
  total_amount: number;
  amount_due: number;
  amount_paid: number;
  issued_date: string | null;
  due_date: string | null;
  created_at: string;
}

const makeIdempotencyKey = (scope: string, accountId: string, suffix = ''): string => {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const extra = suffix ? `:${suffix}` : '';
  return `studio:${scope}:${accountId}:${stamp}${extra}`;
};

const readErrorBody = async (response: Response): Promise<string> => {
  const body = await response.text();
  if (!body) {
    return `HTTP ${response.status}`;
  }
  return body;
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

async function apiRequestWithHeaders<T>(
  token: string,
  path: string,
  headers: Record<string, string>,
  init?: RequestInit
): Promise<T> {
  return apiRequest<T>(token, path, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {})
    }
  });
}

export default function App() {
  const [token, setToken] = useState('');
  const [accounts, setAccounts] = useState<BillingAccountRow[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selected, setSelected] = useState<AccountBillingStatus | null>(null);
  const [tenantSummary, setTenantSummary] = useState<TenantCreditSummary | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerRow[]>([]);
  const [reservations, setReservations] = useState<CreditReservationRow[]>([]);
  const [timeline, setTimeline] = useState<BillingTimelineRow[]>([]);
  const [serviceInvoices, setServiceInvoices] = useState<ServiceInvoiceRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [activeTab, setActiveTab] = useState<StudioTab>('credits');
  const [search, setSearch] = useState('');

  const [grantAmount, setGrantAmount] = useState('1');
  const [grantReason, setGrantReason] = useState<'grant' | 'topup' | 'adjustment'>('grant');

  const [reserveRefType, setReserveRefType] = useState('channel_request');
  const [reserveRefId, setReserveRefId] = useState('');
  const [reserveAmount, setReserveAmount] = useState('1');
  const [reserveOverride, setReserveOverride] = useState(false);

  const [timelineRefType, setTimelineRefType] = useState('');
  const [timelineRefId, setTimelineRefId] = useState('');

  const [invoiceDescription, setInvoiceDescription] = useState('Commissioned service');
  const [invoiceAmount, setInvoiceAmount] = useState('1000');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((account) => {
      return (
        account.display_name.toLowerCase().includes(q) ||
        account.external_key.toLowerCase().includes(q) ||
        account.account_type.toLowerCase().includes(q)
      );
    });
  }, [accounts, search]);

  const selectedAccount = useMemo(
    () => accounts.find((row) => row.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );

  const loadAccounts = async () => {
    if (!token) {
      setError('Paste a studio JWT or STUDIO_ADMIN_TOKEN first.');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const rows = await apiRequest<BillingAccountRow[]>(token, `/control/tenant${search ? `?search=${encodeURIComponent(search)}` : ''}`);
      setAccounts(rows);
      if (rows.length > 0) {
        setSelectedAccountId((current) => (current && rows.some((row) => row.id === current) ? current : rows[0].id));
      } else {
        setSelectedAccountId('');
      }
    } catch (err) {
      setAccounts([]);
      setSelectedAccountId('');
      setError(err instanceof Error ? err.message : 'Unable to load accounts');
    } finally {
      setLoading(false);
    }
  };

  const loadAccountDetails = async (accountId: string) => {
    if (!token || !accountId) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const status = await apiRequest<AccountBillingStatus>(token, `/control/accounts/${accountId}/status`);
      const timelineQuery = new URLSearchParams({ account_id: accountId, limit: '120' });
      if (timelineRefType.trim()) timelineQuery.set('ref_type', timelineRefType.trim());
      if (timelineRefId.trim()) timelineQuery.set('ref_id', timelineRefId.trim());

      const [ledgerRows, reservationRows, timelineRows, tenant, invoices] = await Promise.all([
        apiRequest<CreditLedgerRow[]>(token, `/control/credits?account_id=${encodeURIComponent(accountId)}`),
        apiRequest<CreditReservationRow[]>(token, `/control/credits/reservations?account_id=${encodeURIComponent(accountId)}&limit=200`),
        apiRequest<BillingTimelineRow[]>(token, `/control/credits/timeline?${timelineQuery.toString()}`),
        apiRequest<TenantCreditSummary>(token, `/control/credits/tenant/${encodeURIComponent(status.tenant_id)}`),
        apiRequest<ServiceInvoiceRow[]>(token, `/service-invoices?account_id=${encodeURIComponent(accountId)}`)
      ]);

      setSelected(status);
      setLedger(ledgerRows);
      setReservations(reservationRows);
      setTimeline(timelineRows);
      setTenantSummary(tenant);
      setServiceInvoices(invoices);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load account details');
      setSelected(null);
      setLedger([]);
      setReservations([]);
      setTimeline([]);
      setTenantSummary(null);
      setServiceInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedAccountId) {
      return;
    }
    void loadAccountDetails(selectedAccountId);
  }, [selectedAccountId, token]);

  const runAction = async (label: string, action: () => Promise<void>) => {
    if (!selectedAccountId) {
      setError('Select an account first.');
      return;
    }
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await action();
      await Promise.all([loadAccounts(), loadAccountDetails(selectedAccountId)]);
      setNotice(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setWorking(false);
    }
  };

  const setPolicy = async (mode: BillingMode) => {
    await runAction(`Policy set to ${mode}.`, async () => {
      await apiRequest(token, `/control/accounts/${selectedAccountId}/policy`, {
        method: 'PATCH',
        body: JSON.stringify({
          billing_mode: mode.toLowerCase(),
          is_enabled: true,
          payment_terms_days: 15,
          currency: 'INR'
        })
      });
    });
  };

  const copyExternalKey = async () => {
    if (!selected?.external_key) return;
    try {
      await navigator.clipboard.writeText(selected.external_key);
      setNotice('External key copied.');
    } catch {
      setError('Unable to copy to clipboard in this browser context.');
    }
  };

  const grantCredits = async () => {
    const amount = Number.parseInt(grantAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Grant amount must be a positive integer.');
      return;
    }

    await runAction(`Granted ${amount} credits (${grantReason}).`, async () => {
      await apiRequest(token, `/control/accounts/${selectedAccountId}/credits/grant`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          reason: grantReason,
          ref_type: 'studio_manual',
          ref_id: 'operator_grant',
          idempotency_key: makeIdempotencyKey('grant', selectedAccountId, grantReason)
        })
      });
    });
  };

  const reserveCredits = async () => {
    const amount = Number.parseInt(reserveAmount, 10);
    if (!reserveRefType.trim() || !reserveRefId.trim()) {
      setError('Reserve requires ref_type and ref_id.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Reserve amount must be a positive integer.');
      return;
    }

    await runAction(`Reserved ${amount} credits for ${reserveRefType}:${reserveRefId}.`, async () => {
      await apiRequest(token, '/control/credits/reserve', {
        method: 'POST',
        body: JSON.stringify({
          account_id: selectedAccountId,
          amount,
          ref_type: reserveRefType.trim(),
          ref_id: reserveRefId.trim(),
          operator_override: reserveOverride,
          idempotency_key: makeIdempotencyKey('reserve', selectedAccountId, reserveRefId.trim())
        })
      });
    });
  };

  const consumeReservation = async (reservation: CreditReservationRow) => {
    await runAction(`Reservation ${reservation.id} consumed.`, async () => {
      await apiRequest(token, '/control/credits/consume', {
        method: 'POST',
        body: JSON.stringify({
          account_id: selectedAccountId,
          reservation_id: reservation.id,
          idempotency_key: makeIdempotencyKey('consume', selectedAccountId, reservation.id)
        })
      });
    });
  };

  const releaseReservation = async (reservation: CreditReservationRow) => {
    await runAction(`Reservation ${reservation.id} released.`, async () => {
      await apiRequest(token, '/control/credits/release', {
        method: 'POST',
        body: JSON.stringify({
          account_id: selectedAccountId,
          reservation_id: reservation.id,
          idempotency_key: makeIdempotencyKey('release', selectedAccountId, reservation.id)
        })
      });
    });
  };

  const createInvoiceDraft = async () => {
    const amount = Number.parseFloat(invoiceAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Invoice amount must be positive.');
      return;
    }

    await runAction('Service invoice draft created.', async () => {
      await apiRequest(token, '/service-invoices', {
        method: 'POST',
        body: JSON.stringify({
          account_id: selectedAccountId,
          due_date: invoiceDueDate || undefined,
          notes: 'Created from studio billing tab',
          items: [
            {
              description: invoiceDescription || 'Commissioned service',
              quantity: 1,
              unit_price: amount,
              order_index: 0
            }
          ]
        })
      });
    });
  };

  const issueInvoice = async (invoiceId: string) => {
    await runAction(`Invoice ${invoiceId} issued.`, async () => {
      await apiRequestWithHeaders(
        token,
        `/service-invoices/${invoiceId}/issue`,
        {
          'Idempotency-Key': makeIdempotencyKey('invoice_issue', selectedAccountId, invoiceId)
        },
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      );
    });
  };

  const markInvoicePaid = async (invoiceId: string, amountDue: number) => {
    await runAction(`Invoice ${invoiceId} marked paid.`, async () => {
      await apiRequest(token, `/service-invoices/${invoiceId}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({
          amount: amountDue,
          mode: 'manual',
          notes: 'Marked paid from studio billing tab'
        })
      });
    });
  };

  const applyTimelineFilter = async () => {
    if (!selectedAccountId) return;
    await loadAccountDetails(selectedAccountId);
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">Studio Plane</p>
          <h1 className="m-0 text-3xl font-bold">Billing Control Plane</h1>
          <p className="text-sm text-[var(--zen-muted)]">Credits truth + service invoices for phased V1 to V2 billing migration.</p>
        </div>

        <section className="panel p-4">
          <label className="text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Studio JWT / Admin Token</label>
          <div className="mt-2 flex gap-2">
            <input
              className="w-full rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste studio bearer token"
            />
            <Button onClick={() => void loadAccounts()} disabled={loading || !token.trim()}>
              {loading ? 'Loading...' : 'Load'}
            </Button>
          </div>
        </section>
      </header>

      {error ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p> : null}

      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="panel p-4">
          <h2 className="mt-0 text-lg">Accounts</h2>
          <div className="mb-2 flex gap-2">
            <input
              className="w-full rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm"
              placeholder="Search accounts"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button onClick={() => void loadAccounts()} disabled={loading || !token.trim()}>
              Search
            </Button>
          </div>
          <p className="text-sm text-[var(--zen-muted)]">{filteredAccounts.length} matched accounts</p>
          <ul className="m-0 list-none space-y-2 p-0 text-sm">
            {filteredAccounts.map((account) => (
              <li key={account.id}>
                <button
                  className={`w-full rounded-md border p-3 text-left ${
                    account.id === selectedAccountId
                      ? 'border-[var(--zen-primary)] bg-white'
                      : 'border-[var(--zen-border)] bg-[var(--zen-bg)]'
                  }`}
                  onClick={() => setSelectedAccountId(account.id)}
                  type="button"
                >
                  <strong className="block">{account.display_name}</strong>
                  <span className="block text-xs text-[var(--zen-muted)]">{account.external_key}</span>
                  <span className="block text-xs text-[var(--zen-muted)]">
                    {account.policy.billing_mode} · avail {account.credit.available}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {filteredAccounts.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No accounts returned yet.</p> : null}
        </aside>

        <div className="space-y-4">
          {!selected ? (
            <section className="panel p-4">
              <p className="m-0 text-sm text-[var(--zen-muted)]">Select an account to inspect billing status.</p>
            </section>
          ) : (
            <>
              {selected.billing_mode === 'CREDIT' && selected.credit.available <= 0 ? (
                <section className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  CREDIT mode is enabled, but available credits are 0. New commissioned work will fail reserve unless operator override is used.
                </section>
              ) : null}

              <section className="panel p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="m-0 text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Selected Account</p>
                    <p className="m-0 text-sm">
                      {selected.display_name} · <code>{selected.external_key}</code>
                    </p>
                  </div>
                  <Button onClick={() => void copyExternalKey()}>Copy external_key</Button>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <article className="rounded-md border border-[var(--zen-border)] p-3">
                    <p className="m-0 text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Wallet</p>
                    <p className="m-0 text-2xl font-semibold">{selected.credit.wallet}</p>
                  </article>
                  <article className="rounded-md border border-[var(--zen-border)] p-3">
                    <p className="m-0 text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Reserved</p>
                    <p className="m-0 text-2xl font-semibold">{selected.credit.reserved}</p>
                  </article>
                  <article className="rounded-md border border-[var(--zen-border)] p-3">
                    <p className="m-0 text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Available</p>
                    <p className="m-0 text-2xl font-semibold">{selected.credit.available}</p>
                  </article>
                </div>

                {tenantSummary ? (
                  <p className="mt-3 text-sm text-[var(--zen-muted)]">
                    Tenant aggregate: total {tenantSummary.balance_total} · reserved {tenantSummary.reserved_total} · available{' '}
                    {tenantSummary.available_total}
                  </p>
                ) : null}

                <div className="mt-4 inline-flex gap-2 rounded-md border border-[var(--zen-border)] p-1">
                  <button
                    type="button"
                    className={`rounded px-3 py-1 text-sm ${activeTab === 'credits' ? 'bg-white font-semibold' : 'text-[var(--zen-muted)]'}`}
                    onClick={() => setActiveTab('credits')}
                  >
                    Credits
                  </button>
                  <button
                    type="button"
                    className={`rounded px-3 py-1 text-sm ${activeTab === 'invoices' ? 'bg-white font-semibold' : 'text-[var(--zen-muted)]'}`}
                    onClick={() => setActiveTab('invoices')}
                  >
                    Invoices
                  </button>
                </div>
              </section>

              {activeTab === 'credits' ? (
                <>
                  <section className="panel p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <article className="rounded-md border border-[var(--zen-border)] p-3">
                        <p className="m-0 text-sm font-semibold">Policy</p>
                        <p className="m-0 text-sm text-[var(--zen-muted)]">
                          Current: {selected.billing_mode} · terms {selected.payment_terms_days} days
                        </p>
                        <div className="mt-2 flex gap-2">
                          <Button disabled={working || selected.billing_mode === 'POSTPAID'} onClick={() => void setPolicy('POSTPAID')}>
                            Switch to POSTPAID
                          </Button>
                          <Button disabled={working || selected.billing_mode === 'CREDIT'} onClick={() => void setPolicy('CREDIT')}>
                            Switch to CREDIT
                          </Button>
                        </div>
                      </article>

                      <article className="rounded-md border border-[var(--zen-border)] p-3">
                        <p className="m-0 text-sm font-semibold">Grant Credits</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <input
                            className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                            type="number"
                            min={1}
                            value={grantAmount}
                            onChange={(event) => setGrantAmount(event.target.value)}
                          />
                          <select
                            className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                            value={grantReason}
                            onChange={(event) => setGrantReason(event.target.value as 'grant' | 'topup' | 'adjustment')}
                          >
                            <option value="grant">GRANT</option>
                            <option value="topup">TOPUP</option>
                            <option value="adjustment">ADJUSTMENT</option>
                          </select>
                          <Button disabled={working} onClick={() => void grantCredits()}>
                            Apply
                          </Button>
                        </div>
                      </article>
                    </div>

                    <article className="mt-3 rounded-md border border-[var(--zen-border)] p-3">
                      <p className="m-0 text-sm font-semibold">Manual Reserve</p>
                      <div className="mt-2 grid gap-2 md:grid-cols-5">
                        <input
                          className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                          value={reserveRefType}
                          onChange={(event) => setReserveRefType(event.target.value)}
                          placeholder="ref_type"
                        />
                        <input
                          className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                          value={reserveRefId}
                          onChange={(event) => setReserveRefId(event.target.value)}
                          placeholder="ref_id"
                        />
                        <input
                          className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                          type="number"
                          min={1}
                          value={reserveAmount}
                          onChange={(event) => setReserveAmount(event.target.value)}
                        />
                        <label className="flex items-center gap-2 rounded-lg border border-[var(--zen-border)] px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={reserveOverride}
                            onChange={(event) => setReserveOverride(event.target.checked)}
                          />
                          Override
                        </label>
                        <Button disabled={working} onClick={() => void reserveCredits()}>
                          Reserve
                        </Button>
                      </div>
                    </article>
                  </section>

                  <section className="panel p-4">
                    <h2 className="mt-0 text-lg">Reservations</h2>
                    <p className="mb-2 text-xs text-[var(--zen-muted)]">Active reservations: {reservations.filter((row) => row.status === 'ACTIVE').length}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Ref</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Amount</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Status</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Created</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reservations.map((row) => (
                            <tr key={row.id}>
                              <td className="border-b border-[var(--zen-border)] p-2">{row.ref_type}:{row.ref_id}</td>
                              <td className="border-b border-[var(--zen-border)] p-2">{row.amount}</td>
                              <td className="border-b border-[var(--zen-border)] p-2">{row.status}</td>
                              <td className="border-b border-[var(--zen-border)] p-2">{new Date(row.created_at).toLocaleString()}</td>
                              <td className="border-b border-[var(--zen-border)] p-2 text-right">
                                {row.status === 'ACTIVE' ? (
                                  <div className="inline-flex gap-2">
                                    <Button disabled={working} onClick={() => void consumeReservation(row)}>Consume</Button>
                                    <Button disabled={working} onClick={() => void releaseReservation(row)}>Release</Button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-[var(--zen-muted)]">-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {reservations.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No reservations yet.</p> : null}
                  </section>

                  <section className="grid gap-4 lg:grid-cols-2">
                    <article className="panel p-4">
                      <h2 className="mt-0 text-lg">Ledger (Last 20)</h2>
                      <ul className="m-0 list-none space-y-2 p-0 text-sm">
                        {ledger.slice(0, 20).map((row) => (
                          <li key={row.id} className="rounded-md border border-[var(--zen-border)] p-2">
                            <strong>{row.reason}</strong> · {row.delta > 0 ? `+${row.delta}` : row.delta}
                            <div className="text-xs text-[var(--zen-muted)]">
                              {row.ref_type ?? 'n/a'}:{row.ref_id ?? 'n/a'} · {new Date(row.created_at).toLocaleString()}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </article>

                    <article className="panel p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h2 className="m-0 text-lg">Billing Timeline</h2>
                        <Button disabled={working || loading} onClick={() => void applyTimelineFilter()}>Apply Filter</Button>
                      </div>
                      <div className="mb-3 grid gap-2 md:grid-cols-2">
                        <input
                          className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                          placeholder="ref_type"
                          value={timelineRefType}
                          onChange={(event) => setTimelineRefType(event.target.value)}
                        />
                        <input
                          className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                          placeholder="ref_id"
                          value={timelineRefId}
                          onChange={(event) => setTimelineRefId(event.target.value)}
                        />
                      </div>
                      <ul className="m-0 list-none space-y-2 p-0 text-sm">
                        {timeline.slice(0, 30).map((row, idx) => (
                          <li key={`${row.timestamp}-${row.source}-${idx}`} className="rounded-md border border-[var(--zen-border)] p-2">
                            <strong>{row.event_type}</strong> · {row.source}
                            <div className="text-xs text-[var(--zen-muted)]">
                              {row.ref_type ?? 'n/a'}:{row.ref_id ?? 'n/a'} · {row.amount ?? 'n/a'} ·{' '}
                              {new Date(row.timestamp).toLocaleString()}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </article>
                  </section>
                </>
              ) : (
                <section className="panel p-4">
                  <h2 className="mt-0 text-lg">Service Invoices</h2>
                  <p className="text-sm text-[var(--zen-muted)]">Standard postpaid billing capability in V2 (draft → issue → paid).</p>

                  <article className="mb-4 rounded-md border border-[var(--zen-border)] p-3">
                    <p className="m-0 text-sm font-semibold">Create Draft</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-4">
                      <input
                        className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                        value={invoiceDescription}
                        onChange={(event) => setInvoiceDescription(event.target.value)}
                        placeholder="Description"
                      />
                      <input
                        className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                        value={invoiceAmount}
                        onChange={(event) => setInvoiceAmount(event.target.value)}
                        type="number"
                        min={1}
                        step="0.01"
                        placeholder="Amount"
                      />
                      <input
                        className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2"
                        value={invoiceDueDate}
                        onChange={(event) => setInvoiceDueDate(event.target.value)}
                        type="date"
                      />
                      <Button disabled={working} onClick={() => void createInvoiceDraft()}>Create Draft</Button>
                    </div>
                  </article>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border-b border-[var(--zen-border)] p-2 text-left">Invoice</th>
                          <th className="border-b border-[var(--zen-border)] p-2 text-left">Status</th>
                          <th className="border-b border-[var(--zen-border)] p-2 text-left">Total</th>
                          <th className="border-b border-[var(--zen-border)] p-2 text-left">Due</th>
                          <th className="border-b border-[var(--zen-border)] p-2 text-left">Issued</th>
                          <th className="border-b border-[var(--zen-border)] p-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serviceInvoices.map((invoice) => (
                          <tr key={invoice.id}>
                            <td className="border-b border-[var(--zen-border)] p-2">{invoice.invoice_number ?? invoice.id}</td>
                            <td className="border-b border-[var(--zen-border)] p-2">{invoice.status}</td>
                            <td className="border-b border-[var(--zen-border)] p-2">{invoice.total_amount}</td>
                            <td className="border-b border-[var(--zen-border)] p-2">{invoice.amount_due}</td>
                            <td className="border-b border-[var(--zen-border)] p-2">{invoice.issued_date ?? '—'}</td>
                            <td className="border-b border-[var(--zen-border)] p-2 text-right">
                              {invoice.status === 'DRAFT' ? (
                                <Button disabled={working} onClick={() => void issueInvoice(invoice.id)}>Issue</Button>
                              ) : invoice.status !== 'PAID' && invoice.status !== 'VOID' ? (
                                <Button disabled={working || invoice.amount_due <= 0} onClick={() => void markInvoicePaid(invoice.id, invoice.amount_due)}>
                                  Mark Paid
                                </Button>
                              ) : (
                                <span className="text-xs text-[var(--zen-muted)]">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {serviceInvoices.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No service invoices for this account.</p> : null}
                </section>
              )}
            </>
          )}
        </div>
      </section>

      {selectedAccount ? (
        <p className="mt-4 text-xs text-[var(--zen-muted)]">
          Selected account: {selectedAccount.display_name} ({selectedAccount.external_key})
        </p>
      ) : null}
    </main>
  );
}
