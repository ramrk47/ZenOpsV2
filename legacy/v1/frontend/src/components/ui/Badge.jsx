import React from 'react'

export default function Badge({ tone = 'muted', children, title }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  )
}
