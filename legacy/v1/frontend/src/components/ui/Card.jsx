import React from 'react'

export function Card({ children, className = '', style, id }) {
  return (
    <section id={id} className={`card ${className}`.trim()} style={style}>
      {children}
    </section>
  )
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="card-header">
      <div>
        <div className="card-title">{title}</div>
        {subtitle ? <div className="muted" style={{ marginTop: 2 }}>{subtitle}</div> : null}
      </div>
      {action ? <div className="card-header-action">{action}</div> : null}
    </div>
  )
}
