import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import InfoTip from '../components/ui/InfoTip'
import Tabs from '../components/ui/Tabs'
import { Card, CardHeader } from '../components/ui/Card'
import DataTable from '../components/ui/DataTable'
import Drawer from '../components/ui/Drawer'
import EmptyState from '../components/ui/EmptyState'
import {
  addInvoiceAdjustment,
  addInvoicePayment,
  createInvoice,
  deleteInvoiceAttachment,
  downloadInvoiceAttachment,
  exportInvoicesCsv,
  fetchInvoice,
  fetchInvoicePdf,
  fetchInvoices,
  issueInvoice,
  markInvoicePaid,
  sendInvoice,
  sendInvoiceReminder,
  uploadInvoiceAttachment,
  voidInvoice,
} from '../api/invoices'
import { fetchAssignments } from '../api/assignments'
import { fetchBanks, fetchBranches, fetchClients, fetchCompanyAccounts } from '../api/master'
import { formatDate, formatDateTime, formatMoney, titleCase } from '../utils/format'
import { toUserMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { hasCapability } from '../utils/rbac'

function truthyParam(value) {
  if (value === '') return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

const FILTER_STORAGE_KEY = 'zenops:invoice-ledger-filters'
const COLUMN_STORAGE_KEY = 'zenops:invoice-ledger-columns'
const VIEW_STORAGE_KEY = 'zenops:invoice-ledger-views'
const MAX_BULK_REMINDERS = 10
const OVERDUE_FOLLOWUP_DAYS = 7
const DEFAULT_FILTERS = {
  status: '',
  unpaid: '',
  overdue: '',
  search: '',
  issued_from: '',
  issued_to: '',
  due_from: '',
  due_to: '',
  bank_id: '',
  branch_id: '',
  client_id: '',
  amount_min: '',
  amount_max: '',
  sort_by: 'due_date',
  sort_dir: 'asc',
}

const DEFAULT_COLUMNS = {
  assignment: true,
  party: true,
  bank: true,
  issued: true,
  paid: true,
  status: true,
  actions: true,
}

const COLUMN_OPTIONS = [
  { key: 'assignment', label: 'Assignment' },
  { key: 'party', label: 'Party' },
  { key: 'bank', label: 'Bank → Branch' },
  { key: 'issued', label: 'Issued' },
  { key: 'paid', label: 'Paid' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions' },
]

function loadStoredFilters() {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_FILTERS }
    const parsed = JSON.parse(stored)
    return { ...DEFAULT_FILTERS, ...parsed }
  } catch (err) {
    return { ...DEFAULT_FILTERS }
  }
}

function loadStoredColumns() {
  try {
    const stored = localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_COLUMNS }
    const parsed = JSON.parse(stored)
    return { ...DEFAULT_COLUMNS, ...parsed }
  } catch (err) {
    return { ...DEFAULT_COLUMNS }
  }
}

function loadStoredViews() {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    return []
  }
}

function persistColumns(nextColumns) {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(nextColumns))
  } catch (err) {
    // ignore storage failures
  }
}

function persistViews(nextViews) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(nextViews))
  } catch (err) {
    // ignore storage failures
  }
}

function persistFilters(nextFilters) {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(nextFilters))
  } catch (err) {
    // ignore storage failures
  }
}

function generateIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function statusTone(status) {
  if (status === 'PAID') return 'ok'
  if (status === 'PARTIALLY_PAID') return 'warn'
  if (status === 'ISSUED' || status === 'SENT') return 'info'
  if (status === 'VOID') return 'muted'
  return 'accent'
}

function canMarkSent(invoice) {
  return ['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)
}

function canVoidInvoice(invoice) {
  const paid = Number(invoice.amount_paid || 0)
  return invoice.status !== 'VOID' && paid <= 0
}

function agingBucket(days) {
  if (days === null || days === undefined) return 'current'
  if (days <= 7) return '0-7'
  if (days <= 30) return '8-30'
  if (days <= 60) return '31-60'
  return '60+'
}

function toLocalDateInput(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setHours(0, 0, 0, 0)
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 10)
}

export default function InvoicesPage() {
  const { capabilities } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [invoicePage, setInvoicePage] = useState({ items: [], total: 0, page: 1, page_size: 25, has_more: false })
  const [assignments, setAssignments] = useState([])
  const [accounts, setAccounts] = useState([])
  const [banks, setBanks] = useState([])
  const [branches, setBranches] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [pdfLoadingId, setPdfLoadingId] = useState(null)
  const [reminderLoadingId, setReminderLoadingId] = useState(null)
  const [bulkSelection, setBulkSelection] = useState([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkMarking, setBulkMarking] = useState(false)
  const [triggerFollowups, setTriggerFollowups] = useState(false)

  const [filters, setFilters] = useState(() => loadStoredFilters())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [columns, setColumns] = useState(() => loadStoredColumns())
  const [savedViews, setSavedViews] = useState(() => loadStoredViews())
  const [activeViewId, setActiveViewId] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const [createOpen, setCreateOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState('summary')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailReloadKey, setDetailReloadKey] = useState(0)

  const [paymentForm, setPaymentForm] = useState({ amount: '', mode: 'MANUAL', paid_at: '', reference_no: '', notes: '' })
  const [adjustmentForm, setAdjustmentForm] = useState({ amount: '', adjustment_type: 'CREDIT_NOTE', issued_at: '', reason: '' })
  const [attachmentCategory, setAttachmentCategory] = useState('')
  const [attachmentFile, setAttachmentFile] = useState(null)

  const [form, setForm] = useState({
    assignment_id: '',
    issued_date: '',
    due_date: '',
    tax_rate: '0',
    company_account_id: '',
    notes: '',
    bill_to_name: '',
    bill_to_gstin: '',
    place_of_supply: '',
  })

  const canViewInvoices = hasCapability(capabilities, 'view_invoices') || hasCapability(capabilities, 'view_all_assignments')
  const canCreateInvoices = hasCapability(capabilities, 'create_invoice') || hasCapability(capabilities, 'modify_money')
  const canModifyInvoices = hasCapability(capabilities, 'modify_invoice') || hasCapability(capabilities, 'modify_money') || hasCapability(capabilities, 'create_invoice')
  const canRemindInvoices = hasCapability(capabilities, 'modify_money')
  const quickActionsDisabled = drawerOpen

  const colClass = (key, base = '') => {
    const className = columns[key] ? base : `${base} col-hidden`
    return className.trim()
  }

  useEffect(() => {
    let cancelled = false

    async function loadReferenceData() {
      try {
        const [assignmentData, accountData, bankData, branchData, clientData] = await Promise.all([
          fetchAssignments({ completion: 'ALL', limit: 200, sort_by: 'created_at', sort_dir: 'desc' }),
          fetchCompanyAccounts(),
          fetchBanks(),
          fetchBranches(),
          fetchClients(),
        ])
        if (cancelled) return
        setAssignments(assignmentData)
        setAccounts(accountData)
        setBanks(bankData)
        setBranches(branchData)
        setClients(clientData)
        if (!form.assignment_id && assignmentData[0]) {
          setForm((prev) => ({ ...prev, assignment_id: String(assignmentData[0].id) }))
        }
      } catch (err) {
        console.error(err)
      }
    }

    loadReferenceData()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    persistFilters(filters)
  }, [filters])

  useEffect(() => {
    const params = Object.fromEntries(searchParams.entries())
    setFilters((prev) => {
      const next = { ...prev }
      let changed = false
      if (params.status) {
        next.status = params.status
        changed = true
      }
      if (params.unpaid) {
        next.unpaid = params.unpaid
        changed = true
      }
      if (params.overdue) {
        next.overdue = params.overdue
        changed = true
      }
      if (params.search) {
        next.search = params.search
        changed = true
      }
      if (params.aging) {
        const today = new Date()
        const end = toLocalDateInput(today)
        if (params.aging === '0-7') {
          const start = toLocalDateInput(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000))
          next.due_from = start
          next.due_to = end
          next.overdue = 'true'
          changed = true
        } else if (params.aging === '8-30') {
          const start = toLocalDateInput(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000))
          const cutoff = toLocalDateInput(new Date(today.getTime() - 8 * 24 * 60 * 60 * 1000))
          next.due_from = start
          next.due_to = cutoff
          next.overdue = 'true'
          changed = true
        } else if (params.aging === '31-60') {
          const start = toLocalDateInput(new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000))
          const cutoff = toLocalDateInput(new Date(today.getTime() - 31 * 24 * 60 * 60 * 1000))
          next.due_from = start
          next.due_to = cutoff
          next.overdue = 'true'
          changed = true
        } else if (params.aging === '60+') {
          const cutoff = toLocalDateInput(new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000))
          next.due_from = ''
          next.due_to = cutoff
          next.overdue = 'true'
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [searchParams])

  useEffect(() => {
    persistColumns(columns)
  }, [columns])

  useEffect(() => {
    persistViews(savedViews)
  }, [savedViews])

  useEffect(() => {
    if (!canViewInvoices) {
      setLoading(false)
      setError('You do not have permission to view invoices.')
      return
    }

    let cancelled = false

    async function loadInvoices() {
      setLoading(true)
      setError(null)
      setNotice(null)
      try {
        const params = {
          page,
          page_size: pageSize,
          sort_by: filters.sort_by,
          sort_dir: filters.sort_dir,
        }
        if (filters.status) params.status = filters.status
        if (filters.search) params.search = filters.search.trim()
        if (filters.issued_from) params.issued_from = filters.issued_from
        if (filters.issued_to) params.issued_to = filters.issued_to
        if (filters.due_from) params.due_from = filters.due_from
        if (filters.due_to) params.due_to = filters.due_to
        if (filters.bank_id) params.bank_id = Number(filters.bank_id)
        if (filters.branch_id) params.branch_id = Number(filters.branch_id)
        if (filters.client_id) params.client_id = Number(filters.client_id)
        if (filters.amount_min) params.amount_min = Number(filters.amount_min)
        if (filters.amount_max) params.amount_max = Number(filters.amount_max)
        const unpaid = truthyParam(filters.unpaid)
        if (typeof unpaid === 'boolean') params.unpaid = unpaid
        const overdue = truthyParam(filters.overdue)
        if (typeof overdue === 'boolean') params.overdue = overdue
        if (triggerFollowups && canRemindInvoices) {
          params.create_followups = true
          params.overdue_days = OVERDUE_FOLLOWUP_DAYS
        }

        const data = await fetchInvoices(params)
        if (!cancelled) setInvoicePage(data)
        if (!cancelled && triggerFollowups && canRemindInvoices) {
          setNotice('Overdue follow-ups synced.')
          setTriggerFollowups(false)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load invoices'))
        if (!cancelled && triggerFollowups) setTriggerFollowups(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadInvoices()
    return () => {
      cancelled = true
    }
  }, [filters, page, pageSize, reloadKey, triggerFollowups, canViewInvoices, canRemindInvoices])

  useEffect(() => {
    if (!selectedInvoiceId) {
      setSelectedInvoice(null)
      return
    }
    let cancelled = false
    async function loadDetail() {
      setDetailLoading(true)
      try {
        const data = await fetchInvoice(selectedInvoiceId)
        if (!cancelled) {
          setSelectedInvoice(data)
          setPaymentForm((prev) => ({
            ...prev,
            amount: data.amount_due ? String(data.amount_due) : '',
          }))
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load invoice detail'))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }
    loadDetail()
    return () => {
      cancelled = true
    }
  }, [selectedInvoiceId, detailReloadKey])

  const visibleInvoices = invoicePage.items || []

  const stats = useMemo(() => {
    const total = visibleInvoices.length
    const draft = visibleInvoices.filter((i) => i.status === 'DRAFT').length
    const issued = visibleInvoices.filter((i) => i.status === 'ISSUED' || i.status === 'SENT').length
    const paid = visibleInvoices.filter((i) => i.status === 'PAID').length
    const unpaid = visibleInvoices.filter((i) => Number(i.amount_due || 0) > 0).length
    return { total, draft, issued, paid, unpaid }
  }, [visibleInvoices])

  const agingStats = useMemo(() => {
    const buckets = { '0-7': 0, '8-30': 0, '31-60': 0, '60+': 0 }
    visibleInvoices.forEach((invoice) => {
      if (!invoice.is_overdue) return
      const due = invoice.due_date ? new Date(`${invoice.due_date}T00:00:00`) : null
      if (!due || Number.isNaN(due.getTime())) return
      const diffDays = Math.ceil((Date.now() - due.getTime()) / (1000 * 60 * 60 * 24))
      const bucket = agingBucket(diffDays)
      if (bucket !== 'current') buckets[bucket] += 1
    })
    return buckets
  }, [visibleInvoices])

  const selectableIds = useMemo(
    () => visibleInvoices.map((item) => item.id),
    [visibleInvoices],
  )

  useEffect(() => {
    setBulkSelection((prev) => prev.filter((id) => selectableIds.includes(id)))
  }, [selectableIds])

  const selectedItems = useMemo(
    () => visibleInvoices.filter((item) => bulkSelection.includes(item.id)),
    [visibleInvoices, bulkSelection],
  )

  const selectedAssignment = form.assignment_id ? assignments.find((a) => a.id === Number(form.assignment_id)) : null

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  function resetFilters() {
    setFilters({ ...DEFAULT_FILTERS })
    setActiveViewId('')
    setPage(1)
  }

  function applyAgingFilter(bucket) {
    const today = new Date()
    if (!bucket) {
      resetFilters()
      return
    }
    const next = { ...filters }
    if (bucket === '0-7') {
      next.due_from = toLocalDateInput(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000))
      next.due_to = toLocalDateInput(today)
      next.overdue = 'true'
    } else if (bucket === '8-30') {
      next.due_from = toLocalDateInput(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000))
      next.due_to = toLocalDateInput(new Date(today.getTime() - 8 * 24 * 60 * 60 * 1000))
      next.overdue = 'true'
    } else if (bucket === '31-60') {
      next.due_from = toLocalDateInput(new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000))
      next.due_to = toLocalDateInput(new Date(today.getTime() - 31 * 24 * 60 * 60 * 1000))
      next.overdue = 'true'
    } else if (bucket === '60+') {
      next.due_from = ''
      next.due_to = toLocalDateInput(new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000))
      next.overdue = 'true'
    }
    setFilters(next)
    setPage(1)
  }

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleApplyView(viewId) {
    if (!viewId) {
      setActiveViewId('')
      return
    }
    const view = savedViews.find((v) => v.id === viewId)
    if (!view) return
    setActiveViewId(viewId)
    setFilters({ ...DEFAULT_FILTERS, ...(view.filters || {}) })
    setColumns({ ...DEFAULT_COLUMNS, ...(view.columns || {}) })
    if (view.pageSize) setPageSize(view.pageSize)
    setPage(1)
  }

  function handleSaveView() {
    const name = window.prompt('Save current view as:')
    if (!name) return
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = savedViews.find((v) => v.name.toLowerCase() === trimmed.toLowerCase())
    const id = existing?.id || `view-${Date.now()}`
    const payload = {
      id,
      name: trimmed,
      filters,
      columns,
      pageSize,
    }
    setSavedViews((prev) => [...prev.filter((v) => v.id !== id), payload])
    setActiveViewId(id)
  }

  function handleDeleteView() {
    if (!activeViewId) return
    const view = savedViews.find((v) => v.id === activeViewId)
    const label = view?.name || 'this view'
    if (!window.confirm(`Delete ${label}?`)) return
    setSavedViews((prev) => prev.filter((v) => v.id !== activeViewId))
    setActiveViewId('')
  }

  function openDrawer(invoiceId, tab = 'summary') {
    setSelectedInvoiceId(invoiceId)
    setDrawerTab(tab)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setSelectedInvoiceId(null)
  }

  async function handleCreateInvoice(e) {
    e.preventDefault()
    if (!canCreateInvoices) {
      setError('You do not have permission to create invoices.')
      return
    }
    setError(null)
    try {
      if (!form.assignment_id) {
        setError('Assignment is required.')
        return
      }
      const payload = {
        assignment_id: Number(form.assignment_id),
        issued_date: form.issued_date || null,
        due_date: form.due_date || null,
        tax_rate: Number(form.tax_rate || 0),
        company_account_id: form.company_account_id ? Number(form.company_account_id) : null,
        notes: form.notes.trim() || null,
        bill_to_name: form.bill_to_name.trim() || null,
        bill_to_gstin: form.bill_to_gstin.trim() || null,
        place_of_supply: form.place_of_supply.trim() || null,
        items: [],
      }
      await createInvoice(payload)
      setNotice('Invoice created.')
      setCreateOpen(false)
      setFilters((prev) => ({ ...prev }))
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create invoice'))
    }
  }

  async function handleIssue(invoice) {
    if (!canModifyInvoices) {
      setError('You do not have permission to issue invoices.')
      return
    }
    try {
      await issueInvoice(invoice.id)
      setReloadKey((k) => k + 1)
      if (selectedInvoiceId === invoice.id) {
        setDetailReloadKey((k) => k + 1)
      }
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to issue invoice'))
    }
  }

  async function handleSend(invoice) {
    if (!canModifyInvoices) {
      setError('You do not have permission to send invoices.')
      return
    }
    if (!canMarkSent(invoice)) {
      setError('Only issued or partially paid invoices can be marked sent.')
      return
    }
    try {
      await sendInvoice(invoice.id, {})
      setReloadKey((k) => k + 1)
      if (selectedInvoiceId === invoice.id) {
        setDetailReloadKey((k) => k + 1)
      }
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to send invoice'))
    }
  }

  async function handleMarkPaid(invoice) {
    try {
      const result = await markInvoicePaid(invoice.id)
      if (result?.action_type) {
        setNotice('Approval requested to mark invoice as paid.')
      } else {
        setNotice('Invoice marked paid.')
      }
      setReloadKey((k) => k + 1)
      if (selectedInvoiceId === invoice.id) {
        setDetailReloadKey((k) => k + 1)
      }
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to mark invoice paid'))
    }
  }

  async function handleVoid(invoice) {
    if (!canModifyInvoices) {
      setError('You do not have permission to void invoices.')
      return
    }
    if (invoice.status === 'VOID') {
      setError('Invoice already voided.')
      return
    }
    if (Number(invoice.amount_paid || 0) > 0) {
      setError('Refund/credit note required before voiding a paid invoice.')
      return
    }
    const reason = window.prompt('Reason for voiding this invoice?')
    if (!reason) return
    try {
      await voidInvoice(invoice.id, { reason })
      setNotice('Invoice voided.')
      setReloadKey((k) => k + 1)
      if (selectedInvoiceId === invoice.id) {
        setDetailReloadKey((k) => k + 1)
      }
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to void invoice'))
    }
  }

  async function handleGeneratePdf(invoice, { regenerate = false } = {}) {
    setError(null)
    setPdfLoadingId(invoice.id)
    try {
      const blob = await fetchInvoicePdf(invoice.id, { regenerate })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${invoice.invoice_number || `invoice-${invoice.id}`}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to generate invoice PDF'))
    } finally {
      setPdfLoadingId(null)
    }
  }

  async function handleSendReminder(invoice) {
    if (!canRemindInvoices) {
      setError('You do not have permission to send reminders.')
      return
    }
    setError(null)
    setNotice(null)
    setReminderLoadingId(invoice.id)
    try {
      const result = await sendInvoiceReminder(invoice.id, { idempotencyKey: generateIdempotencyKey() })
      setNotice(result?.message || `Reminder sent for ${invoice.invoice_number}`)
    } catch (err) {
      console.error(err)
      const message = toUserMessage(err, 'Failed to send reminder')
      setError(message)
    } finally {
      setReminderLoadingId(null)
    }
  }

  async function handleBulkSend() {
    if (!canRemindInvoices) {
      setError('You do not have permission to send reminders.')
      return
    }
    const selected = visibleInvoices.filter((item) => bulkSelection.includes(item.id))
    const payable = selected.filter((item) => Number(item.amount_due || 0) > 0)
    if (selected.length === 0) {
      setError('Select at least one invoice to send reminders.')
      return
    }
    if (payable.length === 0) {
      setError('Selected invoices have no outstanding balance.')
      return
    }
    if (payable.length > MAX_BULK_REMINDERS) {
      setError(`Bulk reminders are limited to ${MAX_BULK_REMINDERS} invoices at a time.`)
      return
    }
    setBulkSending(true)
    setError(null)
    setNotice(null)
    let successCount = 0
    const failures = []
    for (const item of payable) {
      try {
        await sendInvoiceReminder(item.id, { idempotencyKey: generateIdempotencyKey() })
        successCount += 1
      } catch (err) {
        failures.push(`${item.invoice_number || `#${item.id}`} (${toUserMessage(err, 'failed')})`)
      }
    }
    setBulkSending(false)
    setBulkOpen(false)
    setBulkSelection([])
    if (successCount > 0) {
      setNotice(`Sent ${successCount} reminder${successCount === 1 ? '' : 's'}.`)
    }
    if (payable.length !== selected.length) {
      setNotice((prev) => {
        const extra = `${selected.length - payable.length} invoice${selected.length - payable.length === 1 ? '' : 's'} skipped (no balance).`
        return prev ? `${prev} ${extra}` : extra
      })
    }
    if (failures.length) {
      setError(`Failed to send reminders for: ${failures.join(', ')}`)
    }
  }

  async function handleBulkExportSelected() {
    const selected = visibleInvoices.filter((item) => bulkSelection.includes(item.id))
    if (selected.length === 0) {
      setError('Select at least one invoice to export.')
      return
    }
    const headers = [
      'invoice_number',
      'status',
      'issued_date',
      'due_date',
      'is_overdue',
      'assignment_code',
      'party_name',
      'bank_name',
      'branch_name',
      'currency',
      'subtotal',
      'tax_total',
      'grand_total',
      'amount_paid',
      'amount_due',
    ]
    const rows = selected.map((invoice) => ([
      invoice.invoice_number || '',
      invoice.status || '',
      invoice.issued_at || '',
      invoice.due_date || '',
      invoice.is_overdue ? 'yes' : 'no',
      invoice.assignment_code || '',
      invoice.party_name || '',
      invoice.bank_name || '',
      invoice.branch_name || '',
      invoice.currency || '',
      invoice.subtotal ?? '',
      invoice.tax_total ?? '',
      invoice.grand_total ?? '',
      invoice.amount_paid ?? '',
      invoice.amount_due ?? '',
    ]))
    const csvContent = [headers.map(csvEscape).join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `invoices_selected_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  }

  async function handleBulkMarkPaid() {
    if (!canModifyInvoices) {
      setError('You do not have permission to mark invoices paid.')
      return
    }
    const selected = visibleInvoices.filter((item) => bulkSelection.includes(item.id))
    const payable = selected.filter((item) => Number(item.amount_due || 0) > 0)
    if (selected.length === 0) {
      setError('Select at least one invoice to mark paid.')
      return
    }
    if (payable.length === 0) {
      setError('Selected invoices have no outstanding balance.')
      return
    }
    const confirm = window.confirm(`Mark ${payable.length} invoice${payable.length === 1 ? '' : 's'} as paid?`)
    if (!confirm) return
    setBulkMarking(true)
    setError(null)
    setNotice(null)
    let successCount = 0
    const failures = []
    for (const item of payable) {
      try {
        const result = await markInvoicePaid(item.id)
        if (result?.action_type) {
          failures.push(`${item.invoice_number || `#${item.id}`} (approval requested)`)
        } else {
          successCount += 1
        }
      } catch (err) {
        failures.push(`${item.invoice_number || `#${item.id}`} (${toUserMessage(err, 'failed')})`)
      }
    }
    setBulkMarking(false)
    setBulkSelection([])
    if (successCount > 0) {
      setReloadKey((k) => k + 1)
    }
    if (successCount > 0) {
      setNotice(`Marked ${successCount} invoice${successCount === 1 ? '' : 's'} as paid.`)
    }
    if (failures.length) {
      setError(`Some invoices need attention: ${failures.join(', ')}`)
    }
  }

  function toggleSelection(id) {
    setBulkSelection((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  function toggleAllSelection() {
    if (bulkSelection.length === selectableIds.length) {
      setBulkSelection([])
    } else {
      setBulkSelection([...selectableIds])
    }
  }

  function handleSyncFollowups() {
    if (!canRemindInvoices) {
      setError('You do not have permission to sync follow-ups.')
      return
    }
    setTriggerFollowups(true)
  }

  async function handleExport() {
    try {
      const params = {
        status: filters.status || undefined,
        unpaid: truthyParam(filters.unpaid),
        overdue: truthyParam(filters.overdue),
        issued_from: filters.issued_from || undefined,
        issued_to: filters.issued_to || undefined,
        due_from: filters.due_from || undefined,
        due_to: filters.due_to || undefined,
        bank_id: filters.bank_id ? Number(filters.bank_id) : undefined,
        branch_id: filters.branch_id ? Number(filters.branch_id) : undefined,
        client_id: filters.client_id ? Number(filters.client_id) : undefined,
        amount_min: filters.amount_min ? Number(filters.amount_min) : undefined,
        amount_max: filters.amount_max ? Number(filters.amount_max) : undefined,
        search: filters.search || undefined,
      }
      const blob = await exportInvoicesCsv(params)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `invoices_export_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to export CSV'))
    }
  }

  async function handleRecordPayment(e) {
    e.preventDefault()
    if (!selectedInvoice) return
    try {
      const payload = {
        amount: Number(paymentForm.amount || selectedInvoice.amount_due || 0),
        mode: paymentForm.mode,
        reference_no: paymentForm.reference_no || null,
        notes: paymentForm.notes || null,
        paid_at: paymentForm.paid_at ? new Date(paymentForm.paid_at).toISOString() : null,
      }
      await addInvoicePayment(selectedInvoice.id, payload)
      setNotice('Payment recorded.')
      setReloadKey((k) => k + 1)
      setDetailReloadKey((k) => k + 1)
      setPaymentForm((prev) => ({ ...prev, amount: '' }))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to record payment'))
    }
  }

  async function handleAddAdjustment(e) {
    e.preventDefault()
    if (!selectedInvoice) return
    try {
      const payload = {
        amount: Number(adjustmentForm.amount || 0),
        adjustment_type: adjustmentForm.adjustment_type,
        reason: adjustmentForm.reason || null,
        issued_at: adjustmentForm.issued_at ? new Date(adjustmentForm.issued_at).toISOString() : null,
      }
      await addInvoiceAdjustment(selectedInvoice.id, payload)
      setNotice('Adjustment recorded.')
      setReloadKey((k) => k + 1)
      setDetailReloadKey((k) => k + 1)
      setAdjustmentForm({ amount: '', adjustment_type: 'CREDIT_NOTE', issued_at: '', reason: '' })
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to record adjustment'))
    }
  }

  async function handleUploadAttachment(e) {
    e.preventDefault()
    if (!selectedInvoice || !attachmentFile) return
    try {
      await uploadInvoiceAttachment(selectedInvoice.id, { file: attachmentFile, category: attachmentCategory || undefined })
      setNotice('Attachment uploaded.')
      setAttachmentFile(null)
      setAttachmentCategory('')
      setDetailReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to upload attachment'))
    }
  }

  async function handleDownloadAttachment(attachment) {
    try {
      const blob = await downloadInvoiceAttachment(selectedInvoice.id, attachment.id)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = attachment.original_name
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to download attachment'))
    }
  }

  async function handleDeleteAttachment(attachment) {
    if (!window.confirm(`Delete attachment ${attachment.original_name}?`)) return
    try {
      await deleteInvoiceAttachment(selectedInvoice.id, attachment.id)
      setNotice('Attachment deleted.')
      setDetailReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to delete attachment'))
    }
  }

  const totalPages = Math.max(1, Math.ceil((invoicePage.total || 0) / pageSize))
  const detailIsOverdue = selectedInvoice && selectedInvoice.due_date
    ? (Number(selectedInvoice.amount_due || 0) > 0 && new Date(selectedInvoice.due_date).getTime() < Date.now())
    : false

  return (
    <div>
      <PageHeader
        title="Invoice Ledger"
        subtitle="Audit-ready billing, payments, and overdue tracking."
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={stats.unpaid > 0 ? 'warn' : 'ok'}>{stats.unpaid} unpaid</Badge>
            <button type="button" className="secondary" onClick={handleExport}>Export CSV</button>
            {canCreateInvoices ? (
              <button type="button" onClick={() => setCreateOpen(true)}>New Invoice</button>
            ) : null}
          </div>
        )}
      />

      <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
        <StatCard label="Visible" value={stats.total} help="Invoices on this page." />
        <StatCard label="Draft" value={stats.draft} help="Invoices in draft." />
        <StatCard label="Issued" value={stats.issued} tone="info" help="Issued or sent invoices." />
        <StatCard label="Paid" value={stats.paid} tone="ok" help="Paid invoices." />
      </div>

      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        <StatCard label="0-7 overdue" value={agingStats['0-7']} tone="warn" />
        <StatCard label="8-30 overdue" value={agingStats['8-30']} tone="warn" />
        <StatCard label="31-60 overdue" value={agingStats['31-60']} tone="danger" />
        <StatCard label="60+ overdue" value={agingStats['60+']} tone="danger" />
      </div>

      <Card>
        <CardHeader
          title="Ledger"
          subtitle={`Showing ${visibleInvoices.length} of ${invoicePage.total || 0} invoices.`}
          action={(
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canRemindInvoices ? (
                <button type="button" className="secondary" onClick={handleSyncFollowups} disabled={triggerFollowups}>
                  {triggerFollowups ? 'Syncing…' : 'Sync Follow-ups'}
                </button>
              ) : null}
              <button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>
                Refresh
              </button>
            </div>
          )}
        />

        <div className="filter-shell">
          <div className="toolbar ledger-toolbar">
            <select value={activeViewId} onChange={(e) => handleApplyView(e.target.value)}>
              <option value="">Saved views</option>
              {savedViews.map((view) => (
                <option key={view.id} value={view.id}>{view.name}</option>
              ))}
            </select>
            <button type="button" className="ghost" onClick={handleSaveView}>Save View</button>
            {activeViewId ? (
              <button type="button" className="ghost" onClick={handleDeleteView}>Delete View</button>
            ) : null}
            <input
              className="grow"
              placeholder="Search invoice, assignment, borrower, bank, branch…"
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
            />

            <div className="chip-row">
              <button
                type="button"
                className={`chip ${filters.unpaid === 'true' ? 'active' : ''}`.trim()}
                onClick={() => updateFilter('unpaid', filters.unpaid === 'true' ? '' : 'true')}
                aria-pressed={filters.unpaid === 'true'}
              >
                Unpaid
              </button>
              <button
                type="button"
                className={`chip ${filters.overdue === 'true' ? 'active' : ''}`.trim()}
                onClick={() => updateFilter('overdue', filters.overdue === 'true' ? '' : 'true')}
                aria-pressed={filters.overdue === 'true'}
              >
                Overdue
              </button>
              <button type="button" className="chip" onClick={() => applyAgingFilter('0-7')}>0-7 overdue</button>
              <button type="button" className="chip" onClick={() => applyAgingFilter('8-30')}>8-30 overdue</button>
              <button type="button" className="chip" onClick={() => applyAgingFilter('31-60')}>31-60 overdue</button>
              <button type="button" className="chip" onClick={() => applyAgingFilter('60+')}>60+ overdue</button>
            </div>

            <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
              {filtersOpen ? 'Hide Filters' : 'Filters'}
            </button>
            <button type="button" className="ghost" onClick={resetFilters}>Reset</button>
          </div>

          {filtersOpen ? (
            <div className="filter-panel">
              <div className="filter-grid">
                <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
                  <option value="">All Statuses</option>
                  {['DRAFT', 'ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID'].map((status) => (
                    <option key={status} value={status}>{titleCase(status)}</option>
                  ))}
                </select>

                <select value={filters.unpaid} onChange={(e) => updateFilter('unpaid', e.target.value)}>
                  <option value="">Unpaid?</option>
                  <option value="true">Unpaid</option>
                  <option value="false">Paid</option>
                </select>

                <select value={filters.overdue} onChange={(e) => updateFilter('overdue', e.target.value)}>
                  <option value="">Overdue?</option>
                  <option value="true">Overdue</option>
                  <option value="false">Not overdue</option>
                </select>

                <select value={filters.bank_id} onChange={(e) => updateFilter('bank_id', e.target.value)}>
                  <option value="">All Banks</option>
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id}>{bank.name}</option>
                  ))}
                </select>

                <select value={filters.branch_id} onChange={(e) => updateFilter('branch_id', e.target.value)}>
                  <option value="">All Branches</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>

                <select value={filters.client_id} onChange={(e) => updateFilter('client_id', e.target.value)}>
                  <option value="">All Clients</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>

                <input
                  type="date"
                  value={filters.issued_from}
                  onChange={(e) => updateFilter('issued_from', e.target.value)}
                  title="Issued from"
                />
                <input
                  type="date"
                  value={filters.issued_to}
                  onChange={(e) => updateFilter('issued_to', e.target.value)}
                  title="Issued to"
                />
                <input
                  type="date"
                  value={filters.due_from}
                  onChange={(e) => updateFilter('due_from', e.target.value)}
                  title="Due from"
                />
                <input
                  type="date"
                  value={filters.due_to}
                  onChange={(e) => updateFilter('due_to', e.target.value)}
                  title="Due to"
                />

                <input
                  type="number"
                  placeholder="Min amount"
                  value={filters.amount_min}
                  onChange={(e) => updateFilter('amount_min', e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Max amount"
                  value={filters.amount_max}
                  onChange={(e) => updateFilter('amount_max', e.target.value)}
                />

                <select value={filters.sort_by} onChange={(e) => updateFilter('sort_by', e.target.value)}>
                  <option value="due_date">Sort: Due Date</option>
                  <option value="issued_date">Sort: Issued Date</option>
                  <option value="amount_due">Sort: Amount Due</option>
                  <option value="grand_total">Sort: Grand Total</option>
                  <option value="created_at">Sort: Created</option>
                </select>

                <select value={filters.sort_dir} onChange={(e) => updateFilter('sort_dir', e.target.value)}>
                  <option value="asc">Asc</option>
                  <option value="desc">Desc</option>
                </select>

                <details className="column-picker">
                  <summary>Columns</summary>
                  <div className="column-picker-menu">
                    {COLUMN_OPTIONS.map((option) => (
                      <label key={option.key} className="column-picker-item">
                        <input
                          type="checkbox"
                          checked={Boolean(columns[option.key])}
                          onChange={() =>
                            setColumns((prev) => ({ ...prev, [option.key]: !prev[option.key] }))
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          ) : null}
        </div>

        {error ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div> : null}
        {notice ? <div className="notice" style={{ marginBottom: '0.8rem' }}>{notice}</div> : null}

        {!canViewInvoices ? (
          <EmptyState>You do not have permission to view invoices.</EmptyState>
        ) : loading ? (
          <DataTable loading columns={12} rows={8} className="ledger-table-wrap" minWidth={640} />
        ) : visibleInvoices.length === 0 ? (
          <EmptyState>No invoices match your filters.</EmptyState>
        ) : (
          <DataTable className="ledger-table-wrap">
            {bulkSelection.length > 0 ? (
              <div className="bulk-bar">
                <strong>{bulkSelection.length} selected</strong>
                <span className="muted">Max {MAX_BULK_REMINDERS} reminders at a time.</span>
                <button type="button" className="secondary" onClick={handleBulkExportSelected}>
                  Export Selected
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={handleBulkMarkPaid}
                  disabled={!canModifyInvoices || bulkMarking}
                >
                  {bulkMarking ? 'Marking…' : 'Mark Paid'}
                </button>
                <button type="button" className="secondary" onClick={() => setBulkOpen(true)} disabled={!canRemindInvoices}>
                  Send reminders
                </button>
                <button type="button" className="ghost" onClick={() => setBulkSelection([])}>Clear</button>
              </div>
            ) : null}
            <table className="ledger-table responsive-ledger">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={bulkSelection.length > 0 && bulkSelection.length === selectableIds.length}
                      onChange={toggleAllSelection}
                      aria-label="Select all invoices"
                    />
                  </th>
                  <th>Invoice #</th>
                  <th className={colClass('assignment', 'col-assignment')}>Assignment</th>
                  <th className={colClass('party', 'col-party')}>Party</th>
                  <th className={colClass('bank', 'col-bank')}>Bank → Branch</th>
                  <th className={colClass('issued', 'col-issued')}>Issued</th>
                  <th>Due</th>
                  <th>Grand Total</th>
                  <th className={colClass('paid', 'col-paid')}>Paid</th>
                  <th>Due</th>
                  <th className={colClass('status', 'col-status')}>Status</th>
                  <th className={colClass('actions', 'col-actions')} />
                </tr>
              </thead>
              <tbody>
                {visibleInvoices.map((invoice) => {
                  const isOverdue = invoice.is_overdue
                  const lastPaymentAt = invoice.last_payment_at
                  const lastPaymentAmount = invoice.last_payment_amount
                  const itemsCount = typeof invoice.items_count === 'number' ? invoice.items_count : null
                  const previewItems = Array.isArray(invoice.item_preview) ? invoice.item_preview : []
                  const rowClassName = [
                    'invoice-row',
                    Number(invoice.amount_due || 0) > 0 ? 'invoice-row--unpaid' : '',
                    isOverdue ? 'invoice-row--overdue' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <tr
                      key={invoice.id}
                      className={rowClassName}
                      onClick={() => {
                        if (!drawerOpen) openDrawer(invoice.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.currentTarget !== event.target) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          if (!drawerOpen) openDrawer(invoice.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={bulkSelection.includes(invoice.id)}
                          onChange={() => toggleSelection(invoice.id)}
                          aria-label={`Select invoice ${invoice.invoice_number || invoice.id}`}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <strong>{invoice.invoice_number || 'Draft'}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>{invoice.assignment_code || '—'}</span>
                          <div className="invoice-quicklook">
                            <div className="quicklook-row">
                              {itemsCount !== null ? <span className="badge muted">{itemsCount} items</span> : null}
                              <span>Subtotal {formatMoney(invoice.subtotal, invoice.currency)}</span>
                              <span>Tax {formatMoney(invoice.tax_total, invoice.currency)}</span>
                              <span>Total {formatMoney(invoice.grand_total, invoice.currency)}</span>
                            </div>
                            {previewItems.length ? (
                              <div className="quicklook-row">
                                {previewItems.map((item, idx) => (
                                  <span key={`${invoice.id}-preview-${idx}`}>
                                    {item.quantity} x {item.description} · {formatMoney(item.line_total, invoice.currency)}
                                  </span>
                                ))}
                                {itemsCount && itemsCount > previewItems.length ? (
                                  <span className="muted">+{itemsCount - previewItems.length} more</span>
                                ) : null}
                              </div>
                            ) : (
                              <div className="quicklook-row">
                                <span className="muted">No line items</span>
                              </div>
                            )}
                            <div className="quicklook-row">
                              {lastPaymentAt ? (
                                <span>
                                  Last payment {formatMoney(lastPaymentAmount ?? 0, invoice.currency)} · {formatDateTime(lastPaymentAt)}
                                </span>
                              ) : (
                                <span>No payments recorded</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={colClass('assignment', 'col-assignment')}>
                        <button
                          type="button"
                          className="link-button"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/assignments/${invoice.assignment_id}`)
                          }}
                        >
                          {invoice.assignment_code || 'View assignment'}
                        </button>
                      </td>
                      <td className={colClass('party', 'col-party')}>{invoice.party_name || '—'}</td>
                      <td className={colClass('bank', 'col-bank')}>
                        <span className="muted">
                          {invoice.bank_name || '—'}{invoice.branch_name ? ` · ${invoice.branch_name}` : ''}
                        </span>
                      </td>
                      <td className={colClass('issued', 'col-issued')}>{formatDate(invoice.issued_at)}</td>
                      <td>
                        <div style={{ display: 'grid', gap: 4 }}>
                          <span>{formatDate(invoice.due_date)}</span>
                          {isOverdue ? <Badge tone="danger">Overdue</Badge> : null}
                        </div>
                      </td>
                      <td><strong>{formatMoney(invoice.grand_total, invoice.currency)}</strong></td>
                      <td className={colClass('paid', 'col-paid')}>
                        <div className="paid-cell">
                          <span>{formatMoney(invoice.amount_paid, invoice.currency)}</span>
                          {lastPaymentAt ? (
                            <span className="muted" style={{ fontSize: 12 }}>
                              Last {formatMoney(lastPaymentAmount ?? 0, invoice.currency)} · {formatDateTime(lastPaymentAt)}
                            </span>
                          ) : (
                            <span className="muted" style={{ fontSize: 12 }}>No payments</span>
                          )}
                        </div>
                      </td>
                      <td><strong>{formatMoney(invoice.amount_due, invoice.currency)}</strong></td>
                      <td className={colClass('status', 'col-status')}>
                        <Badge tone={statusTone(invoice.status)}>{titleCase(invoice.status)}</Badge>
                      </td>
                      <td
                        className={colClass('actions', 'col-actions')}
                        style={{ textAlign: 'right', whiteSpace: 'nowrap' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="invoice-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleGeneratePdf(invoice)}
                            disabled={quickActionsDisabled || pdfLoadingId === invoice.id || !invoice.invoice_number}
                          >
                            {pdfLoadingId === invoice.id ? 'Generating…' : 'PDF'}
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => openDrawer(invoice.id, 'payments')}
                            disabled={quickActionsDisabled}
                          >
                            Record Payment
                          </button>
                          {Number(invoice.amount_due || 0) > 0 ? (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => handleSendReminder(invoice)}
                              disabled={quickActionsDisabled || !canRemindInvoices || reminderLoadingId === invoice.id}
                            >
                              {reminderLoadingId === invoice.id ? 'Sending…' : 'Remind'}
                            </button>
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

        <div className="ledger-footer">
          <div className="muted">Page {page} of {totalPages}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>{size} / page</option>
              ))}
            </select>
            <button type="button" className="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Prev
            </button>
            <button type="button" className="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next
            </button>
          </div>
        </div>
      </Card>

      {createOpen ? (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)} role="presentation">
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>Create Invoice</h3>
            <form className="grid" onSubmit={handleCreateInvoice}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Assignment</span>
                <select value={form.assignment_id} onChange={(e) => updateForm('assignment_id', e.target.value)}>
                  <option value="">Select assignment</option>
                  {assignments.map((assignment) => (
                    <option key={assignment.id} value={assignment.id}>
                      {assignment.assignment_code} · {assignment.borrower_name || 'No borrower'}
                    </option>
                  ))}
                </select>
              </label>

              {selectedAssignment ? (
                <div className="list-item" style={{ marginTop: -4 }}>
                  <div className="kicker">Assignment Snapshot</div>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>{selectedAssignment.assignment_code}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {selectedAssignment.bank_name || selectedAssignment.valuer_client_name || titleCase(selectedAssignment.case_type)}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">Fees</span>
                    <strong>{formatMoney(selectedAssignment.fees)}</strong>
                  </div>
                </div>
              ) : null}

              <div className="grid cols-2">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Issued Date</span>
                  <input id="issuedDate" name="issuedDate" type="date" value={form.issued_date} onChange={(e) => updateForm('issued_date', e.target.value)} />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Due Date</span>
                  <input id="dueDate" name="dueDate" type="date" value={form.due_date} onChange={(e) => updateForm('due_date', e.target.value)} />
                </label>
              </div>

              <div className="grid cols-2">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Tax Rate (%)</span>
                  <input id="taxRate" name="taxRate" type="number" min="0" step="0.01" value={form.tax_rate} onChange={(e) => updateForm('tax_rate', e.target.value)} />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Company Account</span>
                  <select value={form.company_account_id} onChange={(e) => updateForm('company_account_id', e.target.value)}>
                    <option value="">Use primary</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.account_name} · {account.bank_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid cols-2">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Bill To</span>
                  <input id="billToName" name="billToName" value={form.bill_to_name} onChange={(e) => updateForm('bill_to_name', e.target.value)} placeholder="Optional" />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">GSTIN</span>
                  <input id="billToGstin" name="billToGstin" value={form.bill_to_gstin} onChange={(e) => updateForm('bill_to_gstin', e.target.value)} placeholder="Optional" />
                </label>
              </div>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Place of Supply</span>
                <input value={form.place_of_supply} onChange={(e) => updateForm('place_of_supply', e.target.value)} placeholder="Optional" />
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Notes</span>
                <textarea rows={3} value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} placeholder="Optional invoice notes or payment instructions." />
              </label>

              <button type="submit" disabled={!canCreateInvoices}>Create Invoice</button>
            </form>
          </div>
        </div>
      ) : null}

      <Drawer open={drawerOpen} onClose={closeDrawer} ariaLabel="Invoice details">
            <div className="drawer-header">
              <div>
                <div className="kicker">Invoice</div>
                <div className="drawer-title">{selectedInvoice?.invoice_number || `Draft #${selectedInvoice?.id || ''}`}</div>
                {selectedInvoice ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                    <Badge tone={statusTone(selectedInvoice.status)}>{titleCase(selectedInvoice.status)}</Badge>
                    {detailIsOverdue ? <Badge tone="danger">Overdue</Badge> : null}
                  </div>
                ) : null}
              </div>
              <button type="button" className="ghost" onClick={closeDrawer}>Close</button>
            </div>

            {error ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div> : null}
            {notice ? <div className="notice" style={{ marginBottom: '0.8rem' }}>{notice}</div> : null}

            {detailLoading ? (
              <div className="muted">Loading invoice…</div>
            ) : selectedInvoice ? (
              <>
                <div className="drawer-actions">
                  <button type="button" className="secondary" onClick={() => handleGeneratePdf(selectedInvoice)} disabled={!selectedInvoice.invoice_number}>
                    Download PDF
                  </button>
                  {selectedInvoice.status === 'DRAFT' ? (
                    <button type="button" onClick={() => handleIssue(selectedInvoice)} disabled={!canModifyInvoices}>Issue</button>
                  ) : null}
                  {canMarkSent(selectedInvoice) ? (
                    <button type="button" className="secondary" onClick={() => handleSend(selectedInvoice)} disabled={!canModifyInvoices}>
                      Mark Sent
                    </button>
                  ) : null}
                  {Number(selectedInvoice.amount_due || 0) > 0 ? (
                    <button type="button" className="secondary" onClick={() => handleMarkPaid(selectedInvoice)}>
                      Mark Paid
                    </button>
                  ) : null}
                  {selectedInvoice.status !== 'VOID' ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => handleVoid(selectedInvoice)}
                      disabled={!canModifyInvoices || !canVoidInvoice(selectedInvoice)}
                      title={!canVoidInvoice(selectedInvoice) ? 'Refund/credit note required before voiding a paid invoice.' : undefined}
                    >
                      Void
                    </button>
                  ) : null}
                </div>

                <Tabs
                  tabs={[
                    { key: 'summary', label: 'Summary', title: 'Summary' },
                    { key: 'items', label: 'Line Items', title: 'Line Items' },
                    { key: 'payments', label: 'Payments', title: 'Payments' },
                    { key: 'adjustments', label: 'Adjustments', title: 'Adjustments' },
                    { key: 'audit', label: 'Audit Trail', title: 'Audit Trail' },
                    { key: 'attachments', label: 'Attachments', title: 'Attachments' },
                  ]}
                  active={drawerTab}
                  onChange={setDrawerTab}
                />

                {drawerTab === 'summary' ? (
                  <div className="drawer-section">
                    <div className="summary-grid">
                      <div>
                        <div className="kicker">Grand Total</div>
                        <div className="stat-value drawer-stat">{formatMoney(selectedInvoice.grand_total, selectedInvoice.currency)}</div>
                      </div>
                      <div>
                        <div className="kicker">Paid</div>
                        <div className="stat-value drawer-stat">{formatMoney(selectedInvoice.amount_paid, selectedInvoice.currency)}</div>
                      </div>
                      <div>
                        <div className="kicker">Due</div>
                        <div className="stat-value drawer-stat">{formatMoney(selectedInvoice.amount_due, selectedInvoice.currency)}</div>
                      </div>
                    </div>

                    <div className="drawer-card">
                      <div className="kicker">Bill To</div>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>{selectedInvoice.bill_to_name || selectedInvoice.party_name || '—'}</div>
                      <div className="muted" style={{ marginTop: 4 }}>{selectedInvoice.bill_to_address || '—'}</div>
                      {selectedInvoice.bill_to_gstin ? (
                        <div className="muted" style={{ marginTop: 4 }}>GSTIN: {selectedInvoice.bill_to_gstin}</div>
                      ) : null}
                      {selectedInvoice.place_of_supply ? (
                        <div className="muted" style={{ marginTop: 4 }}>Place of Supply: {selectedInvoice.place_of_supply}</div>
                      ) : null}
                      {selectedInvoice.terms ? (
                        <div className="muted" style={{ marginTop: 4 }}>Terms: {selectedInvoice.terms}</div>
                      ) : null}
                    </div>

                    <div className="drawer-card">
                      <div className="kicker">GST Breakdown</div>
                      {selectedInvoice.tax_breakdown ? (
                        <div className="grid" style={{ gap: 6, marginTop: 6 }}>
                          <div className="split-row"><span>Taxable</span><strong>{formatMoney(selectedInvoice.tax_breakdown.taxable_value, selectedInvoice.currency)}</strong></div>
                          <div className="split-row"><span>CGST</span><strong>{formatMoney(selectedInvoice.tax_breakdown.cgst, selectedInvoice.currency)}</strong></div>
                          <div className="split-row"><span>SGST</span><strong>{formatMoney(selectedInvoice.tax_breakdown.sgst, selectedInvoice.currency)}</strong></div>
                          <div className="split-row"><span>IGST</span><strong>{formatMoney(selectedInvoice.tax_breakdown.igst, selectedInvoice.currency)}</strong></div>
                          <div className="split-row"><span>CESS</span><strong>{formatMoney(selectedInvoice.tax_breakdown.cess, selectedInvoice.currency)}</strong></div>
                        </div>
                      ) : (
                        <div className="muted" style={{ marginTop: 6 }}>No tax snapshot yet.</div>
                      )}
                    </div>
                  </div>
                ) : null}

                {drawerTab === 'items' ? (
                  <div className="drawer-section">
                    {selectedInvoice.items?.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Description</th>
                              <th>Qty</th>
                              <th>Unit</th>
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedInvoice.items.map((item) => (
                              <tr key={item.id}>
                                <td>{item.description}</td>
                                <td>{item.quantity}</td>
                                <td>{formatMoney(item.unit_price, selectedInvoice.currency)}</td>
                                <td>{formatMoney(item.line_total, selectedInvoice.currency)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="muted">No line items.</div>
                    )}
                  </div>
                ) : null}

                {drawerTab === 'payments' ? (
                  <div className="drawer-section">
                    <div className="drawer-card">
                      <div className="kicker">Record Payment</div>
                      <form className="grid" onSubmit={handleRecordPayment}>
                        <div className="grid cols-2">
                          <label className="grid" style={{ gap: 6 }}>
                            <span className="kicker">Amount</span>
                            <input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))} />
                          </label>
                          <label className="grid" style={{ gap: 6 }}>
                            <span className="kicker">Mode</span>
                            <select value={paymentForm.mode} onChange={(e) => setPaymentForm((prev) => ({ ...prev, mode: e.target.value }))}>
                              {['MANUAL', 'CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'OTHER'].map((mode) => (
                                <option key={mode} value={mode}>{titleCase(mode)}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="grid cols-2">
                          <label className="grid" style={{ gap: 6 }}>
                            <span className="kicker">Paid At</span>
                            <input type="datetime-local" value={paymentForm.paid_at} onChange={(e) => setPaymentForm((prev) => ({ ...prev, paid_at: e.target.value }))} />
                          </label>
                          <label className="grid" style={{ gap: 6 }}>
                            <span className="kicker">Reference</span>
                            <input value={paymentForm.reference_no} onChange={(e) => setPaymentForm((prev) => ({ ...prev, reference_no: e.target.value }))} />
                          </label>
                        </div>
                        <label className="grid" style={{ gap: 6 }}>
                          <span className="kicker">Notes</span>
                          <textarea rows={2} value={paymentForm.notes} onChange={(e) => setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))} />
                        </label>
                        <button type="submit">Record Payment</button>
                      </form>
                    </div>

                    <div className="drawer-card">
                      <div className="kicker">Payment History</div>
                      {selectedInvoice.payments?.length ? (
                        <div className="list">
                          {selectedInvoice.payments.map((payment) => (
                            <div key={payment.id} className="list-item">
                              <div>
                                <strong>{formatMoney(payment.amount, selectedInvoice.currency)}</strong>
                                <div className="muted" style={{ fontSize: 12 }}>{titleCase(payment.mode)}</div>
                              </div>
                              <div className="muted">{formatDateTime(payment.paid_at)}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="muted" style={{ marginTop: 6 }}>No payments yet.</div>
                      )}
                    </div>
                  </div>
                ) : null}

                {drawerTab === 'adjustments' ? (
                  <div className="drawer-section">
                    <div className="drawer-card">
                      <div className="kicker">Add Adjustment</div>
                      <form className="grid" onSubmit={handleAddAdjustment}>
                        <div className="grid cols-2">
                          <label className="grid" style={{ gap: 6 }}>
                            <span className="kicker">Amount</span>
                            <input type="number" min="0" step="0.01" value={adjustmentForm.amount} onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, amount: e.target.value }))} />
                          </label>
                          <label className="grid" style={{ gap: 6 }}>
                            <span className="kicker">Type</span>
                            <select value={adjustmentForm.adjustment_type} onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, adjustment_type: e.target.value }))}>
                              {['CREDIT_NOTE', 'DISCOUNT', 'WRITE_OFF', 'OTHER'].map((type) => (
                                <option key={type} value={type}>{titleCase(type)}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="grid cols-2">
                          <label className="grid" style={{ gap: 6 }}>
                            <span className="kicker">Issued At</span>
                            <input type="datetime-local" value={adjustmentForm.issued_at} onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, issued_at: e.target.value }))} />
                          </label>
                          <label className="grid" style={{ gap: 6 }}>
                            <span className="kicker">Reason</span>
                            <input value={adjustmentForm.reason} onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, reason: e.target.value }))} />
                          </label>
                        </div>
                        <button type="submit">Record Adjustment</button>
                      </form>
                    </div>

                    <div className="drawer-card">
                      <div className="kicker">Adjustment History</div>
                      {selectedInvoice.adjustments?.length ? (
                        <div className="list">
                          {selectedInvoice.adjustments.map((adj) => (
                            <div key={adj.id} className="list-item">
                              <div>
                                <strong>{formatMoney(adj.amount, selectedInvoice.currency)}</strong>
                                <div className="muted" style={{ fontSize: 12 }}>{titleCase(adj.adjustment_type)}</div>
                              </div>
                              <div className="muted">{formatDateTime(adj.issued_at)}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="muted" style={{ marginTop: 6 }}>No adjustments yet.</div>
                      )}
                    </div>
                  </div>
                ) : null}

                {drawerTab === 'audit' ? (
                  <div className="drawer-section">
                    {selectedInvoice.audit_trail?.length ? (
                      <div className="list">
                        {selectedInvoice.audit_trail.map((entry) => (
                          <div key={entry.id} className="list-item">
                            <div>
                              <strong>{titleCase(entry.event_type)}</strong>
                              <div className="muted" style={{ fontSize: 12 }}>{entry.actor_user_id ? `User #${entry.actor_user_id}` : 'System'}</div>
                            </div>
                            <div className="muted">{formatDateTime(entry.created_at)}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="muted">No audit activity yet.</div>
                    )}
                  </div>
                ) : null}

                {drawerTab === 'attachments' ? (
                  <div className="drawer-section">
                    <div className="drawer-card">
                      <div className="kicker">Upload Attachment</div>
                      <form className="grid" onSubmit={handleUploadAttachment}>
                        <label className="grid" style={{ gap: 6 }}>
                          <span className="kicker">Category</span>
                          <input value={attachmentCategory} onChange={(e) => setAttachmentCategory(e.target.value)} placeholder="Optional" />
                        </label>
                        <label className="grid" style={{ gap: 6 }}>
                          <span className="kicker">File</span>
                          <input type="file" onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)} />
                        </label>
                        <button type="submit" disabled={!attachmentFile}>Upload</button>
                      </form>
                    </div>

                    <div className="drawer-card">
                      <div className="kicker">Attachments</div>
                      {selectedInvoice.attachments?.length ? (
                        <div className="list">
                          {selectedInvoice.attachments.map((doc) => (
                            <div key={doc.id} className="list-item">
                              <div>
                                <strong>{doc.original_name}</strong>
                                <div className="muted" style={{ fontSize: 12 }}>{doc.category || 'General'}</div>
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button type="button" className="ghost" onClick={() => handleDownloadAttachment(doc)}>Download</button>
                                <button type="button" className="ghost" onClick={() => handleDeleteAttachment(doc)}>Delete</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="muted">No attachments yet.</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="muted">Select an invoice to view details.</div>
            )}
      </Drawer>

      {bulkOpen ? (
        <div className="modal-backdrop" onClick={() => setBulkOpen(false)} role="presentation">
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>Send bulk reminders</h3>
            <p className="muted">You are about to send reminders to the following invoices:</p>
            <ul className="modal-list">
              {selectedItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.invoice_number || `#${item.id}`}</strong>
                  <span className="muted"> · {item.party_name || 'Client'} · {formatMoney(item.amount_due, item.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setBulkOpen(false)} disabled={bulkSending}>
                Cancel
              </button>
              <button type="button" onClick={handleBulkSend} disabled={bulkSending}>
                {bulkSending ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StatCard({ label, value, tone, help }) {
  return (
    <div className="card tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <InfoTip text={help} /> : null}
      </div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </div>
    </div>
  )
}
