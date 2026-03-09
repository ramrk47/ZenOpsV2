import React from 'react'
import { Link } from 'react-router-dom'

import { useDemoTutorial } from './useDemoTutorial'

export default function DemoMissionPanel({ mobile = false, className = '' }) {
  const {
    isEnabled,
    policy,
    activeFlow,
    currentStep,
    currentStepIndex,
    progress,
    flowSummaries,
    shouldShowMissionPanel,
    helpPath,
    helpLabel,
    preferredFlowId,
    startFlow,
    resumeFlow,
    resetTutorial,
    goToStep,
  } = useDemoTutorial()

  if (!isEnabled || !shouldShowMissionPanel) return null

  const recommendedFlow = activeFlow || flowSummaries.find((flow) => flow.id === preferredFlowId) || flowSummaries[0]
  const panelClassName = `demo-mission-panel ${mobile ? 'demo-mission-panel--mobile' : ''} ${className}`.trim()

  return (
    <section className={panelClassName} data-tour-id="demo-mission-panel">
      <div className="demo-mission-panel-head">
        <div>
          <div className="demo-mission-kicker">{policy.academyLabel}</div>
          <h3>{recommendedFlow?.label || 'Guided Tour'}</h3>
          <p>
            {activeFlow
              ? 'Keep moving through the live workflow with one clear next action.'
              : 'Start a guided tour or jump into a role-specific workflow without guessing.'}
          </p>
        </div>
        <div className="demo-mission-progress-block">
          <strong>{progress.completed}/{progress.total || recommendedFlow?.stepCount || 0}</strong>
          <small>Steps complete</small>
        </div>
      </div>

      <div className="demo-mission-progress" aria-hidden="true">
        <span style={{ width: `${progress.percent}%` }} />
      </div>

      {activeFlow && currentStep ? (
        <div className="demo-mission-next-card">
          <div>
            <div className="demo-mission-next-label">Next step</div>
            <strong>{currentStep.title}</strong>
            <p>{currentStep.actionText}</p>
          </div>
          <button
            type="button"
            className="nav-link"
            data-tour-id="demo-mission-next"
            onClick={resumeFlow}
          >
            Continue step {currentStepIndex + 1}
          </button>
        </div>
      ) : (
        <div className="demo-mission-next-card">
          <div>
            <div className="demo-mission-next-label">Recommended path</div>
            <strong>{recommendedFlow?.label}</strong>
            <p>{recommendedFlow?.summary}</p>
          </div>
          <button
            type="button"
            className="nav-link"
            data-tour-id="demo-start-tour"
            onClick={() => startFlow(recommendedFlow?.id)}
          >
            Start {recommendedFlow?.duration || 'tour'}
          </button>
        </div>
      )}

      <div className="demo-mission-links">
        <Link className="nav-link ghost-link" to={helpPath}>{helpLabel}</Link>
        <button type="button" className="nav-link ghost-link" onClick={resetTutorial}>{policy.resetLabel}</button>
      </div>

      {activeFlow ? (
        <div className="demo-mission-step-list">
          {activeFlow.steps.map((step, index) => {
            const stateClass = index === currentStepIndex ? 'active' : index < progress.completed ? 'done' : ''
            return (
              <button
                key={step.id}
                type="button"
                className={`demo-mission-step ${stateClass}`.trim()}
                onClick={() => goToStep(index)}
              >
                <span>{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.expectedResult}</small>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="demo-mission-flow-pills">
          {flowSummaries.map((flow) => (
            <button key={flow.id} type="button" className="demo-flow-pill" onClick={() => startFlow(flow.id)}>
              <strong>{flow.shortLabel}</strong>
              <small>{flow.stepCount} steps</small>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
