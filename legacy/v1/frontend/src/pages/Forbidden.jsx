import React from 'react'

export default function Forbidden() {
  return (
    <div className="forbidden">
      <div className="forbidden-card">
        <div className="kicker">Access Restricted</div>
        <h2 style={{ margin: '0.3rem 0 0.2rem' }}>You don’t have access to this workspace.</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          If you believe this is a mistake, please contact an administrator to update your access.
        </p>
      </div>
    </div>
  )
}
