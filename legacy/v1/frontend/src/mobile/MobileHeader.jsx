import React from 'react'
import { Link } from 'react-router-dom'

function ActionButton({ action, variant }) {
  if (!action) return null
  const className = `m-header-action m-header-action--${variant}`.trim()
  if (action.to) {
    return <Link className={className} to={action.to}>{action.label}</Link>
  }
  return (
    <button className={className} type="button" onClick={action.onClick}>
      {action.label}
    </button>
  )
}

export default function MobileHeader({ title, subtitle, primaryAction, secondaryAction }) {
  return (
    <header className="m-header">
      <div className="m-header-main">
        {subtitle ? <p className="m-header-kicker">{subtitle}</p> : null}
        <h1>{title}</h1>
        <div className="m-header-credit">by Not Alone Studios</div>
      </div>
      <div className="m-header-actions">
        <ActionButton action={secondaryAction} variant="secondary" />
        <ActionButton action={primaryAction} variant="primary" />
      </div>
    </header>
  )
}
