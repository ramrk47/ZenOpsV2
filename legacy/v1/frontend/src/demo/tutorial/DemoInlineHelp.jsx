import React from 'react'
import { Link } from 'react-router-dom'

import { useDemoTutorial } from './useDemoTutorial'

export default function DemoInlineHelp({ title, body, whyItMatters, className = '' }) {
  const { isEnabled, helpLabel, helpPath } = useDemoTutorial()
  if (!isEnabled) return null

  return (
    <div className={`demo-inline-help ${className}`.trim()}>
      <div className="demo-inline-help-kicker">Need help?</div>
      <strong>{title}</strong>
      <p>{body}</p>
      <small>{whyItMatters}</small>
      <Link className="nav-link ghost-link" to={helpPath}>{helpLabel}</Link>
    </div>
  )
}
