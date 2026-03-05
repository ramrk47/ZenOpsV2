import React from 'react'
import { NavLink } from 'react-router-dom'

export default function MobileTabs({ tabs }) {
  const count = Math.max(1, Array.isArray(tabs) ? tabs.length : 1)

  return (
    <nav className="m-tabs" aria-label="Mobile navigation" style={{ '--m-tab-count': count }}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.to}
          className={({ isActive }) => `m-tab-link ${isActive ? 'active' : ''}`.trim()}
        >
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
