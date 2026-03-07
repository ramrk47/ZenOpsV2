import React from 'react'
import Badge from './ui/Badge'
import { isDemoMode } from '../config/featureFlags'

const DEMO_URL = 'https://demo.maulya.in/'

export default function AssociateDemoPromo({ mobile = false }) {
  if (isDemoMode()) return null

  return (
    <section className={`associate-demo-promo ${mobile ? 'associate-demo-promo--mobile' : ''}`.trim()}>
      <div className="associate-demo-promo-copy">
        <div className="associate-demo-promo-kicker">Public Demo</div>
        <h3>Explore the full Maulya workspace</h3>
        <p>
          Open the isolated demo to show clients or team members the wider admin, field, and associate experience
          without touching the pilot workspace.
        </p>
        <div className="associate-demo-promo-tags">
          <Badge tone="info">Admin cockpit</Badge>
          <Badge tone="info">Field flow</Badge>
          <Badge tone="ok">Associate mobile</Badge>
        </div>
      </div>
      <div className="associate-demo-promo-actions">
        <a className="nav-link" href={DEMO_URL} target="_blank" rel="noreferrer">Open Demo</a>
        <a className="nav-link ghost-link" href={`${DEMO_URL}login`} target="_blank" rel="noreferrer">Demo Login</a>
      </div>
    </section>
  )
}
