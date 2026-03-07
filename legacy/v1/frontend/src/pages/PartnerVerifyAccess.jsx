import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toUserMessage } from '../api/client'
import { verifyAssociateAccessToken } from '../api/partner'
import DemoMarker from '../components/DemoMarker'

export default function PartnerVerifyAccess() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => searchParams.get('token') || '', [searchParams])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('pending')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    async function verify() {
      if (!token) {
        setStatus('error')
        setMessage('Missing verification token.')
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const response = await verifyAssociateAccessToken(token)
        if (cancelled) return
        setStatus('success')
        if (response?.status === 'APPROVED') {
          setMessage('Email verified and account activated. You can sign in now.')
        } else {
          setMessage('Email verified. Your associate request is now ready for review.')
        }
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setMessage(toUserMessage(err, 'Verification failed. Please request a fresh link.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    verify()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="public-shell">
      <DemoMarker variant="public" className="public-demo-banner public-demo-banner--narrow" />
      <div className="public-card public-card--narrow public-card--center">
        <div className="public-badge">Associate Portal</div>
        <h1 className="public-title">Verification</h1>
        <p className="public-lead">
          {loading ? 'Verifying your email link now.' : message}
        </p>
        {!loading && status === 'success' ? (
          <div className="surface-note public-footnote">
            Continue to sign in after activation, or wait for review completion if your workspace still requires approval.
          </div>
        ) : null}
        {!loading && status === 'error' ? (
          <div className="alert alert-danger">{message}</div>
        ) : null}
        <div className="public-actions" style={{ justifyContent: 'center' }}>
          <Link to="/login" className="public-link">Back to Login</Link>
          <Link to="/partner/request-access" className="public-link">Request a fresh link</Link>
        </div>
      </div>
    </div>
  )
}
