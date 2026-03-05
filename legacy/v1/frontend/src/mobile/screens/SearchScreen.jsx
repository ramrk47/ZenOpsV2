import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { MobileEmptyState, SearchBar, Section } from '../components/Primitives'
import { fetchAssignments } from '../../api/assignments'
import { fetchApprovalsInbox } from '../../api/approvals'
import { fetchInvoices } from '../../api/invoices'
import { useAuth } from '../../auth/AuthContext'
import { hasCapability } from '../../utils/rbac'
import { toUserMessage } from '../../api/client'

export default function SearchScreen() {
  const { capabilities } = useAuth()
  const canApprove = hasCapability(capabilities, 'approve_actions')
  const canViewInvoices = hasCapability(capabilities, 'view_invoices')

  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ assignments: [], approvals: [], invoices: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSearch = query.trim().length >= 2

  async function handleSearch(nextQuery) {
    setQuery(nextQuery)
    if (nextQuery.trim().length < 2) {
      setResults({ assignments: [], approvals: [], invoices: [] })
      setError('')
      return
    }

    setLoading(true)
    setError('')
    try {
      const [assignmentRows, approvalsRows, invoiceRows] = await Promise.all([
        fetchAssignments({ completion: 'ALL', limit: 40, client_name: nextQuery.trim(), sort_by: 'updated_at', sort_dir: 'desc' }),
        canApprove ? fetchApprovalsInbox(true) : Promise.resolve([]),
        canViewInvoices ? fetchInvoices({ page_size: 20, search: nextQuery.trim() }) : Promise.resolve({ items: [] }),
      ])

      const lower = nextQuery.toLowerCase()
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
      })
    } catch (err) {
      setError(toUserMessage(err, 'Search failed.'))
    } finally {
      setLoading(false)
    }
  }

  const total = useMemo(
    () => results.assignments.length + results.approvals.length + results.invoices.length,
    [results],
  )

  return (
    <MobileLayout title="Search" subtitle="Quick global search" secondaryAction={{ label: 'Back', to: '/m/home' }}>
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}
      <SearchBar value={query} onChange={handleSearch} placeholder="Search assignment code / customer / invoice" />

      {!canSearch ? <p className="m-muted-note">Type at least 2 characters.</p> : null}
      {loading ? <p className="m-muted-note">Searching…</p> : null}

      {canSearch && !loading && total === 0 ? (
        <MobileEmptyState title="No matches" body="Try another keyword." />
      ) : null}

      <Section title="Assignments" subtitle={`${results.assignments.length}`}>
        <div className="m-list">
          {results.assignments.slice(0, 10).map((row) => (
            <Link key={row.id} className="m-list-card" to={`/m/assignments/${row.id}`}>
              <strong>{row.assignment_code || `#${row.id}`}</strong>
              <p>{row.bank_name || row.valuer_client_name || row.borrower_name || 'Unknown'}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Invoices" subtitle={`${results.invoices.length}`}>
        <div className="m-list">
          {results.invoices.slice(0, 10).map((row) => (
            <Link key={row.id} className="m-list-card" to="/m/invoices">
              <strong>{row.invoice_number || `Invoice #${row.id}`}</strong>
              <p>{row.assignment_code || 'No assignment'} · Due {row.amount_due}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Approvals" subtitle={`${results.approvals.length}`}>
        <div className="m-list">
          {results.approvals.slice(0, 10).map((row) => (
            <Link key={row.id} className="m-list-card" to="/m/approvals">
              <strong>{row.entity_summary || `${row.entity_type} #${row.entity_id}`}</strong>
              <p>{row.approval_type || row.action_type}</p>
            </Link>
          ))}
        </div>
      </Section>
    </MobileLayout>
  )
}
