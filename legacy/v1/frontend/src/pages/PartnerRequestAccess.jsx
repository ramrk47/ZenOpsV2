import React, { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toUserMessage } from '../api/client'
import { requestAssociateAccess } from '../api/partner'

export default function PartnerRequestAccess() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    city: '',
    message: '',
    captcha_token: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const formReady = useMemo(() => (
    form.company_name.trim()
    && form.contact_name.trim()
    && form.email.trim()
  ), [form])

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const response = await requestAssociateAccess({
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        city: form.city.trim() || undefined,
        role_intent: 'EXTERNAL_ASSOCIATE',
        requested_interface: 'associate',
        message: form.message.trim() || undefined,
        captcha_token: form.captcha_token.trim() || undefined,
      })
      const params = new URLSearchParams()
      params.set('email', form.email.trim().toLowerCase())
      if (response?.debug_verify_url) {
        params.set('debug_verify_url', response.debug_verify_url)
      }
      navigate(`/partner/request-access/sent?${params.toString()}`)
    } catch (err) {
      setError(toUserMessage(err, 'Unable to submit right now. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={heroStyle} />
      <div style={contentWrap}>
        <section style={summaryCard}>
          <div style={badgeStyle}>Associate Portal</div>
          <h1 style={{ margin: '0 0 8px', fontSize: 28, lineHeight: 1.2 }}>Request Access</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Submit your details to join ZenOps as an external associate.
            We will email a verification link before activation.
          </p>
          <ul style={bulletList}>
            <li>Self-serve onboarding with email verification</li>
            <li>Track requests, docs, and payments from one workspace</li>
            <li>Secure access with role-based restrictions</li>
          </ul>
        </section>

        <section style={formCard}>
          <form onSubmit={handleSubmit}>
            <div style={gridTwo}>
              <label style={fieldLabel}>
                <span>Company Name *</span>
                <input
                  name="company_name"
                  value={form.company_name}
                  onChange={handleChange}
                  required
                  style={inputStyle}
                  placeholder="Acme Associates Ltd."
                />
              </label>

              <label style={fieldLabel}>
                <span>Contact Name *</span>
                <input
                  name="contact_name"
                  value={form.contact_name}
                  onChange={handleChange}
                  required
                  style={inputStyle}
                  placeholder="John Doe"
                />
              </label>
            </div>

            <div style={gridTwo}>
              <label style={fieldLabel}>
                <span>Email *</span>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  style={inputStyle}
                  placeholder="john@acme.com"
                />
              </label>

              <label style={fieldLabel}>
                <span>Phone</span>
                <input
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  style={inputStyle}
                  placeholder="+91 9876543210"
                />
              </label>
            </div>

            <div style={gridTwo}>
              <label style={fieldLabel}>
                <span>City</span>
                <input
                  name="city"
                  value={form.city}
                  onChange={handleChange}
                  style={inputStyle}
                  placeholder="Bengaluru"
                />
              </label>

              <label style={fieldLabel}>
                <span>Security Token (optional)</span>
                <input
                  name="captcha_token"
                  value={form.captcha_token}
                  onChange={handleChange}
                  style={inputStyle}
                  placeholder="Only if support asks for it"
                />
              </label>
            </div>

            <label style={fieldLabel}>
              <span>Message</span>
              <textarea
                name="message"
                value={form.message}
                onChange={handleChange}
                style={{ ...inputStyle, minHeight: 92, resize: 'vertical' }}
                placeholder="Tell us about your organisation and services."
              />
            </label>

            {error ? <p style={errorStyle}>{error}</p> : null}

            <button type="submit" style={submitButton} disabled={loading || !formReady}>
              {loading ? 'Submitting...' : 'Submit Request'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <Link to="/login" style={loginLink}>
              Already have an account? Sign in
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}

const pageStyle = {
  minHeight: '100vh',
  position: 'relative',
  background: 'radial-gradient(circle at 12% 0%, rgba(91, 140, 255, 0.22), transparent 42%), radial-gradient(circle at 88% 100%, rgba(109, 224, 255, 0.14), transparent 42%), var(--bg)',
  padding: '32px 16px',
  color: 'var(--text)',
}

const heroStyle = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgba(11,15,28,0.1) 0%, rgba(11,15,28,0.3) 100%)',
  pointerEvents: 'none',
}

const contentWrap = {
  position: 'relative',
  maxWidth: 980,
  margin: '0 auto',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 16,
}

const summaryCard = {
  background: 'color-mix(in srgb, var(--surface) 92%, #0b1224 8%)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 20,
  boxShadow: 'var(--shadow)',
}

const formCard = {
  background: 'color-mix(in srgb, var(--surface-2) 90%, #0b1224 10%)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 20,
  boxShadow: 'var(--shadow)',
}

const badgeStyle = {
  display: 'inline-block',
  marginBottom: 10,
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: 'var(--accent-2)',
  background: 'rgba(91, 140, 255, 0.2)',
  border: '1px solid rgba(91, 140, 255, 0.38)',
}

const bulletList = {
  margin: '14px 0 0',
  padding: '0 0 0 18px',
  color: 'var(--text-muted)',
  display: 'grid',
  gap: 8,
  fontSize: 14,
}

const gridTwo = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
}

const fieldLabel = {
  display: 'grid',
  gap: 6,
  marginBottom: 12,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text)',
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  color: 'var(--text)',
  background: 'rgba(11, 17, 35, 0.55)',
}

const submitButton = {
  width: '100%',
  border: 'none',
  borderRadius: 8,
  padding: '11px 14px',
  fontSize: 15,
  fontWeight: 700,
  color: '#fff',
  background: 'linear-gradient(120deg, var(--accent), #0db6b0)',
  cursor: 'pointer',
}

const loginLink = {
  fontSize: 13,
  color: 'var(--accent-2)',
  textDecoration: 'none',
  fontWeight: 600,
}

const errorStyle = {
  margin: '4px 0 10px',
  color: '#b42318',
  fontSize: 13,
}
