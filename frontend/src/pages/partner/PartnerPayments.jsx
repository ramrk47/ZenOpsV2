import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import InfoTip from '../../components/ui/InfoTip'
import DataTable from '../../components/ui/DataTable'
import { fetchPartnerInvoices, fetchPartnerRequests, respondPartnerRequest, uploadPartnerRequestAttachment } from '../../api/partner'
import { formatDate, formatMoney, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { loadJson, saveJson } from '../../utils/storage'

const FILTERS_KEY = 'zenops.partner.payments.filters.v1'

function paymentTone(status) {
  if (status === 'PAID' || status === 'VERIFIED') return 'ok'
  if (status === 'PROOF_SUBMITTED') return 'info'
  if (status === 'REQUESTED') return 'warn'
  return 'muted'
}

export default function PartnerPayments() {
  const [searchParams] = useSearchParams()
  const [invoices, setInvoices] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [drafts, setDrafts] = useState({})
  const storedFilters = loadJson(FILTERS_KEY, { showPendingOnly: false })
  const [showPendingOnly, setShowPendingOnly] = useState(Boolean(storedFilters.showPendingOnly))
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    saveJson(FILTERS_KEY, { showPendingOnly })
  }, [showPendingOnly])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [invoiceData, requestData] = await Promise.all([
          fetchPartnerInvoices().catch(() => []),
          fetchPartnerRequests({ status: 'OPEN' }).catch(() => []),
        ])
        if (cancelled) return
        setInvoices(invoiceData)
        setRequests(requestData)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load payments'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const filterParam = searchParams.get('filter')
    if (filterParam === 'pending') {
      setShowPendingOnly(true)
    }
  }, [searchParams])

  const paymentRequests = useMemo(() => (
    requests.filter((req) => req.request_type === 'PAYMENT_REQUESTED')
  ), [requests])

  async function handleRespond(requestId) {
    const draft = drafts[requestId] || {}
    if (!draft.message && !draft.file) {
      setNotice('Add a message or upload a file before submitting proof.')
      return
    }
    setNotice(null)
    try {
      if (draft.file) {
        await uploadPartnerRequestAttachment(requestId, { file: draft.file, message: draft.message })
      } else {
        await respondPartnerRequest(requestId, { message: draft.message })
      }
      setDrafts((prev) => ({ ...prev, [requestId]: { message: '', file: null } }))
      setNotice('Payment proof submitted.')
      const refreshed = await fetchPartnerRequests({ status: 'OPEN' }).catch(() => [])
      setRequests(refreshed)
    } catch (err) {
      console.error(err)
      setNotice(toUserMessage(err, 'Failed to submit payment proof'))
    }
  }

  const unpaidCount = invoices.filter((inv) => !inv.is_paid).length
  const visibleInvoices = showPendingOnly ? invoices.filter((inv) => !inv.is_paid) : invoices

  return (
    <div>
      <PageHeader
        title="Payments & Invoices"
        subtitle="Upload payment proof to unlock deliverables."
        actions={<Badge tone={unpaidCount > 0 ? 'warn' : 'ok'}>{unpaidCount} unpaid</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}
      {notice ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{notice}</div> : null}

      <div className="grid" style={{ gap: '1rem' }}>
          <Card>
            <CardHeader
              title="Invoices"
              subtitle="Official payment requests raised by admin."
              action={(
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <InfoTip text="Invoices show totals and GST for audit readiness." />
                </div>
              )}
            />
            <div className="filter-shell" style={{ marginBottom: '0.8rem' }}>
              <div className="toolbar dense">
                <div className="chip-row">
                  <button
                    type="button"
                    className={`chip ${showPendingOnly ? 'active' : ''}`.trim()}
                    onClick={() => setShowPendingOnly((prev) => !prev)}
                    aria-pressed={showPendingOnly}
                  >
                    Pending only
                  </button>
                </div>
                <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
                  {filtersOpen ? 'Hide Filters' : 'Filters'}
                </button>
                <Badge tone="info">{visibleInvoices.length} shown</Badge>
              </div>
              {filtersOpen ? (
                <div className="filter-panel">
                  <div className="filter-grid">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={showPendingOnly}
                        onChange={(e) => setShowPendingOnly(e.target.checked)}
                      />
                      Unpaid invoices only
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
            {loading ? (
              <DataTable loading columns={5} rows={5} />
            ) : visibleInvoices.length === 0 ? (
              <EmptyState>No invoices yet.</EmptyState>
            ) : (
              <DataTable>
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Issued</th>
                      <th>Due</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <strong>{invoice.invoice_number || `INV-${invoice.id}`}</strong>
                            <span className="muted" style={{ fontSize: 12 }}>{titleCase(invoice.status)}</span>
                          </div>
                        </td>
                        <td>{formatDate(invoice.issued_date)}</td>
                        <td>{formatDate(invoice.due_date)}</td>
                        <td>{formatMoney(invoice.total_amount)}</td>
                        <td>
                          <Badge tone={invoice.is_paid ? 'ok' : 'warn'}>{invoice.is_paid ? 'Paid' : 'Unpaid'}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataTable>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Payment Requests"
              subtitle="Upload proof for open payment requests."
            />
            {loading ? (
              <div className="muted">Loading payment requests…</div>
            ) : paymentRequests.length === 0 ? (
              <EmptyState>No payment requests pending.</EmptyState>
            ) : (
              <div className="list">
                {paymentRequests.map((req) => (
                  <div key={req.id} className="list-item" style={{ flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>Payment Requested</div>
                        <div className="muted" style={{ fontSize: 12 }}>{req.message}</div>
                      </div>
                      <Badge tone={paymentTone('REQUESTED')}>Open</Badge>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="Add payment reference or notes"
                      value={drafts[req.id]?.message || ''}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [req.id]: { ...prev[req.id], message: e.target.value } }))}
                    />
                    <input
                      type="file"
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [req.id]: { ...prev[req.id], file: e.target.files?.[0] || null } }))}
                    />
                    <button type="button" onClick={() => handleRespond(req.id)}>Submit Payment Proof</button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
  )
}
