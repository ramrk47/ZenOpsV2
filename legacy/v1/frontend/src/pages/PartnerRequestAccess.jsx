import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toUserMessage } from '../api/client'
import { requestAssociateAccess } from '../api/partner'

/**
 * Public page (no auth required) — allows external associates to submit
 * an access request to the Zen Ops platform.
 */
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
      setError(toUserMessage(err, 'Something went wrong. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 4px' }}>Associate Access Request</h2>
          <p style={{ color: '#888', margin: 0, fontSize: 14 }}>
            Submit your details to request access to the Zen Ops associate portal.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Company Name *</label>
          <input
            name="company_name"
            value={form.company_name}
            onChange={handleChange}
            required
            style={inputStyle}
            placeholder="Acme Associates Ltd."
          />

          <label style={labelStyle}>Contact Name *</label>
          <input
            name="contact_name"
            value={form.contact_name}
            onChange={handleChange}
            required
            style={inputStyle}
            placeholder="John Doe"
          />

          <label style={labelStyle}>Email *</label>
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            required
            style={inputStyle}
            placeholder="john@acme.com"
          />

          <label style={labelStyle}>Phone</label>
          <input
            name="phone"
            type="tel"
            value={form.phone}
            onChange={handleChange}
            style={inputStyle}
            placeholder="+91 9876543210"
          />

          <label style={labelStyle}>City</label>
          <input
            name="city"
            value={form.city}
            onChange={handleChange}
            style={inputStyle}
            placeholder="Bengaluru"
          />

          <label style={labelStyle}>Message</label>
          <textarea
            name="message"
            value={form.message}
            onChange={handleChange}
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
            placeholder="Tell us about your organisation and how we can collaborate..."
          />

          <label style={labelStyle}>Captcha Token (placeholder)</label>
          <input
            name="captcha_token"
            value={form.captcha_token}
            onChange={handleChange}
            style={inputStyle}
            placeholder="Required in production (provider wiring pending)"
          />

          {error && <p style={{ color: '#d32f2f', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}

          <button type="submit" style={btnStyle} disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <a href="/login" style={linkStyle}>
            Already have an account? Login
          </a>
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
  maxWidth: 440,
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
