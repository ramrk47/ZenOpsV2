import React from 'react'

export default function PageHeader({ title, subtitle, actions, eyebrow, className = '' }) {
  return (
    <div className={`page-header ${className}`.trim()}>
      <div className="page-header-copy">
        {eyebrow ? <div className="page-header-eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title">{title}</h1>
        {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </div>
  )
}
