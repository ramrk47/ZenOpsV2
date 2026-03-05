import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toUserMessage } from '../api/client'
import { resendAssociateVerification } from '../api/partner'

export default function PartnerRequestAccessSent() {
  const [searchParams] = useSearchParams()
  const email = useMemo(() => (searchParams.get('email') || '').trim().toLowerCase(), [searchParams])
  const debugVerifyUrl = useMemo(() => (searchParams.get('debug_verify_url') || '').trim(), [searchParams])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')

  async function handleCopyDebugLink() {
    if (!debugVerifyUrl) return
    try {
      await navigator.clipboard.writeText(debugVerifyUrl)
      setCopyStatus('Verification link copied.')
    } catch {
      setCopyStatus('Copy failed. Please copy manually from the link below.')
    }
  }

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
          <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
            We sent a one-time verification link to <strong>{email || 'your inbox'}</strong>.
          </p>
          <p className="muted" style={{ marginBottom: 18 }}>
            Verify your email to activate your External Associate onboarding flow.
          </p>
          <button type="button" style={btnStyle} onClick={handleResend} disabled={loading}>
            {loading ? 'Resending...' : 'Resend verification email'}
          </button>
          {debugVerifyUrl ? (
            <div
              style={{
                marginTop: 12,
                textAlign: 'left',
                background: 'rgba(255, 184, 77, 0.14)',
                border: '1px solid rgba(255, 184, 77, 0.5)',
                padding: 10,
                borderRadius: 6,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Email disabled fallback (non-production)</div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Use this one-time verification link for pilot testing.
              </div>
              <div style={{ wordBreak: 'break-all', fontSize: 12, marginBottom: 8 }}>
                <a href={debugVerifyUrl}>{debugVerifyUrl}</a>
              </div>
              <button type="button" style={{ ...btnStyle, marginTop: 0 }} onClick={handleCopyDebugLink}>
                Copy verification link
              </button>
              {copyStatus ? <div style={{ marginTop: 8, fontSize: 12 }}>{copyStatus}</div> : null}
            </div>
          ) : null}
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
  background: 'radial-gradient(circle at 18% 0%, rgba(91, 140, 255, 0.2), transparent 42%), radial-gradient(circle at 82% 100%, rgba(109, 224, 255, 0.14), transparent 40%), var(--bg)',
  padding: 20,
  color: 'var(--text)',
}

const cardStyle = {
  background: 'color-mix(in srgb, var(--surface) 90%, #0b1224 10%)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '32px 36px',
  maxWidth: 480,
  width: '100%',
  boxShadow: 'var(--shadow)',
}

const btnStyle = {
  width: '100%',
  padding: '10px',
  marginTop: 6,
  fontSize: 15,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  background: 'linear-gradient(120deg, var(--accent), #0db6b0)',
  color: '#fff',
  cursor: 'pointer',
}

const linkStyle = {
  fontSize: 13,
  color: 'var(--accent-2)',
  textDecoration: 'none',
}
