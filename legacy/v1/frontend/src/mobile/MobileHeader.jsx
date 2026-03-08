import React from 'react'
import { Link } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'

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
        <BrandLogo variant="mobile" className="m-brand-logo" />
        {subtitle ? <p className="m-header-kicker">{subtitle}</p> : null}
        <h1>{title}</h1>
      </div>
      <div className="m-header-actions">
        <ActionButton action={secondaryAction} variant="secondary" />
        <ActionButton action={primaryAction} variant="primary" />
      </div>
    </header>
  )
}
