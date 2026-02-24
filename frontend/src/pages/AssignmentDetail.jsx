import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import Tabs from '../components/ui/Tabs'
import { Card, CardHeader } from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import InfoTip from '../components/ui/InfoTip'
import { fetchAssignment, fetchAssignmentChecklist, remindMissingDocs, updateAssignment, deleteAssignment } from '../api/assignments'
import { createTask, updateTask, deleteTask } from '../api/tasks'
import { createMessage, pinMessage, unpinMessage, deleteMessage } from '../api/messages'
import { uploadDocumentWithMeta, markDocumentFinal, documentDownloadUrl, documentPreviewUrl } from '../api/documents'
import { createInvoice, issueInvoice, markInvoicePaid, fetchInvoicePdf } from '../api/invoices'
import { requestApproval, fetchApprovalTemplates } from '../api/approvals'
import { fetchUserDirectory } from '../api/users'
import {
  fetchBanks,
  fetchBranches,
  fetchClients,
  fetchPropertyTypes,
  fetchPropertySubtypes,
  fetchCompanyAccounts,
} from '../api/master'
import {
  dueStateTone,
  dueStateLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  statusTone,
  titleCase,
} from '../utils/format'
import { toUserMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { hasCapability } from '../utils/rbac'
import DocumentPreviewDrawerV2 from '../components/DocumentPreviewDrawerV2'

const TAB_ITEMS = [
  { key: 'overview', label: 'Overview' },
  { key: 'documents', label: 'Documents' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'chat', label: 'Chat' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'finance', label: 'Finance' },
  { key: 'outputs', label: 'Outputs' },
]

const TASK_STATUSES = ['TODO', 'DOING', 'DONE', 'BLOCKED']
const ASSIGNMENT_STATUSES = ['PENDING', 'SITE_VISIT', 'UNDER_PROCESS', 'SUBMITTED', 'COMPLETED', 'CANCELLED']
const SERVICE_LINES = ['VALUATION', 'INDUSTRIAL', 'DPR', 'CMA']
const DEFAULT_APPROVAL_ACTIONS = [
  'FEE_OVERRIDE',
  'DELETE_ASSIGNMENT',
  'CLOSE_ASSIGNMENT',
  'REASSIGN',
  'MARK_PAID',
  'DOC_REQUEST',
  'FIELD_VISIT',
  'FINAL_REVIEW',
  'CLIENT_CALL',
  'PAYMENT_FOLLOWUP',
  'EXCEPTION',
]
const MENTION_TOKEN_RE = /@\[[^\]]+\]\((\d+)\)/g

function renderMessageText(text, userMap) {
  if (!text) return ''
  return text.replace(MENTION_TOKEN_RE, (_match, id) => {
    const user = userMap.get(String(id))
    return `@${user?.full_name || user?.email || id}`
  })
}

function parseMentionIds(text) {
  if (!text) return []
  const ids = new Set()
  let match
  while ((match = MENTION_TOKEN_RE.exec(text)) !== null) {
    const parsed = Number(match[1])
    if (Number.isFinite(parsed)) ids.add(parsed)
  }
  return Array.from(ids)
}

function toIso(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function isoToLocalInputValue(isoValue) {
  if (!isoValue) return ''
  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) return ''
  date.setSeconds(0, 0)
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16)
}

function initTaskDrafts(tasks = []) {
  const drafts = {}
  tasks.forEach((task) => {
    drafts[task.id] = {
      title: task.title || '',
      description: task.description || '',
      status: task.status,
      assigned_to_user_id: task.assigned_to_user_id ? String(task.assigned_to_user_id) : '',
      due_at: isoToLocalInputValue(task.due_at),
    }
  })
  return drafts
}

export default function AssignmentDetail() {
  const { id } = useParams()
  const { user, capabilities } = useAuth()

  const [activeTab, setActiveTab] = useState('overview')
  const [detail, setDetail] = useState(null)
  const [checklist, setChecklist] = useState(null)

  const [users, setUsers] = useState([])
  const [banks, setBanks] = useState([])
  const [branches, setBranches] = useState([])
  const [clients, setClients] = useState([])
  const [propertyTypes, setPropertyTypes] = useState([])
  const [propertySubtypes, setPropertySubtypes] = useState([])
  const [companyAccounts, setCompanyAccounts] = useState([])
  const [approvalTemplates, setApprovalTemplates] = useState([])
  const [timelineOrder, setTimelineOrder] = useState('desc')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [overviewForm, setOverviewForm] = useState(null)
  const [taskDrafts, setTaskDrafts] = useState({})

  const [taskForm, setTaskForm] = useState({ title: '', description: '', status: 'TODO', assigned_to_user_id: '', due_at: '' })
  const [messageForm, setMessageForm] = useState({ message: '' })
  const [documentForm, setDocumentForm] = useState({ file: null, category: '', use_other: false, is_final: false })
  const [invoiceForm, setInvoiceForm] = useState({ tax_rate: '0', issued_date: '', due_date: '', company_account_id: '', notes: '' })
  const [approvalForm, setApprovalForm] = useState({ action_type: 'REASSIGN', reason: '' })
  const [pdfLoadingId, setPdfLoadingId] = useState(null)
  
  // Document preview drawer state
  const [selectedDocument, setSelectedDocument] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const [multiFloorEnabled, setMultiFloorEnabled] = useState(false)
  const [floors, setFloors] = useState([{ floor_name: 'Ground Floor', area: '' }])

  const messageRef = useRef(null)
  const [mentionState, setMentionState] = useState({ open: false, query: '', anchor: -1, caret: -1 })
  const [mentionedUserIds, setMentionedUserIds] = useState([])

  const canReassign = hasCapability(capabilities, 'reassign')
  const canModifyMoney = hasCapability(capabilities, 'modify_money')
  const canCreateInvoice = hasCapability(capabilities, 'create_invoice') || canModifyMoney
  const canModifyInvoice = hasCapability(capabilities, 'modify_invoice') || canModifyMoney || canCreateInvoice

  useEffect(() => {
    let cancelled = false

    async function loadAll() {
      setLoading(true)
      setError(null)
      setNotice(null)
      try {
        const [
          detailData,
          checklistData,
          bankData,
          branchData,
          clientData,
          propertyData,
          propertySubtypeData,
          accountData,
          templatesData,
        ] = await Promise.all([
          fetchAssignment(id, { timeline_order: timelineOrder }),
          fetchAssignmentChecklist(id).catch(() => null),
          fetchBanks(),
          fetchBranches(),
          fetchClients(),
          fetchPropertyTypes(),
          fetchPropertySubtypes().catch(() => []),
          fetchCompanyAccounts().catch(() => []),
          fetchApprovalTemplates().catch(() => []),
        ])

        let userData = []
        try {
          userData = await fetchUserDirectory()
        } catch (err) {
          console.warn('Unable to load full user list; falling back to current user')
          userData = user ? [user] : []
        }

        if (cancelled) return
        setDetail(detailData)
        setChecklist(checklistData)
        setBanks(bankData)
        setBranches(branchData)
        setClients(clientData)
        setPropertyTypes(propertyData)
        setPropertySubtypes(propertySubtypeData)
        setCompanyAccounts(accountData)
        setApprovalTemplates(templatesData)
        setUsers(userData)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load assignment detail'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAll()
    return () => {
      cancelled = true
    }
  }, [id, reloadKey, user, timelineOrder])

  useEffect(() => {
    if (!detail?.assignment) return
    const a = detail.assignment
    const floorsFromAssignment = (a.floors || []).map((floor, index) => ({
      id: floor.id || `floor-${index}`,
      floor_name: floor.floor_name || '',
      area: floor.area != null ? String(floor.area) : '',
      order_index: floor.order_index ?? index,
    }))
    setOverviewForm({
      case_type: a.case_type,
      service_line: a.service_line || 'VALUATION',
      bank_id: a.bank_id ? String(a.bank_id) : '',
      branch_id: a.branch_id ? String(a.branch_id) : '',
      client_id: a.client_id ? String(a.client_id) : '',
      property_type_id: a.property_type_id ? String(a.property_type_id) : '',
      property_subtype_id: a.property_subtype_id ? String(a.property_subtype_id) : '',
      borrower_name: a.borrower_name || '',
      phone: a.phone || '',
      address: a.address || '',
      land_area: a.land_area ?? '',
      builtup_area: a.builtup_area ?? '',
      status: a.status,
      assigned_to_user_id: a.assigned_to_user_id ? String(a.assigned_to_user_id) : '',
      assignee_user_ids: (a.assignee_user_ids || []).map(String),
      site_visit_date: isoToLocalInputValue(a.site_visit_date),
      report_due_date: isoToLocalInputValue(a.report_due_date),
      fees: a.fees ?? '',
      is_paid: Boolean(a.is_paid),
      notes: a.notes || '',
    })
    setTaskDrafts(initTaskDrafts(detail.tasks))
    setFloors(floorsFromAssignment.length > 0 ? floorsFromAssignment : [{ floor_name: 'Ground Floor', area: '' }])
    setMultiFloorEnabled(floorsFromAssignment.length > 0)
    setMentionedUserIds([])
    setMentionState({ open: false, query: '', anchor: -1, caret: -1 })
  }, [detail])

  useEffect(() => {
    if (approvalTemplates.length === 0) return
    setApprovalForm((prev) => {
      if (approvalTemplates.some((t) => t.action_type === prev.action_type)) return prev
      return { ...prev, action_type: approvalTemplates[0].action_type }
    })
  }, [approvalTemplates])

  const userMap = useMemo(() => {
    const map = new Map()
    users.forEach((u) => map.set(String(u.id), u))
    return map
  }, [users])

  const selectedApprovalTemplate = useMemo(
    () => approvalTemplates.find((t) => t.action_type === approvalForm.action_type),
    [approvalTemplates, approvalForm.action_type],
  )

  const orderedTimeline = useMemo(() => {
    const items = detail?.timeline ? [...detail.timeline] : []
    items.sort((a, b) => {
      const aTime = new Date(a.created_at || 0).getTime()
      const bTime = new Date(b.created_at || 0).getTime()
      return timelineOrder === 'asc' ? aTime - bTime : bTime - aTime
    })
    return items
  }, [detail, timelineOrder])

  const bankMap = useMemo(() => {
    const map = new Map()
    banks.forEach((b) => map.set(String(b.id), b))
    return map
  }, [banks])

  const branchMap = useMemo(() => {
    const map = new Map()
    branches.forEach((b) => map.set(String(b.id), b))
    return map
  }, [branches])

  const clientMap = useMemo(() => {
    const map = new Map()
    clients.forEach((c) => map.set(String(c.id), c))
    return map
  }, [clients])

  const propertyMap = useMemo(() => {
    const map = new Map()
    propertyTypes.forEach((p) => map.set(String(p.id), p))
    return map
  }, [propertyTypes])

  const propertySubtypeMap = useMemo(() => {
    const map = new Map()
    propertySubtypes.forEach((p) => map.set(String(p.id), p))
    return map
  }, [propertySubtypes])

  const propertySubtypesByType = useMemo(() => {
    const map = new Map()
    propertySubtypes.forEach((subtype) => {
      const key = subtype.property_type_id
      const list = map.get(key) || []
      list.push(subtype)
      map.set(key, list)
    })
    return map
  }, [propertySubtypes])

  const propertySubtypesForType = useMemo(() => {
    if (!overviewForm?.property_type_id) return propertySubtypes
    const typeId = Number(overviewForm.property_type_id)
    return propertySubtypesByType.get(typeId) || []
  }, [overviewForm?.property_type_id, propertySubtypes, propertySubtypesByType])

  const documentCategoryOptions = useMemo(() => {
    if (!checklist) return []
    const combined = new Set([...(checklist.required_categories || []), ...(checklist.present_categories || [])])
    return Array.from(combined).sort()
  }, [checklist])

  const latestDocVersions = useMemo(() => {
    const map = new Map()
    ;(detail?.documents || []).forEach((doc) => {
      const key = doc.category || doc.original_name || `doc-${doc.id}`
      const current = map.get(key) || 0
      if (doc.version_number > current) map.set(key, doc.version_number)
    })
    return map
  }, [detail])

  const outputDocs = useMemo(() => {
    return (detail?.documents || []).filter((doc) => doc.is_final)
  }, [detail])

  const floorTotal = useMemo(
    () =>
      floors.reduce((sum, row) => {
        const area = Number(row.area)
        return Number.isFinite(area) ? sum + area : sum
      }, 0),
    [floors],
  )

  const assignment = detail?.assignment || null
  const due = detail?.due || null
  const missingDocs = detail?.missing_documents || []

  useEffect(() => {
    if (!documentCategoryOptions.length) return
    setDocumentForm((prev) => {
      if (prev.use_other) return prev
      if (prev.category) return prev
      return { ...prev, category: documentCategoryOptions[0] }
    })
  }, [documentCategoryOptions])

  const mentionCandidates = useMemo(() => {
    if (!mentionState.open) return []
    const query = mentionState.query.trim().toLowerCase()
    const participants = new Set()
    if (assignment?.assigned_to_user_id) participants.add(String(assignment.assigned_to_user_id))
    ;(assignment?.assignee_user_ids || []).forEach((id) => participants.add(String(id)))
    if (assignment?.created_by_user_id) participants.add(String(assignment.created_by_user_id))

    const activeUsers = users.filter((u) => u.is_active !== false)
    const filtered = query
      ? activeUsers.filter((u) => {
          const haystack = `${u.full_name || ''} ${u.email || ''}`.toLowerCase()
          return haystack.includes(query)
        })
      : activeUsers

    const sorted = filtered.sort((a, b) => {
      const aIsParticipant = participants.has(String(a.id))
      const bIsParticipant = participants.has(String(b.id))
      if (aIsParticipant && !bIsParticipant) return -1
      if (!aIsParticipant && bIsParticipant) return 1
      return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')
    })

    return sorted.slice(0, 8)
  }, [assignment, users, mentionState])

  const dueBadgeLabel = due ? dueStateLabel({ due_state: due.due_state, minutes_left: due.minutes_left, minutes_overdue: due.minutes_overdue }) : 'No SLA'
  const dueTone = dueStateTone(due?.due_state)

  const filteredBranches = useMemo(() => {
    if (!overviewForm?.bank_id) return branches
    return branches.filter((branch) => String(branch.bank_id) === String(overviewForm.bank_id))
  }, [branches, overviewForm?.bank_id])

  function refresh() {
    setReloadKey((k) => k + 1)
  }

  function updateOverview(key, value) {
    setOverviewForm((prev) => ({ ...prev, [key]: value }))
  }

  function handlePropertyTypeChange(value) {
    setOverviewForm((prev) => ({
      ...prev,
      property_type_id: value,
      property_subtype_id: '',
    }))
  }

  function toggleAssignee(userId) {
    setOverviewForm((prev) => {
      if (!prev) return prev
      const current = new Set((prev.assignee_user_ids || []).map(String))
      const id = String(userId)
      if (current.has(id)) {
        current.delete(id)
      } else {
        current.add(id)
      }
      return {
        ...prev,
        assignee_user_ids: Array.from(current),
      }
    })
  }

  function updateFloor(index, key, value) {
    setFloors((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  function addFloor() {
    setFloors((prev) => [...prev, { floor_name: '', area: '' }])
  }

  function removeFloor(index) {
    setFloors((prev) => prev.filter((_, i) => i !== index))
  }

  function updateMessageInput(value, caretPosition) {
    setMessageForm({ message: value })
    if (typeof caretPosition !== 'number') {
      setMentionState((prev) => ({ ...prev, open: false }))
      return
    }
    const uptoCaret = value.slice(0, caretPosition)
    const atIndex = uptoCaret.lastIndexOf('@')
    if (atIndex === -1) {
      setMentionState({ open: false, query: '', anchor: -1, caret: caretPosition })
      return
    }
    const charBefore = atIndex === 0 ? ' ' : uptoCaret[atIndex - 1]
    if (!/\s/.test(charBefore)) {
      setMentionState({ open: false, query: '', anchor: -1, caret: caretPosition })
      return
    }
    const query = uptoCaret.slice(atIndex + 1)
    if (/\s/.test(query)) {
      setMentionState({ open: false, query: '', anchor: -1, caret: caretPosition })
      return
    }
    setMentionState({ open: true, query, anchor: atIndex, caret: caretPosition })
  }

  function confirmLeaveOverride(detail) {
    if (!detail) return false
    const userLabel = userMap.get(String(detail.user_id))?.full_name
      || userMap.get(String(detail.user_id))?.email
      || `User ${detail.user_id}`
    const range = detail.leave_start && detail.leave_end ? `${detail.leave_start} → ${detail.leave_end}` : 'current leave'
    return window.confirm(`${userLabel} is on approved leave (${range}). Assign anyway?`)
  }

  function insertMention(userToMention) {
    const anchor = mentionState.anchor
    const caret = mentionState.caret
    if (anchor < 0 || caret < 0) return
    const displayName = userToMention.full_name || userToMention.email || `User ${userToMention.id}`
    const token = `@[${displayName}](${userToMention.id})`
    const current = messageForm.message
    const nextText = `${current.slice(0, anchor)}${token} ${current.slice(caret)}`
    setMessageForm({ message: nextText })
    setMentionState({ open: false, query: '', anchor: -1, caret: -1 })
    setMentionedUserIds((prev) => {
      const next = new Set(prev)
      next.add(userToMention.id)
      return Array.from(next)
    })

    requestAnimationFrame(() => {
      if (messageRef.current) {
        const pos = anchor + token.length + 1
        messageRef.current.focus()
        messageRef.current.setSelectionRange(pos, pos)
      }
    })
  }

  function updateTaskDraft(taskId, key, value) {
    setTaskDrafts((prev) => ({
      ...prev,
      [taskId]: { ...prev[taskId], [key]: value },
    }))
  }

  async function handleUpdateOverview(e) {
    e.preventDefault()
    if (!assignment || !overviewForm) return
    setError(null)
    setNotice(null)
    let payload = null
    try {
      const assigneeIds = new Set()
      if (overviewForm.assigned_to_user_id) {
        assigneeIds.add(Number(overviewForm.assigned_to_user_id))
      }
      (overviewForm.assignee_user_ids || []).forEach((id) => {
        const parsed = Number(id)
        if (Number.isFinite(parsed)) assigneeIds.add(parsed)
      })

      const floorsPayload = multiFloorEnabled
        ? floors
            .map((row, order_index) => ({
              floor_name: row.floor_name.trim(),
              area: Number(row.area),
              order_index,
            }))
            .filter((row) => row.floor_name && Number.isFinite(row.area) && row.area > 0)
        : []

      const builtupArea = multiFloorEnabled
        ? floorsPayload.length > 0
          ? floorTotal
          : null
        : overviewForm.builtup_area !== ''
          ? Number(overviewForm.builtup_area)
          : null

      payload = {
        case_type: overviewForm.case_type,
        service_line: overviewForm.service_line,
        bank_id: overviewForm.bank_id ? Number(overviewForm.bank_id) : null,
        branch_id: overviewForm.branch_id ? Number(overviewForm.branch_id) : null,
        client_id: overviewForm.client_id ? Number(overviewForm.client_id) : null,
        property_type_id: overviewForm.property_type_id ? Number(overviewForm.property_type_id) : null,
        property_subtype_id: overviewForm.property_subtype_id ? Number(overviewForm.property_subtype_id) : null,
        borrower_name: overviewForm.borrower_name.trim() || null,
        phone: overviewForm.phone.trim() || null,
        address: overviewForm.address.trim() || null,
        land_area: overviewForm.land_area !== '' ? Number(overviewForm.land_area) : null,
        builtup_area: builtupArea,
        status: overviewForm.status,
        assigned_to_user_id: overviewForm.assigned_to_user_id ? Number(overviewForm.assigned_to_user_id) : null,
        assignee_user_ids: Array.from(assigneeIds),
        site_visit_date: toIso(overviewForm.site_visit_date),
        report_due_date: toIso(overviewForm.report_due_date),
        notes: overviewForm.notes.trim() || null,
      }

      if (canModifyMoney) {
        payload.fees = overviewForm.fees !== '' ? Number(overviewForm.fees) : null
        payload.is_paid = Boolean(overviewForm.is_paid)
      }

      if (multiFloorEnabled) {
        payload.floors = floorsPayload
      } else if ((assignment.floors || []).length > 0) {
        payload.floors = []
      }

      await updateAssignment(assignment.id, payload)
      setNotice('Assignment updated.')
      refresh()
    } catch (err) {
      console.error(err)
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 409 && payload && confirmLeaveOverride(detail)) {
        try {
          await updateAssignment(assignment.id, { ...payload, override_on_leave: true })
          setNotice('Assignment updated with leave override.')
          refresh()
          return
        } catch (innerErr) {
          console.error(innerErr)
          setError(toUserMessage(innerErr, 'Failed to update assignment'))
          return
        }
      }
      setError(toUserMessage(err, 'Failed to update assignment'))
    }
  }

  async function handleDeleteAssignment() {
    if (!assignment) return
    const reason = window.prompt('Reason for deletion request:', 'Duplicate / invalid assignment')
    if (reason === null) return
    setError(null)
    setNotice(null)
    try {
      const result = await deleteAssignment(assignment.id, reason)
      if (result?.action_type) {
        setNotice('Deletion approval requested.')
      } else {
        setNotice('Assignment deleted.')
      }
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to delete assignment'))
    }
  }

  async function handleUploadDocument(e) {
    e.preventDefault()
    if (!assignment || !documentForm.file) return
    setError(null)
    setNotice(null)
    try {
      if (!documentForm.category || !documentForm.category.trim()) {
        setError('Please choose a document category.')
        return
      }
      await uploadDocumentWithMeta(assignment.id, {
        file: documentForm.file,
        category: documentForm.category.trim(),
        isFinal: documentForm.is_final,
      })
      setDocumentForm({ file: null, category: documentForm.category, use_other: false, is_final: false })
      setNotice('Document uploaded.')
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to upload document'))
    }
  }

  async function handleMarkDocumentFinal(doc) {
    if (!assignment) return
    setError(null)
    setNotice(null)
    try {
      await markDocumentFinal(assignment.id, doc.id, !doc.is_final)
      setNotice('Document final flag updated.')
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update document'))
    }
  }

  function handleOpenPreview(doc) {
    setSelectedDocument(doc)
    setPreviewOpen(true)
  }

  function handleClosePreview() {
    setPreviewOpen(false)
    setSelectedDocument(null)
  }

  function handlePreviewReviewComplete() {
    setNotice('Document review saved.')
    refresh()
  }

  async function handleMissingDocsReminder() {
    if (!assignment) return
    if (missingDocs.length === 0) {
      setNotice('No missing documents to remind.')
      return
    }
    const preview = missingDocs.slice(0, 6).join(', ')
    const defaultMessage = `Missing documents: ${preview}${missingDocs.length > 6 ? ` (+${missingDocs.length - 6} more)` : ''}`
    const message = window.prompt('Reminder message', defaultMessage)
    if (message === null) return
    setError(null)
    setNotice(null)
    try {
      await remindMissingDocs(assignment.id, { message })
      setNotice('Missing-docs reminder sent.')
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to send reminder'))
    }
  }

  async function handleCreateTask(e) {
    e.preventDefault()
    if (!assignment) return
    setError(null)
    setNotice(null)
    try {
      if (!taskForm.title.trim()) {
        setError('Task title is required.')
        return
      }
      const payload = {
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        status: taskForm.status,
        assigned_to_user_id: taskForm.assigned_to_user_id ? Number(taskForm.assigned_to_user_id) : null,
        due_at: toIso(taskForm.due_at),
      }
      await createTask(assignment.id, payload)
      setTaskForm({ title: '', description: '', status: 'TODO', assigned_to_user_id: '', due_at: '' })
      setNotice('Task created.')
      refresh()
    } catch (err) {
      console.error(err)
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 409 && confirmLeaveOverride(detail)) {
        try {
          await createTask(assignment.id, {
            title: taskForm.title.trim(),
            description: taskForm.description.trim() || null,
            status: taskForm.status,
            assigned_to_user_id: taskForm.assigned_to_user_id ? Number(taskForm.assigned_to_user_id) : null,
            due_at: toIso(taskForm.due_at),
            override_on_leave: true,
          })
          setTaskForm({ title: '', description: '', status: 'TODO', assigned_to_user_id: '', due_at: '' })
          setNotice('Task created with leave override.')
          refresh()
          return
        } catch (innerErr) {
          console.error(innerErr)
          setError(toUserMessage(innerErr, 'Failed to create task'))
          return
        }
      }
      setError(toUserMessage(err, 'Failed to create task'))
    }
  }

  async function handleSaveTask(task) {
    if (!assignment) return
    const draft = taskDrafts[task.id]
    if (!draft) return
    setError(null)
    setNotice(null)
    try {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        status: draft.status,
        assigned_to_user_id: draft.assigned_to_user_id ? Number(draft.assigned_to_user_id) : null,
        due_at: toIso(draft.due_at),
      }
      await updateTask(assignment.id, task.id, payload)
      setNotice('Task updated.')
      refresh()
    } catch (err) {
      console.error(err)
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 409 && confirmLeaveOverride(detail)) {
        try {
          const overridePayload = {
            title: draft.title.trim(),
            description: draft.description.trim() || null,
            status: draft.status,
            assigned_to_user_id: draft.assigned_to_user_id ? Number(draft.assigned_to_user_id) : null,
            due_at: toIso(draft.due_at),
            override_on_leave: true,
          }
          await updateTask(assignment.id, task.id, overridePayload)
          setNotice('Task updated with leave override.')
          refresh()
          return
        } catch (innerErr) {
          console.error(innerErr)
          setError(toUserMessage(innerErr, 'Failed to update task'))
          return
        }
      }
      setError(toUserMessage(err, 'Failed to update task'))
    }
  }

  async function handleDeleteTask(task) {
    if (!assignment) return
    const confirmed = window.confirm(`Delete task "${task.title}"?`)
    if (!confirmed) return
    setError(null)
    setNotice(null)
    try {
      await deleteTask(assignment.id, task.id)
      setNotice('Task deleted.')
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to delete task'))
    }
  }

  async function handleSendMessage(e) {
    e.preventDefault()
    if (!assignment) return
    setError(null)
    setNotice(null)
    try {
      const trimmed = messageForm.message.trim()
      if (!trimmed) return
      const parsedMentions = parseMentionIds(trimmed)
      const mentionIds = Array.from(new Set([...mentionedUserIds, ...parsedMentions]))
      await createMessage(assignment.id, { message: trimmed, mentions: mentionIds })
      setMessageForm({ message: '' })
      setMentionedUserIds([])
      setMentionState({ open: false, query: '', anchor: -1, caret: -1 })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to send message'))
    }
  }

  async function handleTogglePin(message) {
    if (!assignment) return
    setError(null)
    setNotice(null)
    try {
      if (message.pinned) {
        await unpinMessage(assignment.id, message.id)
      } else {
        await pinMessage(assignment.id, message.id)
      }
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update pin state'))
    }
  }

  async function handleDeleteMessage(message) {
    if (!assignment) return
    const confirmed = window.confirm('Delete this message?')
    if (!confirmed) return
    setError(null)
    setNotice(null)
    try {
      await deleteMessage(assignment.id, message.id)
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to delete message'))
    }
  }

  async function handleCreateInvoice(e) {
    e.preventDefault()
    if (!assignment) return
    if (!canCreateInvoice) {
      setError('You do not have permission to create invoices.')
      return
    }
    setError(null)
    setNotice(null)
    try {
      await createInvoice({
        assignment_id: assignment.id,
        tax_rate: Number(invoiceForm.tax_rate || 0),
        issued_date: invoiceForm.issued_date || null,
        due_date: invoiceForm.due_date || null,
        company_account_id: invoiceForm.company_account_id ? Number(invoiceForm.company_account_id) : null,
        notes: invoiceForm.notes.trim() || null,
        items: [],
      })
      setInvoiceForm({ tax_rate: invoiceForm.tax_rate, issued_date: '', due_date: '', company_account_id: '', notes: '' })
      setNotice('Invoice created.')
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create invoice'))
    }
  }

  async function handleIssueInvoice(invoice) {
    if (!canModifyInvoice) {
      setError('You do not have permission to issue invoices.')
      return
    }
    setError(null)
    setNotice(null)
    try {
      await issueInvoice(invoice.id)
      setNotice('Invoice issued.')
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to issue invoice'))
    }
  }

  async function handleMarkInvoicePaid(invoice) {
    setError(null)
    setNotice(null)
    try {
      const result = await markInvoicePaid(invoice.id)
      if (result?.action_type) {
        setNotice('Approval requested to mark invoice paid.')
      } else {
        setNotice('Invoice marked paid.')
      }
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to mark invoice paid'))
    }
  }

  async function handleInvoicePdf(invoice, { regenerate = false } = {}) {
    setError(null)
    setNotice(null)
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
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to generate invoice PDF'))
    } finally {
      setPdfLoadingId(null)
    }
  }

  async function handleRequestApproval(e) {
    e.preventDefault()
    if (!assignment) return
    setError(null)
    setNotice(null)
    try {
      await requestApproval({
        entity_type: 'ASSIGNMENT',
        entity_id: assignment.id,
        action_type: approvalForm.action_type,
        reason: approvalForm.reason.trim() || null,
        assignment_id: assignment.id,
      })
      setApprovalForm((prev) => ({ ...prev, reason: '' }))
      setNotice('Approval requested.')
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to request approval'))
    }
  }

  if (loading) {
    return <div className="muted">Loading assignment…</div>
  }

  if (!assignment || !overviewForm) {
    return <EmptyState>Assignment not found or not accessible.</EmptyState>
  }

  const assignedUser = assignment.assigned_to_user_id ? userMap.get(String(assignment.assigned_to_user_id)) : null
  const additionalAssignees = (assignment.additional_assignee_user_ids || [])
    .map((id) => userMap.get(String(id)))
    .filter(Boolean)
  const teamLabel = assignedUser
    ? `${assignedUser.full_name || assignedUser.email}${additionalAssignees.length ? ` (+${additionalAssignees.length})` : ''}`
    : additionalAssignees.length
      ? `${additionalAssignees[0]?.full_name || additionalAssignees[0]?.email}${additionalAssignees.length > 1 ? ` (+${additionalAssignees.length - 1})` : ''}`
      : 'Unassigned'
  const caseLabel = assignment.bank_name || assignment.valuer_client_name || titleCase(assignment.case_type)
  const pendingApprovals = detail.approvals.filter((a) => a.status === 'PENDING').length
  const unpaidInvoices = detail.invoices.filter((i) => !i.is_paid).length

  return (
    <div>
      <PageHeader
        title={`Assignment ${assignment.assignment_code}`}
        subtitle={caseLabel}
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={statusTone(assignment.status)}>{titleCase(assignment.status)}</Badge>
            <Badge tone={dueTone}>{dueBadgeLabel}</Badge>
            {missingDocs.length > 0 ? (
              <button type="button" className="ghost" onClick={() => setActiveTab('documents')}>
                Missing Docs: {missingDocs.length}
              </button>
            ) : null}
            {pendingApprovals > 0 ? (
              <button type="button" className="ghost" onClick={() => setActiveTab('approvals')}>
                Approvals: {pendingApprovals}
              </button>
            ) : null}
            {unpaidInvoices > 0 ? (
              <button type="button" className="ghost" onClick={() => setActiveTab('finance')}>
                Unpaid: {unpaidInvoices}
              </button>
            ) : null}
            <Link className="nav-link" to="/assignments">Back to list</Link>
          </div>
        )}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div> : null}
      {notice ? <div className="card notice tight" style={{ marginBottom: '0.8rem' }}>{notice}</div> : null}

      <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
        <Stat label="Due" value={due ? formatDateTime(due.due_time) : '—'} help="Computed SLA due time based on site visit/report dates." />
        <Stat label="Missing Docs" value={missingDocs.length} tone={missingDocs.length > 0 ? 'warn' : 'ok'} help="Required document categories still missing." />
        <Stat label="Tasks" value={detail.tasks.length} help="Tasks attached to this assignment." />
        <Stat label="Invoices" value={detail.invoices.length} tone={detail.invoices.some((i) => !i.is_paid) ? 'warn' : 'ok'} help="Invoices tied to this assignment." />
      </div>

      <HealthBadges
        dueState={due?.due_state}
        missingCount={missingDocs.length}
        isPaid={assignment.is_paid}
        unpaidInvoices={unpaidInvoices}
      />

      <div className="tab-shell">
        <div className="tab-header">
          <Tabs tabs={TAB_ITEMS} active={activeTab} onChange={setActiveTab} />
        </div>

        <div className="tab-body">
          {activeTab === 'overview' ? (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.8fr) minmax(340px, 1fr)' }}>
          <Card>
            <CardHeader
              title="Command Overview"
              subtitle="Update the assignment, keep the workflow unblocked, and maintain clean data."
              action={<button type="button" className="secondary" onClick={refresh}>Refresh</button>}
            />

            <form className="grid" onSubmit={handleUpdateOverview}>
              <div className="grid cols-4">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Case Type</span>
                  <select value={overviewForm.case_type} onChange={(e) => updateOverview('case_type', e.target.value)}>
                    {['BANK', 'EXTERNAL_VALUER', 'DIRECT_CLIENT'].map((type) => (
                      <option key={type} value={type}>{titleCase(type)}</option>
                    ))}
                  </select>
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Service Line</span>
                  <select value={overviewForm.service_line} onChange={(e) => updateOverview('service_line', e.target.value)}>
                    {SERVICE_LINES.map((line) => (
                      <option key={line} value={line}>{titleCase(line)}</option>
                    ))}
                  </select>
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Status</span>
                  <select value={overviewForm.status} onChange={(e) => updateOverview('status', e.target.value)}>
                    {ASSIGNMENT_STATUSES.map((status) => (
                      <option key={status} value={status}>{titleCase(status)}</option>
                    ))}
                  </select>
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Assigned To</span>
                  <select
                    value={overviewForm.assigned_to_user_id}
                    onChange={(e) => updateOverview('assigned_to_user_id', e.target.value)}
                    disabled={!canReassign && assignment.assigned_to_user_id !== user?.id}
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                    ))}
                  </select>
                </label>
              </div>

              {users.length ? (
                <div style={{ marginTop: '0.9rem' }}>
                  <div className="kicker" style={{ marginBottom: 6 }}>Additional Assignees</div>
                  <div className="grid cols-3" style={{ gap: 8 }}>
                    {users.map((u) => {
                      const isPrimary = String(u.id) === String(overviewForm.assigned_to_user_id)
                      const checked = (overviewForm.assignee_user_ids || []).includes(String(u.id))
                      return (
                        <label key={u.id} className="list-item" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <input
                            type="checkbox"
                            checked={isPrimary || checked}
                            disabled={isPrimary || (!canReassign && assignment.assigned_to_user_id !== user?.id)}
                            onChange={() => toggleAssignee(u.id)}
                          />
                          <div>
                            <div style={{ fontWeight: 600 }}>{u.full_name || u.email}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{u.role}</div>
                            {isPrimary ? <Badge tone="info">Primary</Badge> : null}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <div className="grid cols-3">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Bank</span>
                  <select value={overviewForm.bank_id} onChange={(e) => updateOverview('bank_id', e.target.value)}>
                    <option value="">Select bank</option>
                    {banks.map((bank) => (
                      <option key={bank.id} value={bank.id}>{bank.name}</option>
                    ))}
                  </select>
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Branch</span>
                  <select value={overviewForm.branch_id} onChange={(e) => updateOverview('branch_id', e.target.value)}>
                    <option value="">Select branch</option>
                    {filteredBranches.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Client</span>
                  <select value={overviewForm.client_id} onChange={(e) => updateOverview('client_id', e.target.value)}>
                    <option value="">Select client</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>{client.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid cols-3">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Borrower</span>
                  <input value={overviewForm.borrower_name} onChange={(e) => updateOverview('borrower_name', e.target.value)} />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Phone</span>
                  <input value={overviewForm.phone} onChange={(e) => updateOverview('phone', e.target.value)} />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Property Type</span>
                  <select value={overviewForm.property_type_id} onChange={(e) => handlePropertyTypeChange(e.target.value)}>
                    <option value="">Select property type</option>
                    {propertyTypes.map((property) => (
                      <option key={property.id} value={property.id}>{property.name}</option>
                    ))}
                  </select>
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Property Subtype</span>
                  <select
                    value={overviewForm.property_subtype_id}
                    onChange={(e) => updateOverview('property_subtype_id', e.target.value)}
                    disabled={!overviewForm.property_type_id}
                  >
                    <option value="">{overviewForm.property_type_id ? 'Select subtype' : 'Select type first'}</option>
                    {propertySubtypesForType.map((subtype) => (
                      <option key={subtype.id} value={subtype.id}>{subtype.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid cols-3">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Land Area</span>
                  <input type="number" step="0.01" value={overviewForm.land_area} onChange={(e) => updateOverview('land_area', e.target.value)} />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Built-up Area</span>
                  {multiFloorEnabled ? (
                    <input value={floorTotal ? floorTotal.toFixed(2) : ''} readOnly />
                  ) : (
                    <input type="number" step="0.01" value={overviewForm.builtup_area} onChange={(e) => updateOverview('builtup_area', e.target.value)} />
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={multiFloorEnabled}
                      onChange={(e) => setMultiFloorEnabled(e.target.checked)}
                    />
                    Multiple floors
                  </label>
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Fees</span>
                  <input
                    type="number"
                    step="0.01"
                    value={overviewForm.fees}
                    onChange={(e) => updateOverview('fees', e.target.value)}
                    disabled={!canModifyMoney}
                  />
                </label>
              </div>

              {multiFloorEnabled ? (
                <div style={{ marginTop: '0.9rem' }}>
                  <div className="kicker" style={{ marginBottom: 6 }}>Floor-wise Built-up Area</div>
                  <div className="grid" style={{ gap: 8 }}>
                    {floors.map((row, index) => (
                      <div key={`floor-${index}`} className="grid cols-3" style={{ gap: 8 }}>
                        <input
                          value={row.floor_name}
                          onChange={(e) => updateFloor(index, 'floor_name', e.target.value)}
                          placeholder="Floor name"
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={row.area}
                          onChange={(e) => updateFloor(index, 'area', e.target.value)}
                          placeholder="Area"
                        />
                        <button type="button" className="ghost" onClick={() => removeFloor(index)} disabled={floors.length === 1}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                    <button type="button" className="secondary" onClick={addFloor}>Add Floor</button>
                    <Badge tone="info">Total: {floorTotal ? floorTotal.toFixed(2) : '0.00'}</Badge>
                  </div>
                </div>
              ) : null}

              <div className="grid cols-3">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Site Visit</span>
                  <input type="datetime-local" value={overviewForm.site_visit_date} onChange={(e) => updateOverview('site_visit_date', e.target.value)} />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Report Due</span>
                  <input type="datetime-local" value={overviewForm.report_due_date} onChange={(e) => updateOverview('report_due_date', e.target.value)} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                  <input type="checkbox" checked={overviewForm.is_paid} onChange={(e) => updateOverview('is_paid', e.target.checked)} disabled={!canModifyMoney} />
                  Paid
                </label>
              </div>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Address</span>
                <textarea rows={3} value={overviewForm.address} onChange={(e) => updateOverview('address', e.target.value)} />
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Notes</span>
                <textarea rows={4} value={overviewForm.notes} onChange={(e) => updateOverview('notes', e.target.value)} />
              </label>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="submit">Save Overview</button>
                <button type="button" className="secondary" onClick={handleDeleteAssignment}>Delete / Request Delete</button>
              </div>
            </form>
          </Card>

          <div className="grid">
            <Card>
              <CardHeader title="SLA & Escalation" subtitle="The due clock is computed from dates or creation time." />
              <div className="list">
                <Signal label="Due State" value={due?.due_state || 'NA'} tone={dueTone} />
                <Signal label="Due Time" value={due?.due_time ? formatDateTime(due.due_time) : '—'} />
                <Signal label="Minutes Left" value={due?.minutes_left ?? '—'} />
                <Signal label="Minutes Overdue" value={due?.minutes_overdue ?? '—'} tone={due?.minutes_overdue ? 'danger' : undefined} />
                <Signal label="Escalation" value={due?.escalation_role || '—'} tone={due?.escalation_role ? 'warn' : undefined} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Missing Documents" subtitle="Driven by bank/branch templates and uploads." />
              {missingDocs.length === 0 ? (
                <EmptyState>No missing document signals right now.</EmptyState>
              ) : (
                <div className="list">
                  {missingDocs.map((doc) => (
                    <div key={doc} className="list-item" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{doc}</span>
                      <Badge tone="warn">Missing</Badge>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                <button type="button" className="secondary" onClick={handleMissingDocsReminder} disabled={missingDocs.length === 0}>
                  Send Reminder
                </button>
              </div>
            </Card>

            <Card>
              <CardHeader title="Assignment Context" subtitle="Denormalized names and key references." />
              <div className="list">
                <ContextRow label="Service Line" value={assignment.service_line ? titleCase(assignment.service_line) : '—'} />
                <ContextRow label="Bank" value={assignment.bank_name || bankMap.get(String(assignment.bank_id))?.name} />
                <ContextRow label="Branch" value={assignment.branch_name || branchMap.get(String(assignment.branch_id))?.name} />
                <ContextRow label="Client" value={assignment.valuer_client_name || clientMap.get(String(assignment.client_id))?.name} />
                <ContextRow label="Property" value={assignment.property_type || propertyMap.get(String(assignment.property_type_id))?.name} />
                <ContextRow label="Subtype" value={assignment.property_subtype_name || propertySubtypeMap.get(String(assignment.property_subtype_id))?.name} />
                <ContextRow label="Assigned" value={teamLabel} />
              </div>
            </Card>
          </div>
        </div>
      ) : activeTab === 'documents' ? (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(340px, 1fr)' }}>
          <Card>
            <CardHeader
              title="Document Library"
              subtitle="Versioned uploads with final markers and category tracking."
              action={<button type="button" className="secondary" onClick={refresh}>Refresh</button>}
            />

            {detail.documents.length === 0 ? (
              <EmptyState>No documents uploaded yet.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Version</th>
                      <th>Status</th>
                      <th>Uploaded</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.documents.map((doc) => {
                      const uploader = doc.uploaded_by_user_id ? userMap.get(String(doc.uploaded_by_user_id)) : null
                      const downloadUrl = documentDownloadUrl(assignment.id, doc.id)
                      const categoryKey = doc.category || doc.original_name || `doc-${doc.id}`
                      const isLatest = latestDocVersions.get(categoryKey) === doc.version_number
                      
                      function getStatusColor(status) {
                        switch (status) {
                          case 'REVIEWED': return 'ok'
                          case 'FINAL': return 'info'
                          case 'NEEDS_CLARIFICATION': return 'warn'
                          case 'REJECTED': return 'danger'
                          default: return 'muted'
                        }
                      }
                      
                      return (
                        <tr
                          key={doc.id}
                          onClick={() => handleOpenPreview(doc)}
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-alt)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = ''}
                        >
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <strong>{doc.original_name}</strong>
                              <span className="muted" style={{ fontSize: 12 }}>{doc.mime_type || 'file'}</span>
                              {doc.comments_count > 0 && (
                                <span style={{ fontSize: 11, color: 'var(--accent-2)' }}>
                                  💬 {doc.comments_count} {doc.unresolved_count > 0 && `(${doc.unresolved_count} unresolved)`}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>{doc.category || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>v{doc.version_number}</span>
                              {isLatest ? <Badge tone="info">Latest</Badge> : null}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <Badge tone={getStatusColor(doc.review_status)}>
                                {doc.review_status?.replace(/_/g, ' ')}
                              </Badge>
                              {doc.is_final && <Badge tone="ok">Final</Badge>}
                              {doc.visibility === 'PARTNER_RELEASED' && (
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>👁️ Partner</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span>{formatDateTime(doc.created_at)}</span>
                              <span className="muted" style={{ fontSize: 12 }}>{uploader?.full_name || uploader?.email || doc.uploaded_by_user_id}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                            <a href={downloadUrl} target="_blank" rel="noreferrer" className="nav-link">Download</a>
                            <button type="button" className="ghost" onClick={() => handleMarkDocumentFinal(doc)}>
                              {doc.is_final ? 'Unset Final' : 'Mark Final'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid">
            <Card>
              <CardHeader title="Upload" subtitle="Attach documents and tag them for checklist tracking." />
              <form className="grid" onSubmit={handleUploadDocument}>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">File</span>
                  <input type="file" onChange={(e) => setDocumentForm((prev) => ({ ...prev, file: e.target.files?.[0] || null }))} />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Category</span>
                  <select
                    value={documentForm.use_other ? '__other__' : documentForm.category}
                    onChange={(e) => {
                      const value = e.target.value
                      if (value === '__other__') {
                        setDocumentForm((prev) => ({ ...prev, use_other: true, category: '' }))
                      } else {
                        setDocumentForm((prev) => ({ ...prev, use_other: false, category: value }))
                      }
                    }}
                  >
                    <option value="">Select category</option>
                    {documentCategoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                    <option value="__other__">Other (custom)</option>
                  </select>
                </label>
                {documentForm.use_other ? (
                  <label className="grid" style={{ gap: 6 }}>
                    <span className="kicker">Custom Category</span>
                    <input
                      value={documentForm.category}
                      onChange={(e) => setDocumentForm((prev) => ({ ...prev, category: e.target.value }))}
                      placeholder="EC, Sale Deed, Photos, Draft Report..."
                    />
                  </label>
                ) : null}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={documentForm.is_final} onChange={(e) => setDocumentForm((prev) => ({ ...prev, is_final: e.target.checked }))} />
                  Mark as final version
                </label>
                <button type="submit" disabled={!documentForm.file}>Upload Document</button>
              </form>
            </Card>

            <Card>
            <CardHeader title="Checklist" subtitle="Required, present, and missing categories." />
            {!checklist ? (
              <EmptyState>Checklist unavailable.</EmptyState>
            ) : (
              <div className="grid" style={{ gap: 10 }}>
                <ChecklistGroup label="Missing" items={checklist.missing_categories} tone="warn" />
                <ChecklistGroup label="Present" items={checklist.present_categories} tone="ok" />
                <ChecklistGroup label="Required" items={checklist.required_categories} tone="info" />
              </div>
            )}
          </Card>
        </div>
        </div>
      ) : activeTab === 'tasks' ? (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(340px, 1fr)' }}>
          <Card>
            <CardHeader title="Task Board" subtitle="Micro-tasks that keep assignments moving." action={<button type="button" className="secondary" onClick={refresh}>Refresh</button>} />
            {detail.tasks.length === 0 ? (
              <EmptyState>No tasks yet.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Status</th>
                      <th>Assignee</th>
                      <th>Due</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.tasks.map((task) => {
                      const draft = taskDrafts[task.id] || {}
                      const assignee = draft.assigned_to_user_id ? userMap.get(String(draft.assigned_to_user_id)) : null
                      return (
                        <tr key={task.id}>
                          <td>
                            <div className="grid" style={{ gap: 6 }}>
                              <input value={draft.title || ''} onChange={(e) => updateTaskDraft(task.id, 'title', e.target.value)} />
                              <textarea rows={2} value={draft.description || ''} onChange={(e) => updateTaskDraft(task.id, 'description', e.target.value)} />
                            </div>
                          </td>
                          <td>
                            <select value={draft.status || task.status} onChange={(e) => updateTaskDraft(task.id, 'status', e.target.value)}>
                              {TASK_STATUSES.map((status) => (
                                <option key={status} value={status}>{titleCase(status)}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select value={draft.assigned_to_user_id || ''} onChange={(e) => updateTaskDraft(task.id, 'assigned_to_user_id', e.target.value)}>
                              <option value="">Unassigned</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                              ))}
                            </select>
                            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{assignee?.email}</div>
                          </td>
                          <td>
                            <input type="datetime-local" value={draft.due_at || ''} onChange={(e) => updateTaskDraft(task.id, 'due_at', e.target.value)} />
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button type="button" className="secondary" onClick={() => handleSaveTask(task)}>Save</button>
                            <button type="button" className="ghost" onClick={() => handleDeleteTask(task)}>Delete</button>
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
            <CardHeader title="Add Task" subtitle="Create follow-ups, review steps, and payment chases." />
            <form className="grid" onSubmit={handleCreateTask}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Title</span>
                <input value={taskForm.title} onChange={(e) => setTaskForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Site visit completed" />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Description</span>
                <textarea rows={3} value={taskForm.description} onChange={(e) => setTaskForm((prev) => ({ ...prev, description: e.target.value }))} />
              </label>
              <div className="grid cols-2">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Status</span>
                  <select value={taskForm.status} onChange={(e) => setTaskForm((prev) => ({ ...prev, status: e.target.value }))}>
                    {TASK_STATUSES.map((status) => (
                      <option key={status} value={status}>{titleCase(status)}</option>
                    ))}
                  </select>
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Assignee</span>
                  <select value={taskForm.assigned_to_user_id} onChange={(e) => setTaskForm((prev) => ({ ...prev, assigned_to_user_id: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Due</span>
                <input type="datetime-local" value={taskForm.due_at} onChange={(e) => setTaskForm((prev) => ({ ...prev, due_at: e.target.value }))} />
              </label>
              <button type="submit">Create Task</button>
            </form>
          </Card>
        </div>
      ) : activeTab === 'timeline' ? (
        <Card>
          <CardHeader
            title="Timeline"
            subtitle="Audit log of actions and system events."
            action={(
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={timelineOrder === 'desc' ? 'secondary' : 'ghost'}
                  onClick={() => setTimelineOrder('desc')}
                >
                  Newest
                </button>
                <button
                  type="button"
                  className={timelineOrder === 'asc' ? 'secondary' : 'ghost'}
                  onClick={() => setTimelineOrder('asc')}
                >
                  Oldest
                </button>
                <button type="button" className="secondary" onClick={refresh}>Refresh</button>
              </div>
            )}
          />
          {orderedTimeline.length === 0 ? (
            <EmptyState>No timeline events yet.</EmptyState>
          ) : (
            <div className="list">
              {orderedTimeline.map((event) => {
                const actor = event.actor_user_id ? userMap.get(String(event.actor_user_id)) : null
                return (
                  <div key={event.id} className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <strong>{titleCase(event.type)}</strong>
                        {event.message ? <div>{event.message}</div> : null}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {actor?.full_name || actor?.email || event.actor_user_id || 'System'} · {formatDateTime(event.created_at)}
                        </div>
                      </div>
                      {event.payload_json ? (
                        <pre style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', maxWidth: 320, whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(event.payload_json, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      ) : activeTab === 'chat' ? (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(340px, 1fr)' }}>
          <Card>
            <CardHeader title="Chat" subtitle="Threaded context attached to the assignment." action={<button type="button" className="secondary" onClick={refresh}>Refresh</button>} />
            {detail.messages.length === 0 ? (
              <EmptyState>No messages yet.</EmptyState>
            ) : (
              <div className="grid" style={{ gap: 12 }}>
                {detail.messages.some((m) => m.pinned) ? (
                  <div>
                    <div className="kicker" style={{ marginBottom: 6 }}>Pinned</div>
                    <div className="list">
                      {detail.messages.filter((m) => m.pinned).map((message) => {
                        const sender = message.sender_user_id ? userMap.get(String(message.sender_user_id)) : null
                        return (
                          <div key={`pinned-${message.id}`} className="list-item">
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <strong>{sender?.full_name || sender?.email || message.sender_user_id}</strong>
                                  <Badge tone="info">Pinned</Badge>
                                </div>
                                <div>{renderMessageText(message.message, userMap)}</div>
                                <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(message.created_at)}</div>
                              </div>
                              <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
                                <button type="button" className="ghost" onClick={() => handleTogglePin(message)}>
                                  Unpin
                                </button>
                                <button type="button" className="ghost" onClick={() => handleDeleteMessage(message)}>Delete</button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <div>
                  <div className="kicker" style={{ marginBottom: 6 }}>Thread</div>
                  <div className="list">
                    {detail.messages.filter((m) => !m.pinned).map((message) => {
                      const sender = message.sender_user_id ? userMap.get(String(message.sender_user_id)) : null
                      return (
                        <div key={message.id} className="list-item">
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <strong>{sender?.full_name || sender?.email || message.sender_user_id}</strong>
                              </div>
                              <div>{renderMessageText(message.message, userMap)}</div>
                              <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(message.created_at)}</div>
                            </div>
                            <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
                              <button type="button" className="ghost" onClick={() => handleTogglePin(message)}>
                                Pin
                              </button>
                              <button type="button" className="ghost" onClick={() => handleDeleteMessage(message)}>Delete</button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Send Message" subtitle="Drop context, questions, and updates for the team." />
            <form className="grid" onSubmit={handleSendMessage}>
              <div style={{ position: 'relative' }}>
                <textarea
                  ref={messageRef}
                  rows={6}
                  value={messageForm.message}
                  onChange={(e) => updateMessageInput(e.target.value, e.target.selectionStart)}
                  onKeyUp={(e) => updateMessageInput(e.target.value, e.target.selectionStart)}
                  placeholder="Type a message... Use @ to mention someone."
                />
                {mentionState.open && mentionCandidates.length > 0 ? (
                  <div
                    className="card"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: '100%',
                      marginBottom: 8,
                      maxHeight: 180,
                      overflow: 'auto',
                      zIndex: 10,
                    }}
                  >
                    <div className="list">
                      {mentionCandidates.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          className="list-item"
                          onClick={() => insertMention(u)}
                          style={{ textAlign: 'left' }}
                        >
                          <div style={{ fontWeight: 600 }}>{u.full_name || u.email}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{u.email}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const list = missingDocs.length > 0 ? missingDocs.join(', ') : 'the required documents'
                    setMessageForm({ message: `Please upload the missing documents: ${list}.` })
                  }}
                >
                  Doc Request
                </button>
                <button type="button" className="secondary" onClick={() => setMessageForm({ message: 'Site visit completed. Uploading photos and notes shortly.' })}>
                  Site Visit Done
                </button>
                <button type="button" className="secondary" onClick={() => setMessageForm({ message: 'Draft report is ready for review.' })}>
                  Report Submitted
                </button>
                <button type="button" className="secondary" onClick={() => setMessageForm({ message: 'Payment follow-up: invoice pending. Please confirm timeline.' })}>
                  Payment Follow-up
                </button>
              </div>
              <button type="submit">Send</button>
            </form>
          </Card>
        </div>
      ) : activeTab === 'approvals' ? (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(340px, 1fr)' }}>
          <Card>
            <CardHeader title="Approval History" subtitle="Requests attached to this assignment." action={<button type="button" className="secondary" onClick={refresh}>Refresh</button>} />
            {detail.approvals.length === 0 ? (
              <EmptyState>No approvals yet.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Status</th>
                      <th>Requester</th>
                      <th>Approver</th>
                      <th>Reason</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.approvals.map((approval) => {
                      const requester = approval.requester_user_id ? userMap.get(String(approval.requester_user_id)) : null
                      const approver = approval.approver_user_id ? userMap.get(String(approval.approver_user_id)) : null
                      const tone = approval.status === 'APPROVED' ? 'ok' : approval.status === 'REJECTED' ? 'danger' : 'warn'
                      return (
                        <tr key={approval.id}>
                          <td>{titleCase(approval.action_type)}</td>
                          <td><Badge tone={tone}>{titleCase(approval.status)}</Badge></td>
                          <td>{requester?.full_name || requester?.email || approval.requester_user_id}</td>
                          <td>{approver?.full_name || approver?.email || approval.approver_user_id || 'Unassigned'}</td>
                          <td>{approval.reason || '—'}</td>
                          <td>{formatDateTime(approval.created_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Request Approval" subtitle="Route sensitive actions through governance." />
            <form className="grid" onSubmit={handleRequestApproval}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Action</span>
                <select value={approvalForm.action_type} onChange={(e) => setApprovalForm((prev) => ({ ...prev, action_type: e.target.value }))}>
                  {(approvalTemplates.length > 0 ? approvalTemplates.map((t) => t.action_type) : DEFAULT_APPROVAL_ACTIONS).map((action) => (
                    <option key={action} value={action}>{titleCase(action)}</option>
                  ))}
                </select>
                {selectedApprovalTemplate?.description ? (
                  <span className="muted" style={{ fontSize: 12 }}>{selectedApprovalTemplate.description}</span>
                ) : null}
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Reason</span>
                <textarea rows={4} value={approvalForm.reason} onChange={(e) => setApprovalForm((prev) => ({ ...prev, reason: e.target.value }))} />
              </label>
              <button type="submit">Request Approval</button>
            </form>
          </Card>
        </div>
      ) : activeTab === 'finance' ? (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(340px, 1fr)' }}>
          <Card>
            <CardHeader title="Invoices" subtitle="Assignment-linked billing and payment tracking." action={<button type="button" className="secondary" onClick={refresh}>Refresh</button>} />
            {detail.invoices.length === 0 ? (
              <EmptyState>No invoices yet.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Status</th>
                      <th>Issued</th>
                      <th>Total</th>
                      <th>PDF</th>
                      <th>Paid</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <strong>{invoice.invoice_number || 'Draft'}</strong>
                            <span className="muted" style={{ fontSize: 12 }}>{invoice.assignment_code}</span>
                          </div>
                        </td>
                        <td>
                          <Badge
                            tone={invoice.status === 'PAID'
                              ? 'ok'
                              : invoice.status === 'PARTIALLY_PAID'
                                ? 'warn'
                                : invoice.status === 'ISSUED' || invoice.status === 'SENT'
                                  ? 'info'
                                  : invoice.status === 'VOID'
                                    ? 'muted'
                                    : 'accent'}
                          >
                            {titleCase(invoice.status)}
                          </Badge>
                        </td>
                        <td>{formatDate(invoice.issued_date)}</td>
                        <td>{formatMoney(invoice.total_amount)}</td>
                        <td>{invoice.pdf_generated_at ? <Badge tone="ok">Ready</Badge> : <span className="muted">Not generated</span>}</td>
                        <td>{invoice.is_paid ? 'Yes' : 'No'}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleInvoicePdf(invoice)}
                            disabled={pdfLoadingId === invoice.id}
                          >
                            {pdfLoadingId === invoice.id ? 'Generating…' : invoice.pdf_generated_at ? 'Download PDF' : 'Generate PDF'}
                          </button>
                          {invoice.pdf_generated_at ? (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => handleInvoicePdf(invoice, { regenerate: true })}
                              disabled={pdfLoadingId === invoice.id}
                            >
                              Regenerate
                            </button>
                          ) : null}
                          {invoice.status === 'DRAFT' ? (
                            <button type="button" className="secondary" onClick={() => handleIssueInvoice(invoice)} disabled={!canModifyInvoice}>
                              Issue
                            </button>
                          ) : null}
                          {!invoice.is_paid ? (
                            <button type="button" className="ghost" onClick={() => handleMarkInvoicePaid(invoice)}>Mark Paid</button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Create Invoice" subtitle="Invoices inherit assignment codes for trackability." />
            <form className="grid" onSubmit={handleCreateInvoice}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Tax Rate (%)</span>
                <input type="number" min="0" step="0.01" value={invoiceForm.tax_rate} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, tax_rate: e.target.value }))} />
              </label>
              <div className="grid cols-2">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Issued Date</span>
                  <input type="date" value={invoiceForm.issued_date} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, issued_date: e.target.value }))} />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Due Date</span>
                  <input type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, due_date: e.target.value }))} />
                </label>
              </div>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Company Account</span>
                <select value={invoiceForm.company_account_id} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, company_account_id: e.target.value }))}>
                  <option value="">Use primary</option>
                  {companyAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.account_name} · {account.bank_name}</option>
                  ))}
                </select>
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Notes</span>
                <textarea rows={3} value={invoiceForm.notes} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, notes: e.target.value }))} />
              </label>
              <button type="submit" disabled={!canCreateInvoice}>Create Invoice</button>
              {!canCreateInvoice ? (
                <div className="muted" style={{ fontSize: 12 }}>Your role cannot create invoices.</div>
              ) : null}
            </form>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader title="Outputs" subtitle="Final deliverables, packs, and bank-ready artifacts." />
          {outputDocs.length === 0 ? (
            <EmptyState>
              No final outputs yet. Mark documents as final in the Documents tab to surface them here.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Version</th>
                    <th>Uploaded</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {outputDocs.map((doc) => {
                    const uploader = doc.uploaded_by_user_id ? userMap.get(String(doc.uploaded_by_user_id)) : null
                    const downloadUrl = documentDownloadUrl(assignment.id, doc.id)
                    const categoryKey = doc.category || doc.original_name || `doc-${doc.id}`
                    const isLatest = latestDocVersions.get(categoryKey) === doc.version_number
                    return (
                      <tr key={doc.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <strong>{doc.original_name}</strong>
                            <span className="muted" style={{ fontSize: 12 }}>{doc.mime_type || 'file'}</span>
                          </div>
                        </td>
                        <td>{doc.category || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>v{doc.version_number}</span>
                            {isLatest ? <Badge tone="info">Latest</Badge> : null}
                            <Badge tone="ok">Final</Badge>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span>{formatDateTime(doc.created_at)}</span>
                            <span className="muted" style={{ fontSize: 12 }}>{uploader?.full_name || uploader?.email || doc.uploaded_by_user_id}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <a href={downloadUrl} target="_blank" rel="noreferrer" className="nav-link">Download</a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                <button type="button" className="secondary" disabled>
                  Generate Output Pack (Coming Soon)
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
        </div>
      </div>

      {/* Document Preview Drawer */}
      {selectedDocument && (
        <DocumentPreviewDrawerV2
          document={selectedDocument}
          assignmentId={assignment.id}
          previewUrl={documentPreviewUrl(assignment.id, selectedDocument.id)}
          downloadUrl={documentDownloadUrl(assignment.id, selectedDocument.id)}
          isOpen={previewOpen}
          onClose={handleClosePreview}
          onReviewComplete={handlePreviewReviewComplete}
          currentUser={user}
        />
      )}

    </div>
  )
}

function Stat({ label, value, tone, help }) {
  return (
    <div className="card tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <InfoTip text={help} /> : null}
      </div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
    </div>
  )
}

function HealthBadges({ dueState, missingCount = 0, isPaid, unpaidInvoices = 0 }) {
  const items = []
  if (missingCount > 0) items.push({ label: `Missing Docs (${missingCount})`, tone: 'warn' })
  if (dueState === 'OVERDUE') items.push({ label: 'Overdue', tone: 'danger' })
  if (isPaid === false) items.push({ label: 'Payment Pending', tone: 'accent' })
  if (unpaidInvoices > 0) items.push({ label: `Unpaid Invoices (${unpaidInvoices})`, tone: 'info' })
  if (items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '0.9rem' }}>
      {items.map((item) => (
        <Badge key={item.label} tone={item.tone}>{item.label}</Badge>
      ))}
    </div>
  )
}

function Signal({ label, value, tone }) {
  return (
    <div className="list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span className="muted">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  )
}

function ContextRow({ label, value }) {
  return (
    <div className="list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span className="muted">{label}</span>
      <span>{value || '—'}</span>
    </div>
  )
}

function ChecklistGroup({ label, items, tone }) {
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 6 }}>{label}</div>
      {items?.length ? (
        <div className="list">
          {items.map((item) => (
            <div key={item} className="list-item" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{item}</span>
              <Badge tone={tone}>{label}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>No {label.toLowerCase()} items.</EmptyState>
      )}
    </div>
  )
}

// Append DocumentPreviewDrawer at render
// Line modification workaround - check if drawer renders correctly
