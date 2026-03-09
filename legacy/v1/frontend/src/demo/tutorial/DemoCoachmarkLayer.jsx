import React, { useEffect, useMemo, useState } from 'react'

import { useDemoTutorial } from './useDemoTutorial'

function readTargetRect(selector) {
  if (!selector || typeof document === 'undefined') return null
  const element = document.querySelector(selector)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (!rect.width && !rect.height) return null
  return {
    top: Math.max(8, rect.top - 8),
    left: Math.max(8, rect.left - 8),
    width: rect.width + 16,
    height: rect.height + 16,
  }
}

export default function DemoCoachmarkLayer() {
  const {
    isEnabled,
    activeFlow,
    currentStep,
    currentStepIndex,
    progress,
    isCoachmarkOpen,
    routeReady,
    closeCoachmark,
    dismissTutorial,
    nextStep,
    previousStep,
    goToStep,
  } = useDemoTutorial()

  const [rect, setRect] = useState(null)
  const mobileSurface = currentStep?.route?.startsWith('/m/')

  useEffect(() => {
    if (!isCoachmarkOpen || !currentStep?.target) {
      setRect(null)
      return undefined
    }

    function updateRect() {
      const nextRect = readTargetRect(currentStep.target)
      setRect(nextRect)
      if (nextRect) {
        const element = document.querySelector(currentStep.target)
        element?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      }
    }

    updateRect()
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)
    const timeout = window.setTimeout(updateRect, 180)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [currentStep, isCoachmarkOpen])

  const statusLabel = useMemo(() => {
    if (!routeReady) return 'Open the highlighted screen to continue.'
    if (!rect) return 'The tutorial target is loading. You can still continue using the step instructions.'
    return 'The highlighted surface is the current step target.'
  }, [rect, routeReady])

  if (!isEnabled || !isCoachmarkOpen || !activeFlow || !currentStep) return null

  return (
    <div className="demo-coachmark-overlay" role="presentation">
      {rect ? (
        <div
          className="demo-coachmark-highlight"
          style={{
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
        />
      ) : null}

      <aside
        className={`demo-coachmark-card ${mobileSurface ? 'demo-coachmark-card--mobile' : ''}`.trim()}
        role="dialog"
        aria-modal="false"
        aria-labelledby="demo-coachmark-title"
      >
        <div className="demo-mission-kicker">{activeFlow.label}</div>
        <div className="demo-coachmark-progress">Step {currentStepIndex + 1} of {progress.total}</div>
        <h3 id="demo-coachmark-title">{currentStep.title}</h3>
        <div className="demo-coachmark-copy">
          <p><strong>What you are seeing</strong><br />{currentStep.explanation}</p>
          <p><strong>Why it matters</strong><br />{currentStep.whyItMatters}</p>
          <p><strong>Do this now</strong><br />{currentStep.actionText}</p>
          <p><strong>Expected result</strong><br />{currentStep.expectedResult}</p>
        </div>
        <div className="demo-coachmark-status">{statusLabel}</div>
        {!routeReady ? (
          <button type="button" className="nav-link ghost-link" onClick={() => goToStep(currentStepIndex)}>
            Open this step
          </button>
        ) : null}
        <div className="demo-coachmark-actions">
          <button type="button" className="nav-link ghost-link" onClick={previousStep} disabled={currentStepIndex === 0}>
            Back
          </button>
          <button type="button" className="nav-link ghost-link" onClick={closeCoachmark}>
            Pause
          </button>
          <button type="button" className="nav-link ghost-link" onClick={dismissTutorial}>
            Skip tour
          </button>
          <button type="button" className="nav-link" onClick={nextStep}>
            {currentStepIndex + 1 >= progress.total ? 'Finish' : 'Next'}
          </button>
        </div>
      </aside>
    </div>
  )
}
