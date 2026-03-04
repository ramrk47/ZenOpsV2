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
  background: '#f5f5f5',
  padding: 20,
}

const cardStyle = {
  background: '#fff',
  borderRadius: 12,
  padding: '28px 32px',
  maxWidth: 460,
  width: '100%',
  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
}

const linkStyle = {
  fontSize: 13,
  color: '#1976d2',
  textDecoration: 'none',
}
