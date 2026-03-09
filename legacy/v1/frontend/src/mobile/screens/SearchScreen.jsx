import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, MobileEmptyState, SearchBar, Section } from '../components/Primitives'
import { fetchAssignments } from '../../api/assignments'
import { fetchApprovalsInbox } from '../../api/approvals'
import { fetchInvoices } from '../../api/invoices'
import { fetchMobileSummary } from '../../api/mobile'
import { fetchPartnerNotifications } from '../../api/partner'
import { useAuth } from '../../auth/AuthContext'
import { hasCapability, isPartner } from '../../utils/rbac'
import { toUserMessage } from '../../api/client'

export default function SearchScreen() {
  const { user, capabilities } = useAuth()
  const canApprove = hasCapability(capabilities, 'approve_actions')
  const canViewInvoices = hasCapability(capabilities, 'view_invoices')
  const partnerMode = isPartner(user)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ assignments: [], approvals: [], invoices: [], alerts: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSearch = query.trim().length >= 2

  async function handleSearch(nextQuery) {
    setQuery(nextQuery)
    if (nextQuery.trim().length < 2) {
      setResults({ assignments: [], approvals: [], invoices: [], alerts: [] })
      setError('')
      return
    }

    setLoading(true)
    setError('')
    try {
      const lower = nextQuery.toLowerCase()
      if (partnerMode) {
        const [summaryData, alertRows] = await Promise.all([
          fetchMobileSummary(),
          fetchPartnerNotifications({ unread_only: false, search: nextQuery.trim(), limit: 20 }),
        ])
        const filteredAssignments = (summaryData?.my_queue || []).filter((row) => (
          [
            row.assignment_code,
            row.bank_or_client,
            row.borrower_name,
            row.next_action,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(lower)
        ))
        setResults({
          assignments: filteredAssignments,
          approvals: [],
          invoices: [],
          alerts: alertRows || [],
        })
      } else {
        const [assignmentRows, approvalsRows, invoiceRows] = await Promise.all([
          fetchAssignments({ completion: 'ALL', limit: 40, client_name: nextQuery.trim(), sort_by: 'updated_at', sort_dir: 'desc' }),
          canApprove ? fetchApprovalsInbox(true) : Promise.resolve([]),
          canViewInvoices ? fetchInvoices({ page_size: 20, search: nextQuery.trim() }) : Promise.resolve({ items: [] }),
        ])

        const filteredApprovals = (approvalsRows || []).filter((row) => (
          [row.entity_summary, row.assignment_code, row.invoice_number, row.reason]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(lower)
        ))

        setResults({
          assignments: assignmentRows || [],
          approvals: filteredApprovals,
          invoices: invoiceRows?.items || [],
          alerts: [],
        })
      }
    } catch (err) {
      setError(toUserMessage(err, 'Search failed.'))
    } finally {
      setLoading(false)
    }
  }

  const total = useMemo(
    () => results.assignments.length + results.approvals.length + results.invoices.length + results.alerts.length,
    [results],
  )

  return (
    <MobileLayout title="Search" subtitle="Find requests, alerts, and invoices quickly" secondaryAction={{ label: 'Back', to: '/m/home' }}>
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}

      <Section title="Search Scope" subtitle={partnerMode ? 'Requests, alerts, and invoices in one mobile pass.' : 'Assignments, approvals, and invoices in one mobile pass.'} className="m-search-scope" >
        <div className="m-stat-grid">
          <Card className="m-stat-card">
            <p>{partnerMode ? 'Requests' : 'Assignments'}</p>
            <strong>{results.assignments.length}</strong>
            <small>{partnerMode ? 'Matching requests in your mobile workspace.' : 'Matching work items in the current search.'}</small>
          </Card>
          <Card className="m-stat-card">
            <p>{partnerMode ? 'Alerts' : 'Approvals'}</p>
            <strong>{partnerMode ? results.alerts.length : results.approvals.length}</strong>
            <small>{partnerMode ? 'Partner notifications matching the same term.' : 'Approval requests matching the same term.'}</small>
          </Card>
          <Card className="m-stat-card">
            <p>Invoices</p>
            <strong>{results.invoices.length}</strong>
            <small>{partnerMode ? 'Invoices matching the same request or customer term.' : 'Invoice records matching the term.'}</small>
          </Card>
          <Card className="m-stat-card">
            <p>Total</p>
            <strong>{total}</strong>
            <small>Combined mobile search result count.</small>
          </Card>
        </div>
      </Section>

      <div data-tour-id="mobile-search-screen">
        <SearchBar value={query} onChange={handleSearch} placeholder={partnerMode ? 'Search request code / customer / invoice' : 'Search assignment code / customer / invoice'} />
      </div>

      {!canSearch ? <p className="m-muted-note">Type at least 2 characters.</p> : null}
      {loading ? <p className="m-muted-note">Searching…</p> : null}

      {canSearch && !loading && total === 0 ? (
        <MobileEmptyState
          title="No matches"
          body="Try another keyword."
          action={<button type="button" className="m-link-btn" onClick={() => handleSearch('')}>Clear search</button>}
        />
      ) : null}

      <Section title={partnerMode ? 'Requests' : 'Assignments'} subtitle={`${results.assignments.length}`}>
        <div className="m-list">
          {results.assignments.slice(0, 10).map((row) => (
            <Link key={row.id} className="m-list-card" to={`/m/assignments/${row.id}`}>
              <strong>{row.assignment_code || `#${row.id}`}</strong>
              <p>{row.bank_name || row.valuer_client_name || row.borrower_name || 'Unknown'}</p>
              <div className="m-list-keyline">
                <span>{row.branch_name || row.address || 'No location'}</span>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {!partnerMode ? (
        <Section title="Invoices" subtitle={`${results.invoices.length}`}>
          <div className="m-list">
            {results.invoices.slice(0, 10).map((row) => (
              <Link key={row.id} className="m-list-card" to="/m/invoices">
                <strong>{row.invoice_number || `Invoice #${row.id}`}</strong>
                <p>{row.assignment_code || 'No assignment'} · Due {row.amount_due}</p>
                <div className="m-list-keyline">
                  <span>{row.status || 'Unknown status'}</span>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={partnerMode ? 'Alerts' : 'Approvals'} subtitle={`${partnerMode ? results.alerts.length : results.approvals.length}`}>
        <div className="m-list">
          {(partnerMode ? results.alerts : results.approvals).slice(0, 10).map((row) => (
            <Link key={row.id} className="m-list-card" to={partnerMode ? '/m/notifications' : '/m/approvals'}>
              <strong>{partnerMode ? (row.message || `Alert #${row.id}`) : (row.entity_summary || `${row.entity_type} #${row.entity_id}`)}</strong>
              <p>{partnerMode ? row.type : (row.approval_type || row.action_type)}</p>
              <div className="m-list-keyline">
                <span>{row.status || (row.read_at ? 'Read' : 'Unread') || 'Unknown status'}</span>
              </div>
            </Link>
          ))}
        </div>
      </Section>
    </MobileLayout>
  )
}
