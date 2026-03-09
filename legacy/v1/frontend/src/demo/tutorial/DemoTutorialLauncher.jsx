import React from 'react'
import { Link } from 'react-router-dom'

import { useDemoTutorial } from './useDemoTutorial'

export default function DemoTutorialLauncher({ mobile = false, className = '' }) {
  const {
    isEnabled,
    policy,
    activeFlow,
    shouldShowLauncher,
    hasTutorialState,
    helpPath,
    helpLabel,
    openTutorialModal,
    resumeFlow,
    resetTutorial,
  } = useDemoTutorial()

  if (!isEnabled || !shouldShowLauncher) return null

  const actionLabel = activeFlow ? policy.resumeLabel : policy.startLabel

  return (
    <section className={`tutorial-launcher ${mobile ? 'tutorial-launcher--mobile' : ''} ${className}`.trim()}>
      <div className="tutorial-launcher-copy">
        <div className="tutorial-launcher-kicker">{policy.launcherLabel}</div>
        <strong>{policy.launcherTitle}</strong>
        <p>{policy.launcherSummary}</p>
      </div>

      <div className="tutorial-launcher-actions">
        <button type="button" className="nav-link" onClick={() => (activeFlow ? resumeFlow() : openTutorialModal())}>
          {actionLabel}
        </button>
        <Link className="nav-link ghost-link" to={helpPath}>{helpLabel}</Link>
        {hasTutorialState ? (
          <button type="button" className="nav-link ghost-link" onClick={resetTutorial}>
            {policy.resetLabel}
          </button>
        ) : null}
      </div>
    </section>
  )
}
