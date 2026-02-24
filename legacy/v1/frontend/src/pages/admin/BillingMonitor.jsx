import React, { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { toUserMessage } from '../../api/client'
import { getAccountDetail, getSummary } from '../../api/billingMonitor'
import { formatDate, formatDateTime, formatMoney, titleCase } from '../../utils/format'

const EMPTY_SUMMARY = {
  v1_meta: null,
  studio: null,
  accounts: [],
  v1_invoices: [],
  v1_payments: [],
}

function billingModeTone(mode) {
  if (mode === 'CREDIT') return 'accent'
  if (mode === 'POSTPAID') return 'ok'
  return 'muted'
}

function connectivityTone(studio) {
  if (!studio) return 'muted'
  if (studio.reachable) return 'ok'
  if (studio.show_cached_banner) return 'warn'
  return 'danger'
}

async function copyText(value) {
  if (!value) return false
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return true
  }
  const temp = document.createElement('textarea')
  temp.value = value
  document.body.appendChild(temp)
  temp.select()
  document.execCommand('copy')
  document.body.removeChild(temp)
  return true
}

function JsonPanel({ title, payload }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{title}</summary>
      <pre
        style={{
          marginTop: 8,
          padding: 10,
          background: 'var(--surface-2, #f6f7f9)',
          borderRadius: 8,
          overflowX: 'auto',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
        }}
      >
        {JSON.stringify(payload || {}, null, 2)}
      </pre>
    </details>
  )
}

export default function BillingMonitor() {
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [detail, setDetail] = useState(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [activeTab, setActiveTab] = useState('invoices')
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState(null)
  const [detailError, setDetailError] = useState(null)
  const [notice, setNotice] = useState(null)

  const loadSummary = useCallback(async (refresh = false) => {
    setLoadingSummary(true)
    setError(null)
    try {
      const payload = await getSummary({ refresh })
      setSummary(payload || EMPTY_SUMMARY)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to load billing monitor summary'))
      setSummary(EMPTY_SUMMARY)
    } finally {
      setLoadingSummary(false)
    }
  }, [])

  const loadDetail = useCallback(async (externalKey, refresh = false) => {
    if (!externalKey) {
      setDetail(null)
      return
    }
    setLoadingDetail(true)
    setDetailError(null)
    try {
      const payload = await getAccountDetail(externalKey, { refresh })
      setDetail(payload)
    } catch (err) {
      console.error(err)
      setDetailError(toUserMessage(err, 'Failed to load account detail'))
      setDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    loadSummary(false)
  }, [loadSummary])

  useEffect(() => {
    if (selectedKey) return
    if (!summary.accounts || summary.accounts.length === 0) return
    const firstKey = summary.accounts[0].external_key
    setSelectedKey(firstKey)
    loadDetail(firstKey, false)
  }, [summary.accounts, selectedKey, loadDetail])

  const selectedAccount = useMemo(
    () => (summary.accounts || []).find((row) => row.external_key === selectedKey) || null,
    [summary.accounts, selectedKey],
  )

  const refreshNow = async () => {
    setNotice(null)
    try {
      await loadSummary(true)
      if (selectedKey) await loadDetail(selectedKey, true)
      setNotice('Forced refresh completed.')
    } catch (err) {
      setNotice(toUserMessage(err, 'Refresh failed'))
    }
  }

  const handleSelectAccount = (externalKey) => {
    setSelectedKey(externalKey)
    loadDetail(externalKey, false)
  }

  const handleCopy = async (externalKey) => {
    try {
      await copyText(externalKey)
      setNotice(`Copied ${externalKey}`)
    } catch (err) {
      setNotice('Clipboard copy failed')
    }
  }

  const studio = summary.studio || {}
  const studioUnavailableBanner = !studio.reachable && studio.show_cached_banner

  return (
    <div>
      <PageHeader
        title="Billing Monitor"
        subtitle="Read-only rollout monitor for V1 postpaid activity and V2 credit truth."
        actions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Badge tone={connectivityTone(studio)}>
              {studio.reachable ? 'Studio reachable' : 'Studio unavailable'}
            </Badge>
            <button type="button" className="secondary" onClick={refreshNow} disabled={loadingSummary || loadingDetail}>
              Refresh now
            </button>
          </div>
        )}
      />

      {error ? <div className="empty" style={{ marginBottom: 12 }}>{error}</div> : null}
      {notice ? <div className="empty" style={{ marginBottom: 12 }}>{notice}</div> : null}
      {studioUnavailableBanner ? (
        <div className="empty" style={{ marginBottom: 12 }}>
          Studio unavailable, showing cached data.
        </div>
      ) : null}

      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <div className="card tight">
          <div className="kicker">V1 Identity</div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>{summary.v1_meta?.app || 'zenops-v1'}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Version: {summary.v1_meta?.version || '—'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Env: {summary.v1_meta?.environment || '—'}
          </div>
        </div>
        <div className="card tight">
          <div className="kicker">Studio Base URL</div>
          <div style={{ fontWeight: 600, marginTop: 4, wordBreak: 'break-word' }}>
            {studio.base_url || '—'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Last success: {formatDateTime(studio.last_ok_at)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Cache age: {studio.cache_age_seconds ?? '—'}s / TTL {studio.cache_ttl_seconds ?? '—'}s
          </div>
        </div>
        <div className="card tight">
          <div className="kicker">Studio Meta</div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>
            {studio.studio_meta?.app || '—'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Service: {studio.studio_meta?.service || '—'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Env: {studio.studio_meta?.env || '—'}
          </div>
        </div>
        <div className="card tight">
          <div className="kicker">Default Mode</div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>
            {summary.v1_meta?.default_billing_mode || 'POSTPAID'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Reconcile endpoint: {studio.reconcile_endpoint || '—'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Error: {studio.error || 'none'}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Card>
          <CardHeader
            title="Accounts"
            subtitle="Referral Channel + client billing mode, credit state, and Studio sync health."
            action={<Badge tone="muted">{summary.accounts?.length || 0} accounts</Badge>}
          />
          {loadingSummary ? (
            <div className="muted">Loading accounts…</div>
          ) : !summary.accounts || summary.accounts.length === 0 ? (
            <EmptyState>No accounts found.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Display Name</th>
                    <th>External Key</th>
                    <th>Mode</th>
                    <th>Credits</th>
                    <th>Last Event</th>
                    <th>Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.accounts.map((row) => {
                    const selected = row.external_key === selectedKey
                    return (
                      <tr
                        key={row.external_key}
                        onClick={() => handleSelectAccount(row.external_key)}
                        style={{ cursor: 'pointer', background: selected ? 'var(--surface-2, #f6f7f9)' : undefined }}
                      >
                        <td>
                          <div style={{ fontWeight: 600 }}>{row.display_name}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{titleCase(row.entity_type)}</div>
                        </td>
                        <td>
                          <code>{row.external_key}</code>
                          <div>
                            <button
                              type="button"
                              className="link-button"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleCopy(row.external_key)
                              }}
                            >
                              Copy external_key
                            </button>
                          </div>
                        </td>
                        <td>
                          <Badge tone={billingModeTone(row.billing_mode)}>
                            {row.billing_mode}
                          </Badge>
                        </td>
                        <td>
                          <div style={{ fontSize: 12 }}>
                            W: {row.credit?.wallet ?? 0} / R: {row.credit?.reserved ?? 0} / A: {row.credit?.available ?? 0}
                          </div>
                        </td>
                        <td>{formatDateTime(row.last_event_at)}</td>
                        <td>
                          {row.warnings?.length ? row.warnings.join(', ') : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Account Detail"
            subtitle={selectedAccount?.display_name || 'Select an account'}
          />
          {!selectedAccount ? (
            <EmptyState>Select an account row to inspect reservations and timeline.</EmptyState>
          ) : (
            <div>
              <div style={{ marginBottom: 8 }}>
                <Badge tone={billingModeTone(selectedAccount.billing_mode)}>{selectedAccount.billing_mode}</Badge>
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {selectedAccount.external_key}
              </div>
              <div style={{ marginBottom: 8 }}>
                Credits: W {selectedAccount.credit?.wallet ?? 0} / R {selectedAccount.credit?.reserved ?? 0} / A {selectedAccount.credit?.available ?? 0}
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => loadDetail(selectedAccount.external_key, true)}
                disabled={loadingDetail}
              >
                {loadingDetail ? 'Refreshing…' : 'Refresh account detail'}
              </button>
              {detailError ? <div className="muted" style={{ marginTop: 8 }}>{detailError}</div> : null}
              {detail ? (
                <>
                  <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                    Studio status: {detail.studio_status?.reachable ? 'reachable' : 'unreachable'}
                    {detail.studio_status?.stale ? ' (cached)' : ''}
                  </div>
                  <JsonPanel title="Raw JSON (sanitized)" payload={detail.raw_json} />
                </>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Activity Streams"
          subtitle="V1 operational truth + V2 credit activity for selected account."
          action={(
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={activeTab === 'invoices' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('invoices')}
              >
                V1 Invoices
              </button>
              <button
                type="button"
                className={activeTab === 'payments' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('payments')}
              >
                V1 Payments
              </button>
              <button
                type="button"
                className={activeTab === 'credits' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('credits')}
              >
                V2 Credits
              </button>
            </div>
          )}
        />

        {activeTab === 'invoices' && (
          !summary.v1_invoices?.length ? (
            <EmptyState>No recent invoices.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice No</th>
                    <th>Counterparty</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th>Paid Date</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.v1_invoices.map((row) => (
                    <tr key={row.invoice_id}>
                      <td>{row.invoice_no || `#${row.invoice_id}`}</td>
                      <td>{row.counterparty}</td>
                      <td>{formatMoney(row.amount, row.currency)}</td>
                      <td>{row.status}</td>
                      <td>{formatDate(row.due_date)}</td>
                      <td>{formatDateTime(row.paid_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {activeTab === 'payments' && (
          !summary.v1_payments?.length ? (
            <EmptyState>No recent payments.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Reference</th>
                    <th>Invoice</th>
                    <th>Counterparty</th>
                    <th>Paid At</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.v1_payments.map((row) => (
                    <tr key={row.payment_id}>
                      <td>{row.method}</td>
                      <td>{formatMoney(row.amount, 'INR')}</td>
                      <td>{row.reference || '—'}</td>
                      <td>{row.invoice_no || (row.invoice_id ? `#${row.invoice_id}` : '—')}</td>
                      <td>{row.counterparty}</td>
                      <td>{formatDateTime(row.paid_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {activeTab === 'credits' && (
          !detail ? (
            <EmptyState>Select an account to inspect V2 reservations/ledger/timeline.</EmptyState>
          ) : (
            <div className="grid cols-3">
              <div className="card tight">
                <div className="kicker">Reservations</div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {detail.reservations?.length || 0} rows
                </div>
                <div className="list" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {(detail.reservations || []).slice(0, 15).map((row) => (
                    <div key={row.id || `${row.ref_type}:${row.ref_id}:${row.created_at}`} className="list-item">
                      <div style={{ fontWeight: 600 }}>{(row.status || 'UNKNOWN').toUpperCase()}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {row.ref_type || 'ref'}:{row.ref_id || '—'} · {row.amount ?? 0}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card tight">
                <div className="kicker">Ledger</div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {detail.ledger?.length || 0} rows
                </div>
                <div className="list" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {(detail.ledger || []).slice(0, 15).map((row) => (
                    <div key={row.id || `${row.idempotency_key}:${row.created_at}`} className="list-item">
                      <div style={{ fontWeight: 600 }}>{row.reason || 'EVENT'}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        delta: {row.delta ?? 0} · {formatDateTime(row.created_at || row.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card tight">
                <div className="kicker">Timeline</div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {detail.timeline?.length || 0} rows
                </div>
                <div className="list" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {(detail.timeline || []).slice(0, 15).map((row, index) => (
                    <div key={row.id || row.idempotency_key || `${row.event_type}:${index}`} className="list-item">
                      <div style={{ fontWeight: 600 }}>{row.event_type || row.source || 'EVENT'}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {formatDateTime(row.timestamp || row.created_at || row.updated_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        )}
      </Card>
    </div>
  )
}
