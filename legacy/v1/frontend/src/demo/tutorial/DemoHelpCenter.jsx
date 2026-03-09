import React from 'react'

import { DEMO_GLOSSARY } from './demoGlossary'
import { getDemoTutorialFlowSummaries } from './demoTutorialSteps'
import { useDemoTutorial } from './useDemoTutorial'

const FLOW_SUMMARIES = getDemoTutorialFlowSummaries()

export default function DemoHelpCenter({ mobile = false }) {
  const { policy, startFlow } = useDemoTutorial()

  return (
    <div className={`demo-help-center ${mobile ? 'demo-help-center--mobile' : ''}`.trim()}>
      <section className="demo-help-card">
        <div className="demo-mission-kicker">{policy.helpKicker}</div>
        <h2>Quick Start By Role</h2>
        <p>
          Choose the workflow you want to understand. Each tour is designed to teach one practical loop,
          not a long feature list.
        </p>
        <div className="demo-help-flow-grid">
          {FLOW_SUMMARIES.map((flow) => (
            <article key={flow.id} className="demo-help-flow-card">
              <div className="demo-help-flow-head">
                <strong>{flow.label}</strong>
                <span>{flow.duration}</span>
              </div>
              <p>{flow.summary}</p>
              <small>{flow.stepCount} guided steps</small>
              <button type="button" className="nav-link" onClick={() => startFlow(flow.id)}>
                Start {flow.shortLabel} Tour
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="demo-help-card">
        <div className="demo-mission-kicker">Workflow Map</div>
        <h2>How The Core Loop Works</h2>
        <p>{policy.helpWorkflowBody}</p>
        <div className="demo-help-workflow">
          <div className="demo-workflow-step">
            <strong>1. Draft / Intake</strong>
            <p>Capture the minimum context required to start work without committing the case prematurely.</p>
          </div>
          <div className="demo-workflow-arrow">→</div>
          <div className="demo-workflow-step">
            <strong>2. Evidence</strong>
            <p>Upload documents, photos, and checklist items so review teams do not have to chase missing inputs.</p>
          </div>
          <div className="demo-workflow-arrow">→</div>
          <div className="demo-workflow-step">
            <strong>3. Approval</strong>
            <p>Move key decisions through explicit approvals instead of hidden chat or verbal handoffs.</p>
          </div>
          <div className="demo-workflow-arrow">→</div>
          <div className="demo-workflow-step">
            <strong>4. Invoice / Payment</strong>
            <p>Track financial follow-through with payment confirmation before reporting work as fully paid.</p>
          </div>
          <div className="demo-workflow-arrow">→</div>
          <div className="demo-workflow-step">
            <strong>5. Closure</strong>
            <p>Release deliverables only when the operational and finance gates are satisfied.</p>
          </div>
        </div>
      </section>

      <section className="demo-help-card">
        <div className="demo-mission-kicker">Glossary</div>
        <h2>Terms That Matter In The Demo</h2>
        <div className="demo-help-glossary">
          {DEMO_GLOSSARY.map((entry) => (
            <article key={entry.term} className="demo-help-glossary-item">
              <strong>{entry.term}</strong>
              <p>{entry.definition}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
