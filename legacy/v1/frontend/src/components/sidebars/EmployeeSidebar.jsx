import React, { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import BubbleStrip from '../ui/BubbleStrip'
import { fetchAssignments } from '../../api/assignments'
import { fetchNotificationUnreadCount } from '../../api/notifications'
import { fetchMyTasks } from '../../api/tasks'
import { getUserRoles, hasCapability } from '../../utils/rbac'

export default function EmployeeSidebar() {
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
    overdueAssignments: 0,
    tasksDue: 0,
  })
  const [bubbleError, setBubbleError] = useState(null)
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
        const endOfDay = new Date(now)
        endOfDay.setHours(23, 59, 59, 999)
        const endOfDayTs = endOfDay.getTime()

        const [notificationsSummary, myAssignments, myTasks] = await Promise.all([
          fetchNotificationUnreadCount().catch(() => ({ total: 0, by_type: {} })),
          fetchAssignments({ mine: true, completion: 'PENDING' }).catch(() => []),
          fetchMyTasks({ include_done: false, limit: 200 }).catch(() => []),
        ])

        if (cancelled) return
        const overdueAssignments = myAssignments.filter((a) => a.due_state === 'OVERDUE').length
        const tasksDueToday = myTasks.filter((t) => {
          if (!t.due_at) return false
          const due = new Date(t.due_at).getTime()
          return due <= endOfDayTs
        }).length

        setBubbles({
          notifications: notificationsSummary?.total || 0,
          overdueAssignments,
          tasksDue: tasksDueToday,
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
  }, [])

  const bubbleItems = useMemo(() => ([
    {
      key: 'tasks',
      label: 'Tasks Due Today',
      icon: '✅',
      count: bubbles.tasksDue,
      to: '/account#tasks',
      enabled: true,
      tooltip: `Tasks due today: ${bubbles.tasksDue}`,
    },
    {
      key: 'overdue',
      label: 'Overdue Assignments',
      icon: '⏱️',
      count: bubbles.overdueAssignments,
      to: '/assignments?mine=true&due=OVERDUE',
      enabled: true,
      tooltip: `Overdue assignments: ${bubbles.overdueAssignments}`,
    },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: '🔔',
      count: bubbles.notifications,
      to: '/notifications',
      enabled: true,
      tooltip: `Unread notifications: ${bubbles.notifications}`,
    },
  ]), [bubbles])

  const canCreateAssignment = hasCapability(capabilities, 'create_assignment')

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

        <div className="nav-title">Action Dock</div>
        <BubbleStrip items={bubbleItems} />
        {bubbleError ? <div className="muted" style={{ fontSize: 11 }}>{bubbleError}</div> : null}

        <div className="nav-section">
          <div className="nav-title">Workspace</div>
          {workspaceLinks.filter((link) => link.enabled !== false).map(renderLink)}
          {canCreateAssignment ? (
            <NavLink
              to="/assignments/new"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`.trim()}
            >
              New Assignment
            </NavLink>
          ) : null}
        </div>
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
