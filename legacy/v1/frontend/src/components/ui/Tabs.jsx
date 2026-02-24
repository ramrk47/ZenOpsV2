import React from 'react'

export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`tab-button ${active === tab.key ? 'active' : ''}`.trim()}
          onClick={() => onChange(tab.key)}
          title={tab.title}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
