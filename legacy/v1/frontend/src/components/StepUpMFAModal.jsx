import React, { useState } from 'react'
import api from '../api/client'

export default function StepUpMFAModal({ onSuccess, onCancel }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post('/api/auth/step-up/verify', { totp_code: code })
      onSuccess(res.data.step_up_token)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" style={{ zIndex: 99998 }}>
      <div className="modal-card" style={{ width: 'min(400px, 92vw)' }}>
        <h3 style={{ margin: '0 0 4px' }}>Step-Up Authentication</h3>
        <p className="muted" style={{ margin: '0 0 16px', fontSize: '0.9rem' }}>
          This action requires re-authentication. Enter your authenticator code to continue.
        </p>

        <form onSubmit={handleSubmit} className="grid">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.2em', fontFamily: 'monospace' }}
            autoFocus
          />

          {error && (
            <div className="badge danger" role="alert" style={{ justifyContent: 'center' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={loading || code.length < 6}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
