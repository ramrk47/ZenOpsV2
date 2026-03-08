import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toUserMessage } from '../api/client'
import { resendAssociateVerification } from '../api/partner'
import BrandLogo from '../components/BrandLogo'
import DemoMarker from '../components/DemoMarker'

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
    <div className="public-shell">
      <DemoMarker variant="public" className="public-demo-banner public-demo-banner--narrow" />
      <div className="public-card public-card--narrow public-card--center">
        <BrandLogo variant="public" showCredit className="public-brand-lockup" />
        <div className="public-badge">Associate Portal</div>
        <h1 className="public-title">Check Your Email</h1>
        <p className="public-lead">
          We sent a one-time verification link to <strong>{email || 'your inbox'}</strong>. Verify it to activate the associate onboarding flow.
        </p>

        <div className="public-actions" style={{ justifyContent: 'center' }}>
          <button type="button" onClick={handleResend} disabled={loading}>
            {loading ? 'Resending...' : 'Resend verification email'}
          </button>
          <Link to="/login" className="public-link">Back to Login</Link>
        </div>

        {message ? <div className="alert alert-ok">{message}</div> : null}
        {error ? <div className="alert alert-danger">{error}</div> : null}

        {debugVerifyUrl ? (
          <div className="public-debug-box">
            <strong>Email disabled fallback (non-production)</strong>
            <div className="public-footnote">
              Use this one-time verification link for pilot or demo environments where outbound email is intentionally disabled.
            </div>
            <a className="public-debug-link" href={debugVerifyUrl}>{debugVerifyUrl}</a>
            <div className="public-actions">
              <button type="button" className="secondary" onClick={handleCopyDebugLink}>
                Copy verification link
              </button>
              {copyStatus ? <span className="public-footnote">{copyStatus}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
