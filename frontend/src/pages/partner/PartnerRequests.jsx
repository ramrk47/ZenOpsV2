import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import InfoTip from '../../components/ui/InfoTip'
import DataTable from '../../components/ui/DataTable'
import { fetchPartnerAssignments, fetchPartnerCommission, fetchPartnerCommissions } from '../../api/partner'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { loadJson, saveJson } from '../../utils/storage'

const STATUS_OPTIONS = ['ALL', 'DRAFT', 'SUBMITTED', 'NEEDS_INFO', 'APPROVED', 'CONVERTED', 'REJECTED']
const FILTERS_KEY = 'zenops.partner.requests.filters.v1'

function statusTone(status) {
  if (status === 'NEEDS_INFO') return 'warn'
  if (status === 'SUBMITTED') return 'info'
  if (status === 'APPROVED' || status === 'CONVERTED') return 'ok'
  if (status === 'REJECTED') return 'danger'
  return 'muted'
}

function paymentTone(status) {
  if (status === 'VERIFIED') return 'ok'
  if (status === 'PROOF_SUBMITTED') return 'info'
  if (status === 'REQUESTED') return 'warn'
  return 'muted'
}

export default function PartnerRequests() {
  const [searchParams] = useSearchParams()
  const [commissions, setCommissions] = useState([])
  const [commissionDetails, setCommissionDetails] = useState(new Map())
  const [assignments, setAssignments] = useState([])
  const [filters, setFilters] = useState(() => loadJson(FILTERS_KEY, {
    status: 'ALL',
    search: '',
    paymentPending: false,
  }))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [commissionData, assignmentData] = await Promise.all([
          fetchPartnerCommissions(),
          fetchPartnerAssignments().catch(() => []),
        ])
        if (cancelled) return
        setCommissions(commissionData)
        setAssignments(assignmentData)

        const detailEntries = await Promise.all(
          commissionData.map(async (commission) => {
            try {
              const detail = await fetchPartnerCommission(commission.id)
              return [commission.id, detail]
            } catch (err) {
              return [commission.id, null]
            }
          }),
        )
        if (cancelled) return
        setCommissionDetails(new Map(detailEntries.filter(([, detail]) => detail)))
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load requests'))
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
    const statusParam = searchParams.get('status')
    const filterParam = searchParams.get('filter')
    const paymentParam = searchParams.get('payment')
    setFilters((prev) => {
      const next = { ...prev }
      let changed = false
      if (statusParam && STATUS_OPTIONS.includes(statusParam)) {
        next.status = statusParam
        changed = true
      }
      if (filterParam === 'docs') {
        next.status = 'NEEDS_INFO'
        changed = true
      }
      if (paymentParam === 'pending') {
        next.paymentPending = true
        changed = true
      }
      return changed ? next : prev
    })
  }, [searchParams])

  useEffect(() => {
    saveJson(FILTERS_KEY, filters)
  }, [filters])

  const assignmentMap = useMemo(() => {
    const map = new Map()
    assignments.forEach((assignment) => map.set(assignment.id, assignment))
    return map
  }, [assignments])

  const rows = useMemo(() => {
    const search = filters.search.trim().toLowerCase()
    return commissions.filter((commission) => {
      if (filters.status !== 'ALL' && commission.status !== filters.status) return false
      if (search) {
        const haystack = `${commission.request_code} ${commission.borrower_name || ''} ${commission.bank_name || ''} ${commission.branch_name || ''}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }

      if (filters.paymentPending) {
        const detail = commissionDetails.get(commission.id)
        const assignment = detail?.converted_assignment_id ? assignmentMap.get(detail.converted_assignment_id) : null
        const paymentStatus = assignment?.payment_status || 'NOT_REQUESTED'
        if (!['REQUESTED', 'PROOF_SUBMITTED'].includes(paymentStatus)) return false
      }

      return true
    })
  }, [commissions, filters, commissionDetails, assignmentMap])

  return (
    <div>
      <PageHeader
        title="My Requests"
        subtitle="Track commission submissions, document requests, and payment unlocks."
        actions={(
          <Link className="nav-link" to="/partner/requests/new">New Request</Link>
        )}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      <Card>
        <CardHeader
          title="Requests"
          subtitle="Partner-facing status and next actions only."
          action={<InfoTip text="Payment status updates after invoice requests and proof verification." />}
        />

        <div className="filter-shell" style={{ marginBottom: '0.8rem' }}>
          <div className="toolbar dense">
            <input
              className="grow"
              placeholder="Search request code, borrower, bank"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            />
            <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
              {filtersOpen ? 'Hide Filters' : 'Filters'}
            </button>
            <Badge tone="info">{rows.length} shown</Badge>
          </div>
          {filtersOpen ? (
            <div className="filter-panel">
              <div className="filter-grid">
                <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{titleCase(status)}</option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={filters.paymentPending}
                    onChange={(e) => setFilters((prev) => ({ ...prev, paymentPending: e.target.checked }))}
                  />
                  Payment pending
                </label>
              </div>
            </div>
          ) : null}
        </div>

        {loading ? (
          <DataTable loading columns={8} rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState>No matching requests.</EmptyState>
        ) : (
          <DataTable>
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Borrower / Property</th>
                  <th>Bank / Branch</th>
                  <th>Status</th>
                  <th>Service Line</th>
                  <th>Payment</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((commission) => {
                  const detail = commissionDetails.get(commission.id)
                  const assignment = detail?.converted_assignment_id ? assignmentMap.get(detail.converted_assignment_id) : null
                  const paymentStatus = assignment?.payment_status || 'NOT_REQUESTED'
                  return (
                    <tr key={commission.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <strong>{commission.request_code}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>{titleCase(commission.status)}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span>{commission.borrower_name || '—'}</span>
                          <span className="muted" style={{ fontSize: 12 }}>{commission.branch_name || commission.bank_name || '—'}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span>{commission.bank_name || '—'}</span>
                          <span className="muted" style={{ fontSize: 12 }}>{commission.branch_name || '—'}</span>
                        </div>
                      </td>
                      <td><Badge tone={statusTone(commission.status)}>{titleCase(commission.status)}</Badge></td>
                      <td>{commission.service_line || '—'}</td>
                      <td><Badge tone={paymentTone(paymentStatus)}>{titleCase(paymentStatus)}</Badge></td>
                      <td>{formatDateTime(commission.updated_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <Link className="nav-link" to={`/partner/requests/${commission.id}`}>Open</Link>
                          {['DRAFT', 'NEEDS_INFO'].includes(commission.status) ? (
                            <Link className="nav-link" to={`/partner/requests/new?draft=${commission.id}`}>Edit</Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DataTable>
        )}
      </Card>
    </div>
  )
}
