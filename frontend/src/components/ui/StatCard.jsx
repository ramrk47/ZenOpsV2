import React from 'react'
import { Card } from './Card'
import InfoTip from './InfoTip'

export default function StatCard({ label, value, kicker, tone, children, help }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {kicker ? <div className="kicker">{kicker}</div> : <div />}
        {help ? <InfoTip text={help} /> : null}
      </div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
      {children ? <div style={{ marginTop: 10 }}>{children}</div> : null}
    </Card>
  )
}
