import React, { useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BottomSheet } from './components/Primitives'

const TAB_DESCRIPTIONS = {
  home: 'Daily cockpit and queue',
  assignments: 'Search and work items',
  create: 'Start or continue drafts',
  approvals: 'Review pending actions',
  invoices: 'Payments and balances',
  uploads: 'Checklist and evidence',
  notifications: 'Alerts and reminders',
  profile: 'Account and quick links',
}

function routeMatches(pathname, to) {
  if (to === '/m/home') return pathname === '/m' || pathname === '/m/home'
  return pathname === to || pathname.startsWith(`${to}/`)
}

function TabIcon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }

  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
        </svg>
      )
    case 'assignments':
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2.5" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      )
    case 'create':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'approvals':
      return (
        <svg {...common}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )
    case 'invoices':
      return (
        <svg {...common}>
          <path d="M7 4h10v16l-2-1.5L13 20l-2-1.5L9 20l-2-1.5L7 20Z" />
          <path d="M9.5 9h5M9.5 13h5" />
        </svg>
      )
    case 'uploads':
      return (
        <svg {...common}>
          <path d="M12 15V5" />
          <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
          <path d="M5 18.5h14" />
        </svg>
      )
    case 'notifications':
      return (
        <svg {...common}>
          <path d="M6.5 9a5.5 5.5 0 1 1 11 0c0 6 2.5 7 2.5 7h-16s2.5-1 2.5-7" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      )
    case 'profile':
      return (
        <svg {...common}>
          <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      )
  }
}

export default function MobileTabs({ tabs }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const safeTabs = Array.isArray(tabs) ? tabs : []

  const { visibleTabs, overflowTabs } = useMemo(() => {
    if (safeTabs.length <= 5) return { visibleTabs: safeTabs, overflowTabs: [] }
    return {
      visibleTabs: safeTabs.slice(0, 4),
      overflowTabs: safeTabs.slice(4),
    }
  }, [safeTabs])

  const count = Math.max(1, visibleTabs.length + (overflowTabs.length ? 1 : 0))
  const moreActive = overflowTabs.some((tab) => routeMatches(location.pathname, tab.to))

  return (
    <>
      <nav className="m-tabs" aria-label="Mobile navigation" style={{ '--m-tab-count': count }}>
        {visibleTabs.map((tab) => (
          <NavLink
            key={tab.key}
            to={tab.to}
            className={({ isActive }) => `m-tab-link ${isActive ? 'active' : ''}`.trim()}
          >
            <span className="m-tab-inner">
              <span className="m-tab-icon"><TabIcon name={tab.key} /></span>
              <span className="m-tab-label">{tab.label}</span>
            </span>
          </NavLink>
        ))}
        {overflowTabs.length ? (
          <button
            type="button"
            className={`m-tab-more ${moreActive || open ? 'active' : ''}`.trim()}
            onClick={() => setOpen(true)}
          >
            <span className="m-tab-inner">
              <span className="m-tab-icon"><TabIcon name="more" /></span>
              <span className="m-tab-label">More</span>
            </span>
          </button>
        ) : null}
      </nav>

      <BottomSheet open={open} title="More" onClose={() => setOpen(false)}>
        <div className="m-more-grid">
          {overflowTabs.map((tab) => (
            <NavLink
              key={tab.key}
              to={tab.to}
              className="m-more-link"
              onClick={() => setOpen(false)}
            >
              <div className="m-more-link-head">
                <span className="m-more-icon"><TabIcon name={tab.key} /></span>
                <strong>{tab.label}</strong>
              </div>
              <small>{TAB_DESCRIPTIONS[tab.key] || 'Open mobile section'}</small>
            </NavLink>
          ))}
        </div>
      </BottomSheet>
    </>
  )
}
