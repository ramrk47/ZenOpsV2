import React from 'react'
import { Link } from 'react-router-dom'

function ActionButton({ action }) {
  if (!action) return null
  if (action.to) {
    return <Link className="m-header-action" to={action.to}>{action.label}</Link>
  }
  return (
    <button className="m-header-action" type="button" onClick={action.onClick}>
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
      </div>
      <div className="m-header-actions">
        <ActionButton action={secondaryAction} />
        <ActionButton action={primaryAction} />
      </div>
    </header>
  )
}
