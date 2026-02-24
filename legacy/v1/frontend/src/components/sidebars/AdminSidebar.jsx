import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import BubbleStrip from '../ui/BubbleStrip'
import { fetchNotificationUnreadCount } from '../../api/notifications'
import { fetchApprovalsInboxCount } from '../../api/approvals'
import { fetchAssignmentSummary } from '../../api/assignments'
import {
  canManageCompanyAccounts,
  canManageMasterData,
  canManageUsers,
  canSeeAdmin,
  hasCapability,
  getUserRoles,
} from '../../utils/rbac'

function NavGroup({ id, label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(`zenops:nav:${id}`)
      return stored !== null ? stored === 'true' : defaultOpen
    } catch { return defaultOpen }
  })

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      try { localStorage.setItem(`zenops:nav:${id}`, String(next)) } catch {}
      return next
    })
  }, [id])

  return (
    <div className="nav-section">
      <div className="nav-group-header" onClick={toggle}>
        <div className="nav-title">{label}</div>
        <span className={`nav-group-chevron ${open ? 'open' : ''}`}>&#9654;</span>
      </div>
      <div className={`nav-group-items ${open ? 'open' : ''}`}>
        <div>{children}</div>
      </div>
    </div>
  )
}

export default function AdminSidebar() {
  const { user, capabilities, logout } = useAuth()
  if (!user) return null

  const [compactUi, setCompactUi] = useState(() => {
    try {
      return localStorage.getItem('zenops:compact-ui') === 'true'
    } catch (err) {
      return false
    }
  })
  const [bubbles, setBubbles] = useState({
    notifications: 0,
    approvals: 0,
    overdue: 0,
    unpaid: 0,
  })
  const [bubbleError, setBubbleError] = useState(null)

  const canApprove = hasCapability(capabilities, 'approve_actions')
  const showMasterData = canManageMasterData(capabilities)
  const showCompanyAccounts = canManageCompanyAccounts(capabilities)
  const canViewAnalytics = hasCapability(capabilities, 'view_analytics')
  const roleLabel = getUserRoles(user).join(' + ') || user?.role

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('compact-ui', compactUi)
    try {
      localStorage.setItem('zenops:compact-ui', compactUi ? 'true' : 'false')
    } catch (err) {
      // ignore storage failures
    }
  }, [compactUi])

  useEffect(() => {
    let cancelled = false

    async function refreshBubbles() {
      try {
        const [notificationsSummary, approvalsCount, summary] = await Promise.all([
          fetchNotificationUnreadCount().catch(() => ({ total: 0, by_type: {} })),
          canApprove ? fetchApprovalsInboxCount().catch(() => ({ pending: 0 })) : Promise.resolve({ pending: 0 }),
          fetchAssignmentSummary().catch(() => null),
        ])
        if (cancelled) return
        setBubbles({
          notifications: notificationsSummary?.total || 0,
          approvals: approvalsCount?.pending || 0,
          overdue: summary?.overdue || 0,
          unpaid: summary?.unpaid || 0,
        })
        setBubbleError(null)
      } catch (err) {
        console.error(err)
        if (!cancelled) setBubbleError('Failed to load bubble counts')
      }
    }

    refreshBubbles()
    const interval = window.setInterval(refreshBubbles, 60000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [canApprove])

  const bubbleItems = useMemo(() => ([
    {
      key: 'notifications',
      label: 'Notifications',
      icon: '🔔',
      count: bubbles.notifications,
      to: '/notifications',
      enabled: true,
      tooltip: `Unread notifications: ${bubbles.notifications}`,
    },
    {
      key: 'approvals',
      label: 'Approvals',
      icon: '📝',
      count: bubbles.approvals,
      to: '/admin/approvals',
      enabled: canApprove,
      tooltip: canApprove ? `Approvals pending: ${bubbles.approvals}` : 'Not available for your role',
    },
    {
      key: 'overdue',
      label: 'Overdue',
      icon: '⏱️',
      count: bubbles.overdue,
      to: '/assignments?due=OVERDUE',
      enabled: true,
      tooltip: `Overdue assignments: ${bubbles.overdue}`,
    },
    {
      key: 'payments',
      label: 'Payments',
      icon: '💸',
      count: bubbles.unpaid,
      to: '/invoices?unpaid=true',
      enabled: hasCapability(capabilities, 'view_invoices') || hasCapability(capabilities, 'view_all_assignments'),
      tooltip: `Payments pending: ${bubbles.unpaid}`,
    },
  ]), [bubbles, capabilities, canApprove])

  const canCreateAssignment = hasCapability(capabilities, 'create_assignment')

  function renderLink(link) {
    return (
      <NavLink
        key={link.to}
        to={link.to}
        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`.trim()}
      >
        {link.label}
      </NavLink>
    )
  }

  const workspaceLinks = [
    { to: '/account', label: 'My Day', enabled: true },
    { to: '/assignments', label: 'Assignments', enabled: true },
    { to: '/requests', label: 'Requests', enabled: true },
    { to: '/calendar', label: 'Calendar', enabled: true },
    {
      to: '/invoices',
      label: 'Invoices',
      enabled: hasCapability(capabilities, 'view_invoices') || hasCapability(capabilities, 'view_all_assignments'),
    },
    { to: '/notifications', label: 'Notifications', enabled: true },
  ]

  const opsLinks = [
    { to: '/admin/dashboard', label: 'Control Tower', enabled: canSeeAdmin(capabilities) },
    { to: '/admin/open-queue', label: 'Open Queue', enabled: canSeeAdmin(capabilities) },
    { to: '/admin/workload', label: 'Workload', enabled: canSeeAdmin(capabilities) },
    { to: '/admin/analytics', label: 'Analytics', enabled: canViewAnalytics },
  ].filter((l) => l.enabled)

  const reviewLinks = [
    { to: '/admin/approvals', label: 'Approvals', enabled: canApprove },
    { to: '/admin/activity', label: 'Activity', enabled: canSeeAdmin(capabilities) },
    { to: '/admin/billing-monitor', label: 'Billing Monitor', enabled: canSeeAdmin(capabilities) },
    { to: '/admin/notification-deliveries', label: 'Email Deliveries', enabled: canSeeAdmin(capabilities) },
    { to: '/admin/attendance', label: 'Attendance', enabled: canSeeAdmin(capabilities) },
  ].filter((l) => l.enabled)

  const canViewPayroll = hasCapability(capabilities, 'view_payroll') ||
                         getUserRoles(user).includes('FINANCE') ||
                         getUserRoles(user).includes('ADMIN')

  const payrollLinks = [
    { to: '/admin/payroll', label: 'Payroll Runs', enabled: canViewPayroll },
    { to: '/admin/payroll/employees', label: 'Employees', enabled: canViewPayroll },
    { to: '/admin/payroll/reports', label: 'Reports', enabled: canViewPayroll },
  ].filter((l) => l.enabled)

  const configLinks = [
    { to: '/admin/support', label: 'Support Inbox', enabled: canSeeAdmin(capabilities) },
    { to: '/admin/system-config', label: 'System Config', enabled: canSeeAdmin(capabilities) },
    { to: '/admin/partner-requests', label: 'Partner Requests', enabled: canSeeAdmin(capabilities) },
    { to: '/admin/personnel', label: 'Personnel', enabled: canManageUsers(capabilities) },
    { to: '/admin/masterdata', label: 'Master Data', enabled: showMasterData },
    { to: '/admin/company', label: 'Company Accts', enabled: showCompanyAccounts },
    { to: '/admin/backups', label: 'Backups', enabled: canSeeAdmin(capabilities) },
  ].filter((l) => l.enabled)

  return (
    <>
      <div className="nav-scroll">
        <div className="app-brand">Zen Ops</div>

        <div className="nav-section action-dock">
          <div className="nav-title">Action Dock</div>
          <BubbleStrip items={bubbleItems} />
          {bubbleError ? <div className="muted nav-error">{bubbleError}</div> : null}
        </div>

        <NavGroup id="workspace" label="Workspace" defaultOpen>
          {workspaceLinks.filter((link) => link.enabled !== false).map(renderLink)}
          {canCreateAssignment ? (
            <NavLink
              to="/assignments/new"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`.trim()}
            >
              New Assignment
            </NavLink>
          ) : null}
        </NavGroup>

        {opsLinks.length > 0 && (
          <NavGroup id="ops" label="Operations" defaultOpen>
            {opsLinks.map(renderLink)}
          </NavGroup>
        )}

        {payrollLinks.length > 0 && (
          <NavGroup id="payroll" label="Payroll">
            {payrollLinks.map(renderLink)}
          </NavGroup>
        )}

        {reviewLinks.length > 0 && (
          <NavGroup id="review" label="Review & Audit">
            {reviewLinks.map(renderLink)}
          </NavGroup>
        )}

        {configLinks.length > 0 && (
          <NavGroup id="config" label="Configuration">
            {configLinks.map(renderLink)}
          </NavGroup>
        )}
      </div>

      <div className="nav-footer">
        <div style={{ fontWeight: 600 }}>{user.full_name || 'Zen Ops User'}</div>
        <div className="muted" style={{ marginTop: 2 }}>{user.email}</div>
        <div className="muted" style={{ marginTop: 2 }}>{roleLabel}</div>
        <label className="nav-toggle">
          <input
            type="checkbox"
            checked={compactUi}
            onChange={(e) => setCompactUi(e.target.checked)}
          />
          <span>Compact UI</span>
        </label>
        <div style={{ marginTop: 10 }}>
          <button className="secondary" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </div>
    </>
  )
}
