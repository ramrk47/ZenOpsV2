import React from 'react'
import { isDemoMode } from '../config/featureFlags'

const COPY = {
  banner: {
    label: 'Public Demo Workspace',
    title: 'Sample data only. Explore freely.',
    body: 'This Not Alone Studios environment is isolated from pilot operations and may be reset without notice.',
  },
  compact: {
    label: 'Demo Workspace',
    title: 'Public demo',
    body: 'Not Alone Studios sample data only.',
  },
  public: {
    label: 'Public Demo Workspace',
    title: 'This page belongs to the Maulya demo environment.',
    body: 'Built by Not Alone Studios. Nothing here touches pilot or live operations. Data may be refreshed at any time.',
  },
  mobile: {
    label: 'Demo Workspace',
    title: 'Sample data only',
    body: 'Built by Not Alone Studios and isolated from pilot.',
  },
}

export default function DemoMarker({ variant = 'banner', className = '' }) {
  if (!isDemoMode()) return null

  const copy = COPY[variant] || COPY.banner

  return (
    <div className={`demo-marker demo-marker--${variant} ${className}`.trim()} role="note" aria-label="Demo workspace notice">
      <div className="demo-marker-label">{copy.label}</div>
      <div className="demo-marker-title">{copy.title}</div>
      <div className="demo-marker-body">{copy.body}</div>
    </div>
  )
}
