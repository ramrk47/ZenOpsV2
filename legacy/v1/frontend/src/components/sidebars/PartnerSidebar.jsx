import React, { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import BubbleStrip from '../ui/BubbleStrip'
import { fetchPartnerAssignments, fetchPartnerRequests, fetchPartnerProfile, fetchPartnerNotificationUnreadCount } from '../../api/partner'

export default function PartnerSidebar() {
  const { user, logout } = useAuth()
  const [partnerName, setPartnerName] = useState('')
  const [compactUi, setCompactUi] = useState(() => {
    try {
      return localStorage.getItem('zenops:compact-ui') === 'true'
    } catch (err) {
      return false
    }
  })
  const [bubbles, setBubbles] = useState({
    updates: 0,
    docs: 0,
    payments: 0,
  })
  const [bubbleError, setBubbleError] = useState(null)

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
    fetchPartnerProfile()
      .then((data) => {
        if (!cancelled) setPartnerName(data?.display_name || '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function refreshBubbles() {
      try {
        const [notificationsSummary, requests, assignments] = await Promise.all([
          fetchPartnerNotificationUnreadCount().catch(() => ({ total: 0, by_type: {} })),
          fetchPartnerRequests({ status: 'OPEN' }).catch(() => []),
          fetchPartnerAssignments().catch(() => []),
        ])

        if (cancelled) return
        const pendingDocs = requests.filter((r) => ['DOC_REQUEST', 'INFO_REQUEST'].includes(r.request_type)).length
        const paymentPending = assignments.filter((a) => ['REQUESTED', 'PROOF_SUBMITTED'].includes(a.payment_status)).length

        setBubbles({
          updates: notificationsSummary?.total || 0,
          docs: pendingDocs,
          payments: paymentPending,
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
      key: 'updates',
      label: 'Updates',
      icon: '🔔',
      count: bubbles.updates,
      to: '/partner/notifications',
      enabled: true,
      tooltip: `Unread updates: ${bubbles.updates}`,
    },
    {
      key: 'docs',
      label: 'Doc Requests',
      icon: '📎',
      count: bubbles.docs,
      to: '/partner/requests?filter=docs',
      enabled: true,
      tooltip: `Document requests pending: ${bubbles.docs}`,
    },
    {
      key: 'payments',
      label: 'Payments',
      icon: '💸',
      count: bubbles.payments,
      to: '/partner/payments?filter=pending',
      enabled: true,
      tooltip: `Payments awaiting verification: ${bubbles.payments}`,
    },
  ]), [bubbles])

  const links = [
    { to: '/partner/requests/new', label: 'New Request' },
    { to: '/partner/requests', label: 'My Requests' },
    { to: '/partner/requests?filter=docs', label: 'Documents' },
    { to: '/partner/payments', label: 'Payments' },
    { to: '/partner/notifications', label: 'Notifications' },
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
          <div className="nav-title">Partner Portal</div>
          {links.map(renderLink)}
        </div>
      </div>

      <div className="nav-footer">
        <div style={{ fontWeight: 600 }}>{partnerName || user?.full_name || 'External Partner'}</div>
        <div className="muted" style={{ marginTop: 2 }}>{user?.email}</div>
        <div className="muted" style={{ marginTop: 2 }}>External Partner</div>
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
