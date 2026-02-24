import React from 'react'
import InfoTip from './InfoTip'

export default function KpiTile({
  label,
  value,
  tone,
  help,
  onClick,
  sublabel,
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`card tight kpi-tile ${onClick ? 'kpi-clickable' : ''}`.trim()}
      onClick={onClick}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <InfoTip text={help} /> : null}
      </div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </div>
      {sublabel ? <div className="stat-label">{sublabel}</div> : null}
    </Tag>
  )
}
