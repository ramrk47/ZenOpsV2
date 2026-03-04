import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toUserMessage } from '../api/client'
import { resendAssociateVerification } from '../api/partner'

export default function PartnerRequestAccessSent() {
  const [searchParams] = useSearchParams()
  const email = useMemo(() => (searchParams.get('email') || '').trim().toLowerCase(), [searchParams])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleResend() {
    if (!email) {
      setError('Missing email address. Please submit the request again.')
      return
    }
    setLoading(true)
    setError('')
    setMessage('')
    try {
      await resendAssociateVerification(email)
      setMessage('Verification email resent. Please check your inbox.')
    } catch (err) {
      setError(toUserMessage(err, 'Unable to resend verification email right now.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>&#10003;</div>
          <h2 style={{ margin: '0 0 8px' }}>Check Your Email</h2>
          <p style={{ color: '#555', marginBottom: 8 }}>
            We sent a one-time verification link to <strong>{email || 'your inbox'}</strong>.
          </p>
          <p className="muted" style={{ marginBottom: 18 }}>
            Verify your email to activate your External Associate onboarding flow.
          </p>
          <button type="button" style={btnStyle} onClick={handleResend} disabled={loading}>
            {loading ? 'Resending...' : 'Resend verification email'}
          </button>
          {message ? <p style={{ color: '#17653a', marginTop: 10 }}>{message}</p> : null}
          {error ? <p style={{ color: '#b42318', marginTop: 10 }}>{error}</p> : null}
          <div style={{ marginTop: 16 }}>
            <Link to="/login" style={linkStyle}>
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

const pageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f5f5f5',
  padding: 20,
}

const cardStyle = {
  background: '#fff',
  borderRadius: 12,
  padding: '32px 36px',
  maxWidth: 480,
  width: '100%',
  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
}

const btnStyle = {
  width: '100%',
  padding: '10px',
  marginTop: 6,
  fontSize: 15,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  background: '#1976d2',
  color: '#fff',
  cursor: 'pointer',
}

const linkStyle = {
  fontSize: 13,
  color: '#1976d2',
  textDecoration: 'none',
}
