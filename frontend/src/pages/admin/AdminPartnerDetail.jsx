import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import { fetchPartnerSummary, fetchPartnerBankBreakdown } from '../../api/analytics'
import { fetchAdminCommissions } from '../../api/partnerAdmin'
import { formatDateTime, formatMoney, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

export default function AdminPartnerDetail() {
  const { id } = useParams()
  const partnerId = Number(id)

  const [partner, setPartner] = useState(null)
  const [breakdown, setBreakdown] = useState([])
  const [commissions, setCommissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [summaryData, breakdownData, commissionData] = await Promise.all([
          fetchPartnerSummary().catch(() => []),
          fetchPartnerBankBreakdown(partnerId).catch(() => []),
          fetchAdminCommissions({ partner_id: partnerId }).catch(() => []),
        ])
        if (cancelled) return
        const match = summaryData.find((row) => row.id === partnerId)
        setPartner(match || null)
        setBreakdown(breakdownData)
        setCommissions(commissionData)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load partner detail'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [partnerId])

  const unpaidTotal = partner ? Number(partner.unpaid_total || 0) : 0

  const headerActions = partner ? (
    <Badge tone={unpaidTotal > 0 ? 'warn' : 'ok'}>{formatMoney(unpaidTotal)} outstanding</Badge>
  ) : null

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Partner"
          subtitle="Loading partner overview."
          actions={<Badge tone="info">Loading</Badge>}
        />

        <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={`sk-stat-${idx}`} className="card tight">
              <div className="skeleton-line short" style={{ marginBottom: '0.6rem' }} />
              <div className="skeleton-line" style={{ height: 20 }} />
            </div>
          ))}
        </div>

        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)' }}>
          <Card>
            <CardHeader title="Requests" subtitle="Commission request history." />
            <DataTable loading columns={5} rows={4} />
          </Card>

          <Card>
            <CardHeader title="Bank/Branch Breakdown" subtitle="Assignments sourced by this partner." />
            <DataTable loading columns={6} rows={4} />
          </Card>
        </div>
      </div>
    )
  }
  if (error) return <div className="empty">{error}</div>
  if (!partner) return <EmptyState>Partner not found.</EmptyState>

  return (
    <div>
      <PageHeader
        title={partner.display_name}
        subtitle={`Contact: ${partner.contact_name || '—'} · ${partner.email || '—'}`}
        actions={headerActions}
      />

      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        <Stat label="Commissions" value={partner.commission_count} help="Total commissions submitted." />
        <Stat label="Converted" value={partner.converted_count} tone="ok" help="Commissions converted to assignments." />
        <Stat label="Outstanding" value={formatMoney(unpaidTotal)} tone="warn" help="Unpaid invoice exposure." />
        <Stat label="Last Activity" value={partner.last_activity_at ? formatDateTime(partner.last_activity_at) : '—'} help="Latest commission or invoice activity." />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)' }}>
        <Card>
          <CardHeader title="Requests" subtitle="Commission request history." />
          {commissions.length === 0 ? (
            <EmptyState>No commission requests yet.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Borrower</th>
                    <th>Bank</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((commission) => (
                    <tr key={commission.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <strong>{commission.request_code}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>#{commission.id}</span>
                        </div>
                      </td>
                      <td><Badge tone={commission.status === 'REJECTED' ? 'danger' : commission.status === 'NEEDS_INFO' ? 'warn' : 'info'}>{titleCase(commission.status)}</Badge></td>
                      <td>{commission.borrower_name || '—'}</td>
                      <td>{commission.bank_name || '—'}</td>
                      <td>{formatDateTime(commission.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Bank/Branch Breakdown" subtitle="Assignments sourced by this partner." />
          {breakdown.length === 0 ? (
            <EmptyState>No partner-linked assignments yet.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Bank</th>
                    <th>Branch</th>
                    <th>Assignments</th>
                    <th>Invoice Total</th>
                    <th>Paid</th>
                    <th>Unpaid</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((row) => (
                    <tr key={`${row.bank_id}-${row.branch_id || 'na'}`}>
                      <td>{row.bank_name || '—'}</td>
                      <td>{row.branch_name || '—'}</td>
                      <td>{row.assignment_count}</td>
                      <td>{formatMoney(row.invoice_total || 0)}</td>
                      <td>{formatMoney(row.invoice_paid || 0)}</td>
                      <td>{formatMoney(row.invoice_unpaid || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Stat({ label, value, tone, help }) {
  const style = tone ? { color: `var(--${tone})` } : undefined
  return (
    <div className="card tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <span className="muted" style={{ fontSize: 11 }}>{help}</span> : null}
      </div>
      <div className="stat-value" style={style}>{value}</div>
    </div>
  )
}
