import React, { useState } from 'react'
import api from '../api/client'

export default function StepUpMFAModal({ onSuccess, onCancel }) {
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const value = String(secret || '').trim()
    if (!value) {
      setError('Enter your authenticator code or admin master key.')
      return
    }
    setLoading(true)
    try {
      if (/^\d{6}$/.test(value)) {
        const res = await api.post('/api/auth/step-up/verify', { totp_code: value })
        onSuccess({ kind: 'step_up_token', value: res.data.step_up_token })
      } else {
        onSuccess({ kind: 'admin_master_key', value })
      }
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
          Enter your 6-digit authenticator code, or an admin master key for user reset/create actions.
        </p>

        <form onSubmit={handleSubmit} className="grid">
          <input
            type="password"
            autoComplete="off"
            placeholder="Authenticator code or admin master key"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            style={{ fontSize: '0.95em', fontFamily: 'monospace' }}
            autoFocus
          />
          <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
            Master key works only for admin account management actions.
          </p>

          {error && (
            <div className="badge danger" role="alert" style={{ justifyContent: 'center' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={loading || !secret.trim()}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
