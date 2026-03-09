import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useDemoTutorial } from './useDemoTutorial'

export default function DemoOnboardingModal() {
  const {
    isEnabled,
    policy,
    isModalOpen,
    flowSummaries,
    selectedFlowId,
    setSelectedFlowId,
    helpPath,
    helpLabel,
    startFlow,
    dismissTutorial,
    resetTutorial,
  } = useDemoTutorial()

  const [draftFlowId, setDraftFlowId] = useState(selectedFlowId)

  useEffect(() => {
    setDraftFlowId(selectedFlowId)
  }, [selectedFlowId])

  if (!isEnabled || !isModalOpen) return null

  const activeSummary = flowSummaries.find((flow) => flow.id === draftFlowId) || flowSummaries[0]

  return (
    <div className="demo-modal-backdrop" role="presentation">
      <div className="demo-modal" role="dialog" aria-modal="true" aria-labelledby="demo-academy-title">
        <div className="demo-mission-kicker">{policy.academyLabel}</div>
        <h2 id="demo-academy-title">{policy.introTitle}</h2>
        <p className="demo-modal-copy">
          {policy.introCopy}
        </p>

        <div className="demo-modal-grid">
          {flowSummaries.map((flow) => (
            <button
              key={flow.id}
              type="button"
              className={`demo-modal-flow ${draftFlowId === flow.id ? 'active' : ''}`.trim()}
              onClick={() => {
                setDraftFlowId(flow.id)
                setSelectedFlowId(flow.id)
              }}
            >
              <div className="demo-modal-flow-head">
                <strong>{flow.label}</strong>
                <span>{flow.duration}</span>
              </div>
              <p>{flow.summary}</p>
              <small>{flow.stepCount} guided steps</small>
            </button>
          ))}
        </div>

        <div className="demo-modal-note">
          <strong>{policy.introNoteTitle}</strong>
          <p>{activeSummary?.summary}</p>
        </div>

        <div className="demo-modal-actions">
          <button
            type="button"
            className="nav-link"
            data-tour-id="demo-start-tour"
            onClick={() => startFlow(draftFlowId)}
          >
            {policy.introStartLabel}
          </button>
          <button type="button" className="nav-link ghost-link" onClick={dismissTutorial}>
            {policy.introDismissLabel}
          </button>
          {policy.introSecondaryDismissLabel ? (
            <button type="button" className="nav-link ghost-link" onClick={dismissTutorial}>
              {policy.introSecondaryDismissLabel}
            </button>
          ) : (
            <button type="button" className="nav-link ghost-link" onClick={resetTutorial}>
              {policy.resetLabel}
            </button>
          )}
        </div>

        <div className="demo-modal-footer">
          <Link className="public-link" to={helpPath}>{helpLabel}</Link>
        </div>
      </div>
    </div>
  )
}
