import { useEffect, useMemo, useState } from 'react';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

type BillingMode = 'POSTPAID' | 'CREDIT';
type ReservationStatus = 'ACTIVE' | 'CONSUMED' | 'RELEASED';

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

export default function App() {
  const [token, setToken] = useState('');
  const [accounts, setAccounts] = useState<BillingAccountRow[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selected, setSelected] = useState<AccountBillingStatus | null>(null);
  const [tenantSummary, setTenantSummary] = useState<TenantCreditSummary | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerRow[]>([]);
  const [reservations, setReservations] = useState<CreditReservationRow[]>([]);
  const [timeline, setTimeline] = useState<BillingTimelineRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [grantAmount, setGrantAmount] = useState('1');
  const [grantReason, setGrantReason] = useState<'grant' | 'topup' | 'adjustment'>('grant');

  const [reserveRefType, setReserveRefType] = useState('channel_request');
  const [reserveRefId, setReserveRefId] = useState('');
  const [reserveAmount, setReserveAmount] = useState('1');

  const selectedAccount = useMemo(
    () => accounts.find((row) => row.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );

  const loadAccounts = async () => {
    if (!token) {
      setError('Paste a studio JWT first.');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const rows = await apiRequest<BillingAccountRow[]>(token, '/control/tenant');
      setAccounts(rows);
      if (rows.length > 0) {
        setSelectedAccountId((current) => current || rows[0].id);
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
      const [ledgerRows, reservationRows, timelineRows, tenant] = await Promise.all([
        apiRequest<CreditLedgerRow[]>(token, `/control/credits?account_id=${encodeURIComponent(accountId)}`),
        apiRequest<CreditReservationRow[]>(token, `/control/credits/reservations?account_id=${encodeURIComponent(accountId)}&limit=200`),
        apiRequest<BillingTimelineRow[]>(token, `/control/credits/timeline?account_id=${encodeURIComponent(accountId)}&limit=120`),
        apiRequest<TenantCreditSummary>(token, `/control/credits/tenant/${encodeURIComponent(status.tenant_id)}`)
      ]);

      setSelected(status);
      setLedger(ledgerRows);
      setReservations(reservationRows);
      setTimeline(timelineRows);
      setTenantSummary(tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load account details');
      setSelected(null);
      setLedger([]);
      setReservations([]);
      setTimeline([]);
      setTenantSummary(null);
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
          is_enabled: true
        })
      });
    });
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

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">Studio Plane</p>
          <h1 className="m-0 text-3xl font-bold">Billing Control Plane</h1>
          <p className="text-sm text-[var(--zen-muted)]">Policy, credits, reservations, and timeline in one operator screen.</p>
        </div>

        <section className="panel p-4">
          <label className="text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Studio JWT</label>
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
          <p className="text-sm text-[var(--zen-muted)]">{accounts.length} linked billing accounts</p>
          <ul className="m-0 list-none space-y-2 p-0 text-sm">
            {accounts.map((account) => (
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
          {accounts.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No accounts returned yet.</p> : null}
        </aside>

        <div className="space-y-4">
          {!selected ? (
            <section className="panel p-4">
              <p className="m-0 text-sm text-[var(--zen-muted)]">Select an account to inspect billing status.</p>
            </section>
          ) : (
            <>
              <section className="panel p-4">
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

                <div className="mt-4 grid gap-3 md:grid-cols-2">
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
                  <div className="mt-2 grid gap-2 md:grid-cols-4">
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
                    <Button disabled={working} onClick={() => void reserveCredits()}>
                      Reserve
                    </Button>
                  </div>
                </article>
              </section>

              <section className="panel p-4">
                <h2 className="mt-0 text-lg">Reservations</h2>
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
                  <h2 className="mt-0 text-lg">Ledger</h2>
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
                  <h2 className="mt-0 text-lg">Billing Timeline</h2>
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
