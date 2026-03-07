import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import api, { toUserMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { setLocalStorageItem } from '../utils/appInstance'

export default function InviteAccept() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => searchParams.get('token') || '', [searchParams])
  const navigate = useNavigate()
  const { refreshAuth } = useAuth()

  const [validating, setValidating] = useState(true)
  const [inviteMeta, setInviteMeta] = useState(null)
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function validate() {
      if (!token) {
        setError('Invite token is missing.')
        setValidating(false)
        return
      }
      setValidating(true)
      setError('')
      try {
        const res = await api.get('/api/auth/invite/validate', { params: { token } })
        if (!cancelled) {
          if (!res.data?.valid) {
            setError('Invite is invalid or expired.')
          } else {
            setInviteMeta(res.data)
          }
        }
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Unable to validate invite link'))
      } finally {
        if (!cancelled) setValidating(false)
      }
    }
    validate()
    return () => {
      cancelled = true
    }
  }, [token])

  function onChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.password.length < 10) {
      setError('Password must be at least 10 characters.')
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    try {
      const res = await api.post('/api/auth/invite/accept', {
        token,
        password: form.password,
      })
      if (res.data?.access_token) {
        setLocalStorageItem('token', res.data.access_token)
      }
      await refreshAuth({ allowAnonymous: false })
      navigate('/partner', { replace: true })
    } catch (err) {
      setError(toUserMessage(err, 'Invite acceptance failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Set Password</h2>
        {validating ? <p className="muted">Validating invite…</p> : null}
        {!validating && inviteMeta?.valid ? (
          <>
            <p className="muted">Activate External Associate access for <strong>{inviteMeta.email}</strong>.</p>
            <form onSubmit={onSubmit}>
              <label style={labelStyle}>New Password *</label>
              <input
                name="password"
                type="password"
                value={form.password}
                onChange={onChange}
                required
                style={inputStyle}
              />
              <label style={labelStyle}>Confirm Password *</label>
              <input
                name="confirm"
                type="password"
                value={form.confirm}
                onChange={onChange}
                required
                style={inputStyle}
              />
              {error ? <p style={{ color: '#d32f2f', fontSize: 13 }}>{error}</p> : null}
              <button type="submit" style={btnStyle} disabled={saving}>
                {saving ? 'Activating…' : 'Activate Account'}
              </button>
            </form>
          </>
        ) : null}
        {!validating && !inviteMeta?.valid ? (
          <>
            <p style={{ color: '#d32f2f' }}>{error || 'Invite is invalid or expired.'}</p>
            <Link to="/partner/request-access" style={linkStyle}>Request Access Again</Link>
          </>
        ) : null}
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

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
  marginTop: 12,
  color: '#333',
}

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 14,
  border: '1px solid #ccc',
  borderRadius: 6,
  boxSizing: 'border-box',
}

const btnStyle = {
  width: '100%',
  padding: '10px',
  marginTop: 20,
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
