import React, { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fetchAssignments, fetchAssignmentSummary } from '../api/assignments'
import { fetchNotificationUnreadCount } from '../api/notifications'
import { fetchApprovalsInboxCount } from '../api/approvals'
import { fetchLeaveInbox } from '../api/leave'
import { fetchMyTasks } from '../api/tasks'
import {
  canManageCompanyAccounts,
  canManageMasterData,
  canManageUsers,
  canSeeAdmin,
  hasCapability,
  getUserRoles,
  userHasAnyRole,
} from '../utils/rbac'

export default function Navbar() {
  const { user, capabilities, logout } = useAuth()
  if (!user) return null

  const navigate = useNavigate()
  const [compactUi, setCompactUi] = useState(() => {
    try {
      return localStorage.getItem('zenops:compact-ui') === 'true'
    } catch (err) {
      return false
    }
  })
  const [bubbles, setBubbles] = useState({
    notifications: 0,
    myOpen: 0,
    myOverdue: 0,
    myTasks: 0,
    approvals: 0,
    unpaid: 0,
    leave: 0,
  })
  const [bubbleError, setBubbleError] = useState(null)

  const staff = canSeeAdmin(capabilities)
  const canApproveLeave = userHasAnyRole(user, ['ADMIN', 'HR'])
  const canApprove = hasCapability(capabilities, 'approve_actions')
  const canCreateAssignment = hasCapability(capabilities, 'create_assignment')
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
        const now = new Date()
        const start = new Date(now)
        start.setHours(0, 0, 0, 0)
        const end = new Date(now)
        end.setHours(23, 59, 59, 999)

        const [
          notificationsSummary,
          myAssignments,
          myTasks,
          approvalsCount,
          summary,
          leaveInbox,
        ] = await Promise.all([
          fetchNotificationUnreadCount().catch(() => ({ total: 0, by_type: {} })),
          fetchAssignments({ mine: true, completion: 'PENDING' }).catch(() => []),
          fetchMyTasks({ include_done: false, limit: 200 }).catch(() => []),
          canApprove ? fetchApprovalsInboxCount().catch(() => ({ pending: 0 })) : Promise.resolve({ pending: 0 }),
          staff ? fetchAssignmentSummary().catch(() => null) : Promise.resolve(null),
          canApproveLeave ? fetchLeaveInbox().catch(() => []) : Promise.resolve([]),
        ])

        if (cancelled) return
        const unread = notificationsSummary?.total || 0
        const overdueAssignments = myAssignments.filter((a) => a.due_state === 'OVERDUE').length
        const nowTs = Date.now()
        const overdueTasks = myTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < nowTs).length
        const dueSoonTasks = myTasks.filter((t) => {
          if (!t.due_at) return false
          const due = new Date(t.due_at).getTime()
          return due >= nowTs && due - nowTs <= 24 * 60 * 60 * 1000
        }).length
        setBubbles({
          notifications: unread,
          myOpen: myAssignments.length,
          myOverdue: overdueAssignments,
          myTasks: dueSoonTasks + overdueTasks,
          approvals: approvalsCount?.pending || 0,
          unpaid: summary?.unpaid || 0,
          leave: canApproveLeave ? leaveInbox.filter((l) => l.status === 'PENDING').length : 0,
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
  }, [staff, canApprove, canApproveLeave])

  const bubbleItems = useMemo(() => {
    const items = [
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
        key: 'myAssignments',
        label: 'My Assignments',
        icon: '🧾',
        count: bubbles.myOpen,
        to: '/assignments?mine=true&completion=PENDING',
        enabled: true,
        tooltip: `My open assignments: ${bubbles.myOpen}`,
      },
      {
        key: 'myTasks',
        label: 'My Tasks',
        icon: '✅',
        count: bubbles.myTasks,
        to: '/account#tasks',
        enabled: true,
        tooltip: `Tasks due soon or overdue: ${bubbles.myTasks}`,
      },
    ]

    if (canApprove) {
      items.push(
        {
          key: 'approvals',
          label: 'Approvals',
          icon: '📝',
          count: bubbles.approvals,
          to: '/admin/approvals',
          enabled: true,
          tooltip: `Approvals pending: ${bubbles.approvals}`,
        },
      )
    }
    if (staff) {
      items.push(
        {
          key: 'payments',
          label: 'Payments',
          icon: '💸',
          count: bubbles.unpaid,
          to: '/invoices',
          enabled: hasCapability(capabilities, 'view_invoices') || hasCapability(capabilities, 'view_all_assignments'),
          tooltip: hasCapability(capabilities, 'view_invoices') || hasCapability(capabilities, 'view_all_assignments')
            ? `Org unpaid: ${bubbles.unpaid}`
            : 'Not available for your role',
        },
      )
    }
    if (canApproveLeave) {
      items.push(
        {
          key: 'leave',
          label: 'Leave',
          icon: '🧑‍💼',
          count: bubbles.leave,
          to: '/requests?tab=leave',
          enabled: true,
          tooltip: `Leave requests pending: ${bubbles.leave}`,
        },
      )
    }
    return items
  }, [bubbles, staff, capabilities, canApprove, canApproveLeave])

  const employeeLinks = [
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

  const adminLinks = [
    { to: '/admin/dashboard', label: 'Control Tower', enabled: staff },
    { to: '/admin/open-queue', label: 'Open Queue', enabled: staff },
    { to: '/admin/workload', label: 'Workload', enabled: staff },
    { to: '/admin/analytics', label: 'Analytics', enabled: canViewAnalytics },
    { to: '/admin/approvals', label: 'Approvals', enabled: canApprove },
    { to: '/admin/activity', label: 'Activity', enabled: staff },
    { to: '/admin/personnel', label: 'Personnel', enabled: canManageUsers(capabilities) },
    { to: '/admin/masterdata', label: 'Master Data', enabled: showMasterData },
    { to: '/admin/company', label: 'Company Accts', enabled: showCompanyAccounts },
    { to: '/admin/backups', label: 'Backups', enabled: staff },
  ]

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

  return (
    <>
      <div className="nav-scroll">
        <div className="app-brand">Zen Ops</div>

        <div className="nav-bubbles">
          {bubbleItems.map((bubble) => (
            <button
              key={bubble.key}
              type="button"
              className={`bubble ${bubble.enabled ? '' : 'disabled'}`.trim()}
              onClick={() => {
                if (!bubble.enabled) return
                navigate(bubble.to)
              }}
              title={bubble.tooltip}
              disabled={!bubble.enabled}
            >
              <span className="bubble-icon">{bubble.icon}</span>
              {bubble.count > 0 ? <span className="bubble-badge">{bubble.count}</span> : null}
            </button>
          ))}
          {bubbleError ? <div className="muted" style={{ fontSize: 11 }}>{bubbleError}</div> : null}
        </div>

        <div className="nav-section">
          <div className="nav-title">Workspace</div>
          {employeeLinks.filter((link) => link.enabled !== false).map(renderLink)}
          {canCreateAssignment ? (
            <NavLink
              to="/assignments/new"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`.trim()}
            >
              New Assignment
            </NavLink>
          ) : null}
        </div>

        {staff ? (
          <div className="nav-section">
            <div className="nav-title">Admin</div>
            {adminLinks.filter((link) => link.enabled).map(renderLink)}
          </div>
        ) : null}
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
