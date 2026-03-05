import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toUserMessage } from '../api/client'
import { verifyAssociateAccessToken } from '../api/partner'

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
        if (!cancelled) {
          setStatus('success')
          if (response?.status === 'APPROVED') {
            setMessage('Email verified and account activated. You can sign in now.')
          } else {
            setMessage('Email verified. Your External Associate request is now ready for review.')
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setMessage(toUserMessage(err, 'Verification failed. Please request a fresh link.'))
        }
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
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>External Associate Verification</h2>
        {loading ? <p className="muted">Verifying your email…</p> : <p>{message}</p>}
        {!loading && status === 'success' ? (
          <p className="muted">Continue to login after activation, or wait for review completion.</p>
        ) : null}
        <div style={{ marginTop: 16 }}>
          <Link to="/login" style={linkStyle}>Back to Login</Link>
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
  padding: '28px 32px',
  maxWidth: 460,
  width: '100%',
  boxShadow: 'var(--shadow)',
}

const linkStyle = {
  fontSize: 13,
  color: 'var(--accent-2)',
  textDecoration: 'none',
}
