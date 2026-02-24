import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import InfoTip from '../../components/ui/InfoTip'
import Tabs from '../../components/ui/Tabs'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import { fetchAssignments, updateAssignment } from '../../api/assignments'
import { fetchUsers, createUser, updateUser, resetPassword } from '../../api/users'
import { fetchExternalPartners, createExternalPartner, updateExternalPartner } from '../../api/master'
import { fetchPartnerSummary } from '../../api/analytics'
import { formatDateTime, formatMoney, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { loadJson, saveJson } from '../../utils/storage'
import { getUserRoles, userHasAnyRole, userHasRole } from '../../utils/rbac'

const ROLES = ['ADMIN', 'OPS_MANAGER', 'HR', 'FINANCE', 'ASSISTANT_VALUER', 'FIELD_VALUER', 'EMPLOYEE']
const SERVICE_LINES = ['VALUATION', 'INDUSTRIAL', 'DPR', 'CMA']
const CAPABILITY_OPTIONS = [
  { key: 'view_all_assignments', label: 'View All Assignments', help: 'Allow viewing all assignments, not just mine.' },
  { key: 'create_assignment', label: 'Create Assignments', help: 'Allow creating new assignments.' },
  { key: 'modify_money', label: 'Modify Financials', help: 'Allow editing fees, invoice amounts, and payments.' },
  { key: 'reassign', label: 'Reassign Work', help: 'Allow reassigning assignments across staff.' },
  { key: 'view_users', label: 'View Users', help: 'Allow visibility into staff directory.' },
  { key: 'manage_users', label: 'Manage Users', help: 'Allow editing users, roles, and access.' },
  { key: 'view_invoices', label: 'View Invoices', help: 'Allow viewing invoices.' },
  { key: 'create_invoice', label: 'Create Invoices', help: 'Allow creating new invoices.' },
  { key: 'modify_invoice', label: 'Modify Invoices', help: 'Allow updating invoices and sending reminders.' },
  { key: 'manage_master_data', label: 'Manage Master Data', help: 'Allow editing master data tables.' },
  { key: 'manage_company_accounts', label: 'Manage Company Accounts', help: 'Allow editing company bank accounts.' },
  { key: 'approve_actions', label: 'Approve Actions', help: 'Allow approving workflow actions.' },
  { key: 'delete_assignment_direct', label: 'Delete Assignments', help: 'Allow direct assignment deletion.' },
  { key: 'view_analytics', label: 'View Analytics', help: 'Allow access to analytics screens.' },
]

const PERSONNEL_TABS = [
  { key: 'employees', label: 'Employees' },
  { key: 'partners', label: 'Partners' },
]

const FILTERS_KEY = 'zenops.personnel.filters.v1'

export default function AdminPersonnel() {
  const { user: currentUser } = useAuth()
  const canSetPassword = userHasAnyRole(currentUser, ['ADMIN', 'HR'])
  const storedFilters = loadJson(FILTERS_KEY, {})
  const initialTab = storedFilters.activeTab === 'partners' ? 'partners' : 'employees'
  const [activeTab, setActiveTab] = useState(initialTab)

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [partnerReloadKey, setPartnerReloadKey] = useState(0)
  const [partners, setPartners] = useState([])
  const [partnerSummary, setPartnerSummary] = useState([])
  const [partnerLoading, setPartnerLoading] = useState(false)
  const [partnerError, setPartnerError] = useState(null)
  const [partnerNotice, setPartnerNotice] = useState(null)

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [partnerFiltersOpen, setPartnerFiltersOpen] = useState(false)

  const [partnerQuery, setPartnerQuery] = useState(storedFilters.partnerQuery || '')
  const [partnerStatusFilter, setPartnerStatusFilter] = useState(storedFilters.partnerStatusFilter || 'ALL')

  const [query, setQuery] = useState(storedFilters.query || '')
  const [roleFilter, setRoleFilter] = useState(storedFilters.roleFilter || 'ALL')
  const [statusFilter, setStatusFilter] = useState(storedFilters.statusFilter || 'ALL')
  const [sortBy, setSortBy] = useState(storedFilters.sortBy || 'workload')

  const [selectedAssignments, setSelectedAssignments] = useState([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState(null)
  const [unassignedAssignments, setUnassignedAssignments] = useState([])
  const [unassignedLoading, setUnassignedLoading] = useState(false)
  const [unassignedError, setUnassignedError] = useState(null)
  const [assigning, setAssigning] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    saveJson(FILTERS_KEY, {
      activeTab,
      query,
      roleFilter,
      statusFilter,
      sortBy,
      partnerQuery,
      partnerStatusFilter,
    })
  }, [activeTab, query, roleFilter, statusFilter, sortBy, partnerQuery, partnerStatusFilter])

  const [editForm, setEditForm] = useState({
    email: '',
    full_name: '',
    phone: '',
    role: 'EMPLOYEE',
    roles: ['EMPLOYEE'],
    is_active: true,
    password: '',
  })
  const [editOverrides, setEditOverrides] = useState({})

  const [form, setForm] = useState({
    email: '',
    full_name: '',
    phone: '',
    role: 'ASSISTANT_VALUER',
    roles: ['ASSISTANT_VALUER'],
    password: 'password',
    is_active: true,
  })

  const [partnerForm, setPartnerForm] = useState({
    display_name: '',
    legal_name: '',
    contact_name: '',
    email: '',
    phone: '',
    alternate_contact_name: '',
    alternate_contact_email: '',
    alternate_contact_phone: '',
    city: '',
    gstin: '',
    billing_address: '',
    billing_city: '',
    billing_state: '',
    billing_postal_code: '',
    service_lines: [],
    multi_floor_enabled: false,
    notes: '',
    password: 'password',
    is_active: true,
  })

  useEffect(() => {
    let cancelled = false

    async function loadUsers() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchUsers()
        if (cancelled) return
        setUsers(data)
        const employeeRows = data.filter((user) => !userHasRole(user, 'EXTERNAL_PARTNER'))
        setSelectedUserId((prev) => {
          if (prev && employeeRows.some((user) => user.id === prev)) return prev
          return employeeRows[0]?.id || null
        })
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load users'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadUsers()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    if (activeTab !== 'partners') return () => {}
    let cancelled = false

    async function loadPartners() {
      setPartnerLoading(true)
      setPartnerError(null)
      try {
        const [partnerData, summaryData] = await Promise.all([
          fetchExternalPartners().catch(() => []),
          fetchPartnerSummary().catch(() => []),
        ])
        if (cancelled) return
        setPartners(partnerData)
        setPartnerSummary(summaryData)
      } catch (err) {
        console.error(err)
        if (!cancelled) setPartnerError(toUserMessage(err, 'Failed to load partners'))
      } finally {
        if (!cancelled) setPartnerLoading(false)
      }
    }

    loadPartners()
    return () => {
      cancelled = true
    }
  }, [activeTab, partnerReloadKey])

  const employeeUsers = useMemo(() => users.filter((u) => !userHasRole(u, 'EXTERNAL_PARTNER')), [users])
  const partnerUsers = useMemo(() => users.filter((u) => userHasRole(u, 'EXTERNAL_PARTNER')), [users])

  const stats = useMemo(() => {
    const total = employeeUsers.length
    const active = employeeUsers.filter((u) => u.is_active).length
    const onLeave = employeeUsers.filter((u) => u.on_leave_today).length
    const overloaded = employeeUsers.filter((u) => u.overdue_assignments > 0).length
    const activeDays = employeeUsers.reduce((sum, u) => sum + (u.active_days_30d || 0), 0)
    const loginCount = employeeUsers.reduce((sum, u) => sum + (u.login_count_30d || 0), 0)
    return { total, active, onLeave, overloaded, activeDays, loginCount }
  }, [employeeUsers])

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLowerCase()
    const rows = employeeUsers
      .filter((user) => {
        if (roleFilter !== 'ALL' && !userHasRole(user, roleFilter)) return false
        if (statusFilter === 'ACTIVE' && !user.is_active) return false
        if (statusFilter === 'INACTIVE' && user.is_active) return false
        if (statusFilter === 'ON_LEAVE' && !user.on_leave_today) return false
        if (!term) return true
        return (
          (user.full_name || '').toLowerCase().includes(term)
          || (user.email || '').toLowerCase().includes(term)
          || (user.phone || '').toLowerCase().includes(term)
        )
      })

    rows.sort((a, b) => {
      if (sortBy === 'workload') {
        const aScore = (a.overdue_assignments || 0) * 2 + (a.open_assignments || 0)
        const bScore = (b.overdue_assignments || 0) * 2 + (b.open_assignments || 0)
        if (aScore !== bScore) return bScore - aScore
      }
      if (sortBy === 'recent_login') {
        const aTime = a.last_login_at ? new Date(a.last_login_at).getTime() : 0
        const bTime = b.last_login_at ? new Date(b.last_login_at).getTime() : 0
        if (aTime !== bTime) return bTime - aTime
      }
      return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')
    })

    return rows
  }, [employeeUsers, query, roleFilter, statusFilter, sortBy])

  const selectedUser = useMemo(
    () => employeeUsers.find((u) => u.id === selectedUserId) || null,
    [employeeUsers, selectedUserId],
  )

  const partnerStats = useMemo(() => {
    const total = partners.length
    const active = partners.filter((p) => p.is_active).length
    const unpaidTotal = partnerSummary.reduce((sum, row) => sum + Number(row.unpaid_total || 0), 0)
    return { total, active, unpaidTotal }
  }, [partners, partnerSummary])

  const filteredPartners = useMemo(() => {
    const term = partnerQuery.trim().toLowerCase()
    return partners.filter((partner) => {
      if (partnerStatusFilter === 'ACTIVE' && !partner.is_active) return false
      if (partnerStatusFilter === 'INACTIVE' && partner.is_active) return false
      if (!term) return true
      return (
        (partner.display_name || '').toLowerCase().includes(term)
        || (partner.contact_name || '').toLowerCase().includes(term)
        || (partner.email || '').toLowerCase().includes(term)
        || (partner.city || '').toLowerCase().includes(term)
      )
    })
  }, [partners, partnerQuery, partnerStatusFilter])

  useEffect(() => {
    if (!selectedUser) return
    const selectedRoles = getUserRoles(selectedUser)
    setEditForm({
      email: selectedUser.email || '',
      full_name: selectedUser.full_name || '',
      phone: selectedUser.phone || '',
      role: selectedUser.role || selectedRoles[0] || 'EMPLOYEE',
      roles: selectedRoles.length ? selectedRoles : ['EMPLOYEE'],
      is_active: Boolean(selectedUser.is_active),
      password: '',
    })
    const overrides = selectedUser.capability_overrides || {}
    const selections = {}
    CAPABILITY_OPTIONS.forEach((opt) => {
      if (overrides[opt.key] === true) selections[opt.key] = 'allow'
      else if (overrides[opt.key] === false) selections[opt.key] = 'deny'
      else selections[opt.key] = 'inherit'
    })
    setEditOverrides(selections)
  }, [selectedUser])

  useEffect(() => {
    setNotice(null)
  }, [selectedUserId])

  useEffect(() => {
    if (!selectedUser?.id) {
      setSelectedAssignments([])
      return
    }
    let cancelled = false

    async function loadSelectedQueue() {
      setQueueLoading(true)
      setQueueError(null)
      try {
        const data = await fetchAssignments({
          assigned_to_user_id: selectedUser.id,
          completion: 'PENDING',
          sort_by: 'created_at',
          sort_dir: 'desc',
          limit: 20,
        })
        if (!cancelled) setSelectedAssignments(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setQueueError(toUserMessage(err, 'Failed to load assignment queue'))
          setSelectedAssignments([])
        }
      } finally {
        if (!cancelled) setQueueLoading(false)
      }
    }

    loadSelectedQueue()
    return () => {
      cancelled = true
    }
  }, [selectedUser?.id, reloadKey])

  useEffect(() => {
    if (!selectedUser?.id) {
      setUnassignedAssignments([])
      setUnassignedError(null)
      return
    }
    let cancelled = false

    async function loadUnassignedQueue() {
      setUnassignedLoading(true)
      setUnassignedError(null)
      try {
        const data = await fetchAssignments({
          unassigned: true,
          completion: 'PENDING',
          sort_by: 'created_at',
          sort_dir: 'asc',
          limit: 12,
        })
        if (!cancelled) setUnassignedAssignments(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setUnassignedError(toUserMessage(err, 'Failed to load unassigned assignments'))
          setUnassignedAssignments([])
        }
      } finally {
        if (!cancelled) setUnassignedLoading(false)
      }
    }

    loadUnassignedQueue()
    return () => {
      cancelled = true
    }
  }, [selectedUser?.id, reloadKey])

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateEditForm(key, value) {
    setEditForm((prev) => ({ ...prev, [key]: value }))
  }

  function normalizeRolesValue(roles, fallbackRole) {
    if (Array.isArray(roles) && roles.length) return roles
    if (fallbackRole) return [fallbackRole]
    return ['EMPLOYEE']
  }

  function toggleRoleSelection(prevRoles, role) {
    const next = [...prevRoles]
    const index = next.indexOf(role)
    if (index >= 0) next.splice(index, 1)
    else next.push(role)
    return next
  }

  function applyRoleToggle(prev, role) {
    const baseRoles = normalizeRolesValue(prev.roles, prev.role)
    const nextRoles = toggleRoleSelection(baseRoles, role)
    const normalized = nextRoles.length ? nextRoles : normalizeRolesValue([], prev.role)
    const primary = normalized.includes(prev.role) ? prev.role : normalized[0]
    return { ...prev, roles: normalized, role: primary }
  }

  function setPrimaryRole(setter, role) {
    setter((prev) => {
      const baseRoles = normalizeRolesValue(prev.roles, prev.role)
      const nextRoles = baseRoles.includes(role) ? baseRoles : [role, ...baseRoles]
      return { ...prev, role, roles: nextRoles }
    })
  }

  function toggleFormRole(role) {
    setForm((prev) => applyRoleToggle(prev, role))
  }

  function toggleEditRole(role) {
    setEditForm((prev) => applyRoleToggle(prev, role))
  }

  async function handleCreateUser(e) {
    e.preventDefault()
    setError(null)
    try {
      const roles = normalizeRolesValue(form.roles, form.role)
      const payload = {
        email: form.email.trim().toLowerCase(),
        full_name: form.full_name.trim() || null,
        phone: form.phone.trim() || null,
        role: roles[0] || form.role,
        roles,
        password: form.password,
        is_active: form.is_active,
      }
      if (!payload.email) {
        setError('Email is required')
        return
      }
      await createUser(payload)
      setForm((prev) => ({ ...prev, email: '', full_name: '', phone: '' }))
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create user'))
    }
  }

  const partnerSummaryMap = useMemo(() => {
    const map = new Map()
    partnerSummary.forEach((row) => map.set(row.id, row))
    return map
  }, [partnerSummary])

  async function handleCreatePartner(e) {
    e.preventDefault()
    setPartnerError(null)
    setPartnerNotice(null)
    try {
      if (!partnerForm.display_name.trim()) {
        setPartnerError('Partner firm name is required')
        return
      }
      if (!partnerForm.email.trim()) {
        setPartnerError('Partner email is required for login')
        return
      }
      const partnerPayload = {
        display_name: partnerForm.display_name.trim(),
        legal_name: partnerForm.legal_name.trim() || null,
        contact_name: partnerForm.contact_name.trim() || null,
        email: partnerForm.email.trim().toLowerCase(),
        phone: partnerForm.phone.trim() || null,
        city: partnerForm.city.trim() || null,
        gstin: partnerForm.gstin.trim() || null,
        billing_address: partnerForm.billing_address.trim() || null,
        billing_city: partnerForm.billing_city.trim() || null,
        billing_state: partnerForm.billing_state.trim() || null,
        billing_postal_code: partnerForm.billing_postal_code.trim() || null,
        alternate_contact_name: partnerForm.alternate_contact_name.trim() || null,
        alternate_contact_email: partnerForm.alternate_contact_email.trim() || null,
        alternate_contact_phone: partnerForm.alternate_contact_phone.trim() || null,
        service_lines: partnerForm.service_lines?.length ? partnerForm.service_lines : [],
        multi_floor_enabled: Boolean(partnerForm.multi_floor_enabled),
        notes: partnerForm.notes.trim() || null,
        is_active: partnerForm.is_active,
      }
      const createdPartner = await createExternalPartner(partnerPayload)
      await createUser({
        email: partnerPayload.email,
        full_name: partnerPayload.contact_name || partnerPayload.display_name,
        phone: partnerPayload.phone,
        role: 'EXTERNAL_PARTNER',
        roles: ['EXTERNAL_PARTNER'],
        password: partnerForm.password || 'password',
        is_active: true,
        partner_id: createdPartner.id,
      })
      setPartnerForm({
        display_name: '',
        legal_name: '',
        contact_name: '',
        email: '',
        phone: '',
        alternate_contact_name: '',
        alternate_contact_email: '',
        alternate_contact_phone: '',
        city: '',
        gstin: '',
        billing_address: '',
        billing_city: '',
        billing_state: '',
        billing_postal_code: '',
        service_lines: [],
        multi_floor_enabled: false,
        notes: '',
        password: 'password',
        is_active: true,
      })
      setPartnerNotice('Partner firm and account created.')
      setPartnerReloadKey((k) => k + 1)
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setPartnerError(toUserMessage(err, 'Failed to create partner account'))
    }
  }

  async function handleTogglePartnerActive(partner) {
    try {
      const updated = await updateExternalPartner(partner.id, { is_active: !partner.is_active })
      setPartners((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    } catch (err) {
      console.error(err)
      setPartnerError(toUserMessage(err, 'Failed to update partner status'))
    }
  }

  async function handleTogglePartnerUser(user) {
    try {
      const updated = await updateUser(user.id, { is_active: !user.is_active })
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_active: updated.is_active } : u)))
    } catch (err) {
      console.error(err)
      setPartnerError(toUserMessage(err, 'Failed to update partner user status'))
    }
  }

  async function handleResetPartnerPassword(user) {
    if (!canSetPassword) return
    const nextPassword = window.prompt(`Reset password for ${user.email}. Enter new password:`) || ''
    if (!nextPassword.trim()) return
    try {
      await resetPassword(user.id, nextPassword.trim())
      setPartnerNotice('Password updated.')
    } catch (err) {
      console.error(err)
      setPartnerError(toUserMessage(err, 'Failed to reset password'))
    }
  }

  function togglePartnerServiceLine(line) {
    setPartnerForm((prev) => {
      const next = new Set(prev.service_lines || [])
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return { ...prev, service_lines: Array.from(next) }
    })
  }

  async function handleAssignToSelected(assignment) {
    if (!selectedUser || assigning) return
    setError(null)
    setNotice(null)
    setAssigning(true)
    try {
      const updated = await updateAssignment(assignment.id, { assigned_to_user_id: selectedUser.id })
      setUnassignedAssignments((prev) => prev.filter((item) => item.id !== assignment.id))
      setSelectedAssignments((prev) => [updated, ...prev.filter((item) => item.id !== assignment.id)])
      setNotice(`Assigned ${assignment.assignment_code} to ${selectedUser.full_name || selectedUser.email}.`)
      setReloadKey((k) => k + 1)
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 409 && detail?.message) {
        const confirmOverride = window.confirm(`${detail.message}. Override leave and assign anyway?`)
        if (confirmOverride) {
          try {
            const updated = await updateAssignment(assignment.id, {
              assigned_to_user_id: selectedUser.id,
              override_on_leave: true,
            })
            setUnassignedAssignments((prev) => prev.filter((item) => item.id !== assignment.id))
            setSelectedAssignments((prev) => [updated, ...prev.filter((item) => item.id !== assignment.id)])
            setNotice(`Assigned ${assignment.assignment_code} to ${selectedUser.full_name || selectedUser.email}.`)
            setReloadKey((k) => k + 1)
          } catch (overrideErr) {
            console.error(overrideErr)
            setError(toUserMessage(overrideErr, 'Failed to assign assignment'))
          }
        }
      } else {
        console.error(err)
        setError(toUserMessage(err, 'Failed to assign assignment'))
      }
    } finally {
      setAssigning(false)
    }
  }

  async function handleToggleActive(user) {
    try {
      await updateUser(user.id, { is_active: !user.is_active })
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_active: !u.is_active } : u)))
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update user status'))
    }
  }

  async function handleResetPassword(user) {
    const password = window.prompt(`Set new password for ${user.full_name || user.email}:`, 'password')
    if (!password) return
    try {
      const result = await resetPassword(user.id, password)
      if (result?.action_type) {
        setNotice('Password reset requires approval and has been requested.')
      } else {
        setNotice(`Password reset for ${user.email}.`)
      }
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to reset password'))
    }
  }

  async function handleSaveSelectedUser(e) {
    e.preventDefault()
    if (!selectedUser) return
    setError(null)
    setSaving(true)
    try {
      if (!editForm.email.trim()) {
        setError('Email is required.')
        setSaving(false)
        return
      }
      if (editForm.password.trim() && !canSetPassword) {
        setError('Only admins or HR can set passwords directly.')
        setSaving(false)
        return
      }
      if (editForm.password.trim() && editForm.password.trim().length < 8) {
        setError('Password must be at least 8 characters.')
        setSaving(false)
        return
      }
      const overridesPayload = Object.entries(editOverrides).reduce((acc, [key, mode]) => {
        if (mode === 'allow') acc[key] = true
        if (mode === 'deny') acc[key] = false
        return acc
      }, {})
      const roles = normalizeRolesValue(editForm.roles, editForm.role)
      const payload = {
        email: editForm.email.trim().toLowerCase(),
        full_name: editForm.full_name.trim() || null,
        phone: editForm.phone.trim() || null,
        role: roles[0] || editForm.role,
        roles,
        is_active: Boolean(editForm.is_active),
        capability_overrides: Object.keys(overridesPayload).length ? overridesPayload : null,
      }
      if (editForm.password.trim()) {
        payload.password = editForm.password.trim()
      }
      const updated = await updateUser(selectedUser.id, payload)
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      setEditForm((prev) => ({ ...prev, password: '' }))
      setReloadKey((k) => k + 1)
      setSaving(false)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update user'))
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Personnel"
        subtitle={activeTab === 'partners'
          ? 'Manage external partner firms, accounts, and activity.'
          : 'Manage roles, access, and workload visibility across the firm.'}
        actions={activeTab === 'partners'
          ? <Badge tone="info">{partnerStats.active} active</Badge>
          : <Badge tone="info">{stats.active} active</Badge>}
      />

      <Tabs tabs={PERSONNEL_TABS} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'employees' && error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}
      {activeTab === 'employees' && notice ? <div className="notice" style={{ marginBottom: '0.9rem' }}>{notice}</div> : null}
      {activeTab === 'partners' && partnerError ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{partnerError}</div> : null}
      {activeTab === 'partners' && partnerNotice ? <div className="notice" style={{ marginBottom: '0.9rem' }}>{partnerNotice}</div> : null}

      {activeTab === 'employees' ? (
        <>
          <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
            <Stat label="Total" value={stats.total} help="Total user accounts in the system." />
            <Stat label="Active" value={stats.active} tone="ok" help="Active accounts able to log in." />
            <Stat label="On Leave" value={stats.onLeave} tone="warn" help="Users currently on approved leave." />
            <Stat label="Overdue Load" value={stats.overloaded} tone="danger" help="Users with overdue assignments." />
          </div>

          <div className="grid cols-2" style={{ marginBottom: '0.9rem' }}>
            <Stat label="Active Days (30d)" value={stats.activeDays} tone="info" help="Unique login days in the last 30 days." />
            <Stat label="Logins (30d)" value={stats.loginCount} tone="accent" help="Login count in the last 30 days." />
          </div>
        </>
      ) : (
        <div className="grid cols-3" style={{ marginBottom: '0.9rem' }}>
          <Stat label="Partners" value={partnerStats.total} help="Total partner firms." />
          <Stat label="Active Partners" value={partnerStats.active} tone="ok" help="Active partner firms able to submit requests." />
          <Stat label="Outstanding" value={formatMoney(partnerStats.unpaidTotal)} tone="warn" help="Total unpaid invoice exposure across partners." />
        </div>
      )}

      {activeTab === 'employees' ? (
        <div className="split">
        <Card>
          <CardHeader
            title="Team Directory"
            subtitle="Roles, activity, and workload signals."
            action={<button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>Refresh</button>}
          />

          <div className="filter-shell">
            <div className="toolbar dense">
              <input
                className="grow"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, email, or phone"
              />
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip ${statusFilter === 'ACTIVE' ? 'active' : ''}`.trim()}
                  onClick={() => setStatusFilter(statusFilter === 'ACTIVE' ? 'ALL' : 'ACTIVE')}
                  aria-pressed={statusFilter === 'ACTIVE'}
                >
                  Active
                </button>
                <button
                  type="button"
                  className={`chip ${statusFilter === 'INACTIVE' ? 'active' : ''}`.trim()}
                  onClick={() => setStatusFilter(statusFilter === 'INACTIVE' ? 'ALL' : 'INACTIVE')}
                  aria-pressed={statusFilter === 'INACTIVE'}
                >
                  Inactive
                </button>
                <button
                  type="button"
                  className={`chip ${statusFilter === 'ON_LEAVE' ? 'active' : ''}`.trim()}
                  onClick={() => setStatusFilter(statusFilter === 'ON_LEAVE' ? 'ALL' : 'ON_LEAVE')}
                  aria-pressed={statusFilter === 'ON_LEAVE'}
                >
                  On Leave
                </button>
              </div>
              <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
                {filtersOpen ? 'Hide Filters' : 'Filters'}
              </button>
              <Badge tone="info">{filteredUsers.length} shown</Badge>
            </div>

            {filtersOpen ? (
              <div className="filter-panel">
                <div className="filter-grid">
                  <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                    <option value="ALL">All Roles</option>
                    {ROLES.map((role) => (
                      <option key={role} value={role}>{titleCase(role)}</option>
                    ))}
                  </select>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="ALL">All Statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="ON_LEAVE">On Leave</option>
                  </select>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="workload">Sort: Workload</option>
                    <option value="recent_login">Sort: Recent Login</option>
                    <option value="name">Sort: Name</option>
                  </select>
                </div>
              </div>
            ) : null}
          </div>

          {loading ? (
            <DataTable loading columns={10} rows={8} />
          ) : filteredUsers.length === 0 ? (
            <EmptyState>No users found for current filters.</EmptyState>
          ) : (
            <DataTable>
              <table className="personnel-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Roles</th>
                    <th>Active</th>
                    <th>Open</th>
                    <th>Overdue</th>
                    <th>Leave</th>
                    <th className="col-activity">Active Days (30d)</th>
                    <th className="col-logins">Logins (30d)</th>
                    <th className="col-last-login">Last Login</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} style={user.id === selectedUserId ? { outline: '2px solid rgba(91, 140, 255, 0.4)' } : undefined}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <strong>{user.full_name || 'No name'}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>{user.email}</span>
                        </div>
                      </td>
                      <td>
                        <span className="muted">{getUserRoles(user).join(' + ') || user.role}</span>
                      </td>
                      <td>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={user.is_active} onChange={() => handleToggleActive(user)} />
                          <span>{user.is_active ? 'Yes' : 'No'}</span>
                        </label>
                      </td>
                      <td>{user.open_assignments}</td>
                      <td>{user.overdue_assignments}</td>
                      <td>{user.on_leave_today ? <Badge tone="warn">On Leave</Badge> : '—'}</td>
                      <td className="col-activity">{user.active_days_30d ?? 0}</td>
                      <td className="col-logins">{user.login_count_30d ?? 0}</td>
                      <td className="col-last-login">{user.last_login_at ? formatDateTime(user.last_login_at) : '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" className="ghost" onClick={() => setSelectedUserId(user.id)}>Edit</button>
                        <button type="button" className="ghost row-reset-action" onClick={() => handleResetPassword(user)}>Reset</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          )}
        </Card>

        <div className="grid">
          <Card>
            <CardHeader
              title="User Snapshot"
              subtitle={selectedUser ? `Operational summary for ${selectedUser.full_name || selectedUser.email}` : 'Select a user to view workload signals'}
              action={selectedUser ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Badge tone={selectedUser.is_active ? 'ok' : 'danger'}>{selectedUser.is_active ? 'Active' : 'Inactive'}</Badge>
                  {selectedUser.on_leave_today ? <Badge tone="warn">On Leave</Badge> : null}
                </div>
              ) : null}
            />
            {!selectedUser ? (
              <EmptyState>Select a user to see workload signals and quick actions.</EmptyState>
            ) : (
              <>
                <div className="grid cols-2 tight-cols" style={{ marginBottom: '0.75rem' }}>
                  <div className="card tight">
                    <div className="kicker">Open</div>
                    <div className="stat-value">{selectedUser.open_assignments || 0}</div>
                  </div>
                  <div className="card tight">
                    <div className="kicker">Overdue</div>
                    <div className="stat-value" style={{ color: 'var(--danger)' }}>{selectedUser.overdue_assignments || 0}</div>
                  </div>
                  <div className="card tight">
                    <div className="kicker">Active Days (30d)</div>
                    <div className="stat-value">{selectedUser.active_days_30d || 0}</div>
                  </div>
                  <div className="card tight">
                    <div className="kicker">Logins (30d)</div>
                    <div className="stat-value">{selectedUser.login_count_30d || 0}</div>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 12, marginBottom: '0.6rem' }}>
                  Last login: {selectedUser.last_login_at ? formatDateTime(selectedUser.last_login_at) : '—'}
                </div>
                <div className="toolbar dense" style={{ marginBottom: 0 }}>
                  <button type="button" className="ghost" onClick={() => handleToggleActive(selectedUser)}>
                    {selectedUser.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  {canSetPassword ? (
                    <button type="button" className="ghost" onClick={() => handleResetPassword(selectedUser)}>
                      Reset Password
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Selected User Queue"
              subtitle={selectedUser ? `Current assignments for ${selectedUser.full_name || selectedUser.email}` : 'Select a user to inspect queue'}
              action={selectedUser ? <Badge tone="accent">{selectedAssignments.length} open</Badge> : null}
            />
            {!selectedUser ? (
              <EmptyState>Select a user from the table to inspect assignment queue.</EmptyState>
            ) : queueLoading ? (
              <div className="muted">Loading assignment queue…</div>
            ) : queueError ? (
              <div className="empty">{queueError}</div>
            ) : selectedAssignments.length === 0 ? (
              <EmptyState>No open assignments for this user.</EmptyState>
            ) : (
              <div className="list">
                {selectedAssignments.map((assignment) => (
                  <Link key={assignment.id} to={`/assignments/${assignment.id}`} className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <strong>{assignment.assignment_code}</strong>
                      <Badge tone={assignment.due_state === 'OVERDUE' ? 'danger' : assignment.due_state === 'DUE_SOON' ? 'warn' : 'ok'}>
                        {assignment.due_state || 'OK'}
                      </Badge>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {assignment.borrower_name || 'Borrower'} · {assignment.bank_name || assignment.valuer_client_name || assignment.case_type}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Unassigned Intake"
              subtitle={selectedUser ? 'Oldest unassigned assignments ready for allocation.' : 'Select a user to assign new work'}
              action={selectedUser ? <Badge tone="info">{unassignedAssignments.length} available</Badge> : null}
            />
            {!selectedUser ? (
              <EmptyState>Select a user to assign unallocated assignments.</EmptyState>
            ) : unassignedLoading ? (
              <div className="muted">Loading unassigned assignments…</div>
            ) : unassignedError ? (
              <div className="empty">{unassignedError}</div>
            ) : unassignedAssignments.length === 0 ? (
              <EmptyState>No unassigned assignments right now.</EmptyState>
            ) : (
              <div className="list">
                {unassignedAssignments.map((assignment) => (
                  <div key={assignment.id} className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <strong>{assignment.assignment_code}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {assignment.borrower_name || 'Borrower'} · {assignment.bank_name || assignment.valuer_client_name || assignment.case_type}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                        <Badge tone={assignment.due_state === 'OVERDUE' ? 'danger' : assignment.due_state === 'DUE_SOON' ? 'warn' : 'ok'}>
                          {assignment.due_state || 'OK'}
                        </Badge>
                        <button type="button" className="ghost" onClick={() => handleAssignToSelected(assignment)} disabled={assigning}>
                          Assign
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Edit User"
              subtitle={selectedUser ? `Editing ${selectedUser.full_name || selectedUser.email}` : 'Select a user to edit'}
            />
            {!selectedUser ? (
              <EmptyState>Select a user from the table to edit their profile.</EmptyState>
            ) : (
              <form className="grid" onSubmit={handleSaveSelectedUser}>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Email</span>
                  <input value={editForm.email} onChange={(e) => updateEditForm('email', e.target.value)} required />
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Full Name</span>
                  <input value={editForm.full_name} onChange={(e) => updateEditForm('full_name', e.target.value)} placeholder="Full name" />
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Phone</span>
                  <input value={editForm.phone} onChange={(e) => updateEditForm('phone', e.target.value)} placeholder="Optional" />
                </label>

                <div className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Roles</span>
                  <div className="grid cols-2" style={{ gap: 6 }}>
                    {ROLES.map((role) => {
                      const checked = normalizeRolesValue(editForm.roles, editForm.role).includes(role)
                      return (
                        <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEditRole(role)}
                          />
                          <span>{titleCase(role)}</span>
                        </label>
                      )
                    })}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>Multiple roles combine capabilities.</div>
                </div>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Primary Role</span>
                  <select
                    value={editForm.role}
                    onChange={(e) => setPrimaryRole(setEditForm, e.target.value)}
                  >
                    {normalizeRolesValue(editForm.roles, editForm.role).map((role) => (
                      <option key={role} value={role}>{titleCase(role)}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={editForm.is_active} onChange={(e) => updateEditForm('is_active', e.target.checked)} />
                  <span>Active</span>
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Set Password (Admin/HR)</span>
                  <input
                    type="password"
                    value={editForm.password}
                    onChange={(e) => updateEditForm('password', e.target.value)}
                    placeholder="Leave blank to keep current"
                    disabled={!canSetPassword}
                  />
                </label>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
                  <button type="button" className="secondary" onClick={() => handleResetPassword(selectedUser)}>
                    Reset Password
                  </button>
                </div>
              </form>
            )}
          </Card>

          <Card>
            <CardHeader
              title="RBAC Overrides"
              subtitle="Fine-tune access per employee. Overrides take precedence over role defaults."
            />
            {!selectedUser ? (
              <EmptyState>Select a user to configure overrides.</EmptyState>
            ) : (
              <div className="grid" style={{ gap: 12 }}>
                {CAPABILITY_OPTIONS.map((cap) => (
                  <label key={cap.key} className="grid" style={{ gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{cap.label}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{cap.help}</div>
                      </div>
                      <select
                        value={editOverrides[cap.key] || 'inherit'}
                        onChange={(e) => setEditOverrides((prev) => ({ ...prev, [cap.key]: e.target.value }))}
                      >
                        <option value="inherit">Inherit</option>
                        <option value="allow">Force Allow</option>
                        <option value="deny">Force Deny</option>
                      </select>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Create User"
              subtitle="Provision access with the right role from day one."
            />

            <form className="grid" onSubmit={handleCreateUser}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Email</span>
                <input type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} placeholder="name@zenops.local" />
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Full Name</span>
                <input value={form.full_name} onChange={(e) => updateForm('full_name', e.target.value)} placeholder="Full name" />
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Phone</span>
                <input value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} placeholder="Optional" />
              </label>

              <div className="grid" style={{ gap: 6 }}>
                <span className="kicker">Roles</span>
                <div className="grid cols-2" style={{ gap: 6 }}>
                  {ROLES.map((role) => {
                    const checked = normalizeRolesValue(form.roles, form.role).includes(role)
                    return (
                      <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFormRole(role)}
                        />
                        <span>{titleCase(role)}</span>
                      </label>
                    )
                  })}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>Multiple roles combine capabilities.</div>
              </div>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Primary Role</span>
                <select
                  value={form.role}
                  onChange={(e) => setPrimaryRole(setForm, e.target.value)}
                >
                  {normalizeRolesValue(form.roles, form.role).map((role) => (
                    <option key={role} value={role}>{titleCase(role)}</option>
                  ))}
                </select>
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Password</span>
                <input value={form.password} onChange={(e) => updateForm('password', e.target.value)} />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => updateForm('is_active', e.target.checked)} />
                <span>Active</span>
              </label>

              <button type="submit">Create User</button>
              <div className="muted" style={{ fontSize: 12 }}>
                Users can be deactivated later without losing audit history.
              </div>
            </form>
          </Card>
        </div>
        </div>
      ) : (
        <div className="grid" style={{ gap: '1rem' }}>
          <Card>
            <CardHeader
              title="Partner Firms"
              subtitle="External partner organizations and relationship metrics."
              action={<button type="button" className="secondary" onClick={() => setPartnerReloadKey((k) => k + 1)}>Refresh</button>}
            />
            <div className="filter-shell" style={{ marginBottom: '0.8rem' }}>
              <div className="toolbar dense">
                <input
                  className="grow"
                  value={partnerQuery}
                  onChange={(e) => setPartnerQuery(e.target.value)}
                  placeholder="Search firm, contact, email, city"
                />
                <div className="chip-row">
                  <button
                    type="button"
                    className={`chip ${partnerStatusFilter === 'ACTIVE' ? 'active' : ''}`.trim()}
                    onClick={() => setPartnerStatusFilter(partnerStatusFilter === 'ACTIVE' ? 'ALL' : 'ACTIVE')}
                    aria-pressed={partnerStatusFilter === 'ACTIVE'}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    className={`chip ${partnerStatusFilter === 'INACTIVE' ? 'active' : ''}`.trim()}
                    onClick={() => setPartnerStatusFilter(partnerStatusFilter === 'INACTIVE' ? 'ALL' : 'INACTIVE')}
                    aria-pressed={partnerStatusFilter === 'INACTIVE'}
                  >
                    Inactive
                  </button>
                </div>
                <button type="button" className="secondary" onClick={() => setPartnerFiltersOpen((open) => !open)}>
                  {partnerFiltersOpen ? 'Hide Filters' : 'Filters'}
                </button>
                <Badge tone="info">{filteredPartners.length} shown</Badge>
              </div>
              {partnerFiltersOpen ? (
                <div className="filter-panel">
                  <div className="filter-grid">
                    <select value={partnerStatusFilter} onChange={(e) => setPartnerStatusFilter(e.target.value)}>
                      <option value="ALL">All Statuses</option>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </div>
                </div>
              ) : null}
            </div>

            {partnerLoading ? (
              <DataTable loading columns={9} rows={6} />
            ) : filteredPartners.length === 0 ? (
              <EmptyState>No partner firms yet.</EmptyState>
            ) : (
              <DataTable>
                <table className="personnel-table">
                  <thead>
                    <tr>
                      <th>Firm</th>
                      <th>Contact</th>
                      <th>City</th>
                      <th>Active</th>
                      <th>Commissions</th>
                      <th>Converted</th>
                      <th>Outstanding</th>
                      <th>Last Activity</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPartners.map((partner) => {
                      const summary = partnerSummaryMap.get(partner.id)
                      return (
                        <tr key={partner.id}>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <strong>{partner.display_name}</strong>
                              <span className="muted" style={{ fontSize: 12 }}>{partner.email || '—'}</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span>{partner.contact_name || '—'}</span>
                              <span className="muted" style={{ fontSize: 12 }}>{partner.phone || '—'}</span>
                            </div>
                          </td>
                          <td>{partner.city || '—'}</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={Boolean(partner.is_active)}
                              onChange={() => handleTogglePartnerActive(partner)}
                            />
                          </td>
                          <td>{summary?.commission_count ?? 0}</td>
                          <td>{summary?.converted_count ?? 0}</td>
                          <td>{formatMoney(summary?.unpaid_total ?? 0)}</td>
                          <td>{formatDateTime(summary?.last_activity_at)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <Link className="nav-link" to={`/admin/partners/${partner.id}`}>Open</Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </DataTable>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Partner Accounts"
              subtitle="Login accounts tied to partner firms."
            />
            {loading ? (
              <DataTable loading columns={5} rows={5} />
            ) : partnerUsers.length === 0 ? (
              <EmptyState>No partner accounts yet.</EmptyState>
            ) : (
              <DataTable>
                <table className="personnel-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Firm</th>
                      <th>Active</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {partnerUsers.map((partnerUser) => {
                      const partner = partners.find((p) => p.id === partnerUser.partner_id)
                      return (
                        <tr key={partnerUser.id}>
                          <td>{partnerUser.full_name || '—'}</td>
                          <td>{partnerUser.email}</td>
                          <td>{partner?.display_name || '—'}</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={Boolean(partnerUser.is_active)}
                              onChange={() => handleTogglePartnerUser(partnerUser)}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {canSetPassword ? (
                              <button type="button" className="secondary" onClick={() => handleResetPartnerPassword(partnerUser)}>
                                Reset Password
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </DataTable>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Create Partner Account"
              subtitle="Add a partner firm and provision login access."
            />
            <form className="grid" onSubmit={handleCreatePartner}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Firm Name</span>
                <input value={partnerForm.display_name} onChange={(e) => setPartnerForm((prev) => ({ ...prev, display_name: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Legal Name</span>
                <input value={partnerForm.legal_name} onChange={(e) => setPartnerForm((prev) => ({ ...prev, legal_name: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Contact Name</span>
                <input value={partnerForm.contact_name} onChange={(e) => setPartnerForm((prev) => ({ ...prev, contact_name: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Email</span>
                <input type="email" value={partnerForm.email} onChange={(e) => setPartnerForm((prev) => ({ ...prev, email: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Phone</span>
                <input value={partnerForm.phone} onChange={(e) => setPartnerForm((prev) => ({ ...prev, phone: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Alternate Contact</span>
                <input value={partnerForm.alternate_contact_name} onChange={(e) => setPartnerForm((prev) => ({ ...prev, alternate_contact_name: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Alternate Email</span>
                <input type="email" value={partnerForm.alternate_contact_email} onChange={(e) => setPartnerForm((prev) => ({ ...prev, alternate_contact_email: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Alternate Phone</span>
                <input value={partnerForm.alternate_contact_phone} onChange={(e) => setPartnerForm((prev) => ({ ...prev, alternate_contact_phone: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">City</span>
                <input value={partnerForm.city} onChange={(e) => setPartnerForm((prev) => ({ ...prev, city: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">GSTIN</span>
                <input value={partnerForm.gstin} onChange={(e) => setPartnerForm((prev) => ({ ...prev, gstin: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Billing Address</span>
                <input value={partnerForm.billing_address} onChange={(e) => setPartnerForm((prev) => ({ ...prev, billing_address: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Billing City</span>
                <input value={partnerForm.billing_city} onChange={(e) => setPartnerForm((prev) => ({ ...prev, billing_city: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Billing State</span>
                <input value={partnerForm.billing_state} onChange={(e) => setPartnerForm((prev) => ({ ...prev, billing_state: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Billing Postal</span>
                <input value={partnerForm.billing_postal_code} onChange={(e) => setPartnerForm((prev) => ({ ...prev, billing_postal_code: e.target.value }))} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Service Lines</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {SERVICE_LINES.map((line) => (
                    <label key={line} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={(partnerForm.service_lines || []).includes(line)}
                        onChange={() => togglePartnerServiceLine(line)}
                      />
                      <span>{line}</span>
                    </label>
                  ))}
                </div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={partnerForm.multi_floor_enabled}
                  onChange={(e) => setPartnerForm((prev) => ({ ...prev, multi_floor_enabled: e.target.checked }))}
                />
                <span>Allow multi-floor entry</span>
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Internal Notes</span>
                <textarea value={partnerForm.notes} onChange={(e) => setPartnerForm((prev) => ({ ...prev, notes: e.target.value }))} rows={2} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Temp Password</span>
                <input value={partnerForm.password} onChange={(e) => setPartnerForm((prev) => ({ ...prev, password: e.target.value }))} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={partnerForm.is_active} onChange={(e) => setPartnerForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
                <span>Active</span>
              </label>
              <button type="submit">Create Partner</button>
            </form>
          </Card>
        </div>
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
