import React from 'react'

export default function PageGrid({ cols = { base: 1 }, children, className = '', style }) {
  const base = cols.base || 1
  const md = cols.md || base
  const lg = cols.lg || md

  return (
    <div
      className={`page-grid ${className}`.trim()}
      style={{
        '--cols-base': base,
        '--cols-md': md,
        '--cols-lg': lg,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function KpiRow({ children, className = '', style }) {
  return (
    <div className={`kpi-row ${className}`.trim()} style={style}>
      {children}
    </div>
  )
}
