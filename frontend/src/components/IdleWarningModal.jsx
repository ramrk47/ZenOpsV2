import React, { useEffect, useState } from 'react'

export default function IdleWarningModal({ secondsLeft, onStayLoggedIn, onLogout }) {
  const [remaining, setRemaining] = useState(secondsLeft)

  useEffect(() => {
    setRemaining(secondsLeft)
  }, [secondsLeft])

  useEffect(() => {
    if (remaining <= 0) {
      onLogout()
      return
    }
    const id = setInterval(() => setRemaining((r) => r - 1), 1000)
    return () => clearInterval(id)
  }, [remaining, onLogout])

  useEffect(() => {
    const dismiss = () => onStayLoggedIn()
    window.addEventListener('mousemove', dismiss, { once: true })
    window.addEventListener('keydown', dismiss, { once: true })
    return () => {
      window.removeEventListener('mousemove', dismiss)
      window.removeEventListener('keydown', dismiss)
    }
  }, [onStayLoggedIn])

  return (
    <div className="modal-backdrop" style={{ zIndex: 99999 }}>
      <div className="modal-card" style={{ width: 'min(400px, 92vw)', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>&#9201;</div>
        <h3 style={{ margin: '0 0 8px' }}>Session Expiring</h3>
        <p className="muted" style={{ margin: '0 0 20px', fontSize: '0.9rem' }}>
          Your session will expire in{' '}
          <strong style={{ color: 'var(--danger)', fontSize: '1.1em' }}>{remaining}</strong>{' '}
          seconds due to inactivity.
        </p>
        <button onClick={onStayLoggedIn} style={{ width: '100%' }}>
          Stay Logged In
        </button>
      </div>
    </div>
  )
}
