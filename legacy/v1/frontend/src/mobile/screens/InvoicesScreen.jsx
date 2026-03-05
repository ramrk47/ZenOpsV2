import React, { useEffect, useMemo, useState } from 'react'
import MobileLayout from '../MobileLayout'
import { BottomSheet, Chip, MobileEmptyState, MobileListSkeleton, SearchBar, Section } from '../components/Primitives'
import { addInvoicePayment, fetchInvoice, fetchInvoices } from '../../api/invoices'
import { formatDate, formatMoney, titleCase } from '../../utils/format'
import { useAuth } from '../../auth/AuthContext'
import { hasCapability } from '../../utils/rbac'
import { toUserMessage } from '../../api/client'

const STATUS_FILTERS = ['ALL', 'ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID']

export default function InvoicesScreen() {
  const { capabilities } = useAuth()
  const canViewInvoices = hasCapability(capabilities, 'view_invoices')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [paymentForm, setPaymentForm] = useState({ amount: '', mode: 'UPI', reference_no: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!canViewInvoices) return undefined

    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await fetchInvoices({
          page_size: 40,
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          search: query || undefined,
        })
        if (!cancelled) setRows(data?.items || [])
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Unable to load invoices.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const timeout = window.setTimeout(load, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [canViewInvoices, query, statusFilter])

  const unpaidCount = useMemo(
    () => rows.filter((row) => Number(row.amount_due || 0) > 0).length,
    [rows],
  )

  async function openInvoice(row) {
    try {
      const detail = await fetchInvoice(row.id)
      setSelectedInvoice(detail)
    } catch (err) {
      setError(toUserMessage(err, 'Unable to open invoice detail.'))
    }
  }

  async function handleAddPayment(event) {
    event.preventDefault()
    if (!selectedInvoice) return

    setSubmitting(true)
    setError('')
    try {
      const updated = await addInvoicePayment(selectedInvoice.id, {
        amount: Number(paymentForm.amount),
        mode: paymentForm.mode,
        reference_no: paymentForm.reference_no || null,
        notes: paymentForm.notes || null,
      })
      setSelectedInvoice(updated)
      setPaymentForm({ amount: '', mode: 'UPI', reference_no: '', notes: '' })
      setRows((prev) => prev.map((row) => (row.id === updated.id ? { ...row, amount_due: updated.amount_due, amount_paid: updated.amount_paid, status: updated.status } : row)))
    } catch (err) {
      setError(toUserMessage(err, 'Failed to add payment.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!canViewInvoices) {
    return (
      <MobileLayout title="Invoices" subtitle="Admin only">
        <MobileEmptyState title="Invoices unavailable" body="Your role does not have invoice access." />
      </MobileLayout>
    )
  }

  return (
    <MobileLayout title="Invoices" subtitle={`${unpaidCount} unpaid`} primaryAction={{ label: 'Search', to: '/m/search' }}>
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}

      <SearchBar value={query} onChange={setQuery} placeholder="Search invoice number / assignment" />

      <div className="m-chip-row">
        {STATUS_FILTERS.map((status) => (
          <Chip key={status} active={statusFilter === status} onClick={() => setStatusFilter(status)}>
            {status === 'ALL' ? 'All' : titleCase(status)}
          </Chip>
        ))}
      </div>

      <Section title="Invoice List" subtitle={`${rows.length} items`}>
        {loading ? <MobileListSkeleton rows={6} /> : null}
        {!loading && rows.length === 0 ? (
          <MobileEmptyState title="No invoices" body="No invoices match current filters." />
        ) : null}

        <div className="m-list">
          {rows.map((row) => (
            <button key={row.id} type="button" className="m-list-card" onClick={() => openInvoice(row)}>
              <div className="m-list-top">
                <strong>{row.invoice_number || `Invoice #${row.id}`}</strong>
                <span className={`m-status ${String(row.status || '').toLowerCase()}`}>{titleCase(row.status)}</span>
              </div>
              <p>{row.assignment_code || 'Assignment N/A'} · {row.party_name || row.bank_name || 'Unknown party'}</p>
              <small>
                Due {formatDate(row.due_date)} · Paid {formatMoney(row.amount_paid, row.currency)} · Due {formatMoney(row.amount_due, row.currency)}
              </small>
            </button>
          ))}
        </div>
      </Section>

      <BottomSheet open={Boolean(selectedInvoice)} title={selectedInvoice?.invoice_number || 'Invoice Detail'} onClose={() => setSelectedInvoice(null)}>
        {selectedInvoice ? (
          <div className="m-form-grid">
            <p><strong>Status:</strong> {titleCase(selectedInvoice.status)}</p>
            <p><strong>Assignment:</strong> {selectedInvoice.assignment_code || selectedInvoice.assignment_id}</p>
            <p><strong>Grand Total:</strong> {formatMoney(selectedInvoice.grand_total, selectedInvoice.currency)}</p>
            <p><strong>Paid:</strong> {formatMoney(selectedInvoice.amount_paid, selectedInvoice.currency)}</p>
            <p><strong>Balance:</strong> {formatMoney(selectedInvoice.amount_due, selectedInvoice.currency)}</p>
            <p><strong>Adjustments:</strong> {formatMoney(selectedInvoice.adjustments_total, selectedInvoice.currency)}</p>

            <form className="m-form-grid" onSubmit={handleAddPayment}>
              <label>
                <span>Add Payment Amount</span>
                <input
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))}
                  inputMode="decimal"
                  required
                />
              </label>
              <label>
                <span>Mode</span>
                <select value={paymentForm.mode} onChange={(e) => setPaymentForm((prev) => ({ ...prev, mode: e.target.value }))}>
                  <option value="UPI">UPI</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="CASH">Cash</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label>
                <span>Reference</span>
                <input
                  value={paymentForm.reference_no}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, reference_no: e.target.value }))}
                />
              </label>
              <label>
                <span>Notes</span>
                <textarea
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                />
              </label>
              <button type="submit" className="m-primary-btn" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Add Payment (Approval Flow)'}
              </button>
            </form>
          </div>
        ) : null}
      </BottomSheet>
    </MobileLayout>
  )
}
