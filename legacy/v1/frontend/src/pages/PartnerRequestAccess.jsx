import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toUserMessage } from '../api/client'
import { requestAssociateAccess, resolveAssociateAccessHandoff } from '../api/partner'
import BrandLogo from '../components/BrandLogo'
import DemoMarker from '../components/DemoMarker'

export default function PartnerRequestAccess() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
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
  const [prefillNotice, setPrefillNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [hydrating, setHydrating] = useState(false)
  const formReady = useMemo(() => (
    form.company_name.trim()
    && form.contact_name.trim()
    && form.email.trim()
  ), [form])

  useEffect(() => {
    const handoff = searchParams.get('handoff')
    if (!handoff) return undefined

    let cancelled = false

    async function hydrateFromHandoff() {
      setHydrating(true)
      setError('')
      try {
        const resolved = await resolveAssociateAccessHandoff(handoff)
        if (cancelled) return
        const prefill = resolved?.prefill || {}
        setForm((prev) => ({
          ...prev,
          company_name: prefill.company_name || prev.company_name,
          contact_name: prefill.contact_name || prev.contact_name,
          email: prefill.email || prev.email,
          phone: prefill.phone || prev.phone,
          city: prefill.city || prev.city,
          message: prefill.message || prev.message,
        }))
        setPrefillNotice(prefill.source === 'nas-contact'
          ? 'We carried over the details from the Notalone Studios contact form. Review them and submit to continue onboarding.'
          : 'We carried over the lead details from the previous intake. Review them and submit to continue onboarding.')
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete('handoff')
        setSearchParams(nextParams, { replace: true })
      } catch (err) {
        if (!cancelled) {
          setError(toUserMessage(err, 'Unable to load the onboarding handoff. Please complete the form directly.'))
        }
      } finally {
        if (!cancelled) setHydrating(false)
      }
    }

    hydrateFromHandoff()
    return () => {
      cancelled = true
    }
  }, [searchParams, setSearchParams])

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
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
    <div className="public-shell">
      <DemoMarker variant="public" className="public-demo-banner" />
      <div className="public-grid">
        <section className="public-card public-card--hero">
          <BrandLogo variant="public" showCredit className="public-brand-lockup" />
          <div className="public-badge">Associate Portal</div>
          <h1 className="public-title">Request Access</h1>
          <p className="public-lead">
            Join the Maulya associate workspace to submit fresh assignments, upload evidence, and track payment-linked delivery from one place.
          </p>
          <ul className="public-bullets">
            <li>
              <span className="public-status-mark" />
              <span>Self-serve onboarding with verification before activation.</span>
            </li>
            <li>
              <span className="public-status-mark" />
              <span>Clear request tracking for commissions, documents, and payout steps.</span>
            </li>
            <li>
              <span className="public-status-mark" />
              <span>Role-fenced access that keeps associate activity separate from internal operations.</span>
            </li>
          </ul>
          <div className="surface-note">
            <div className="metric-card-kicker">Best for pilot onboarding</div>
            <div className="public-footnote">
              Use this form for real associate onboarding. For demos, use the separate demo workspace so public traffic never touches pilot data.
            </div>
          </div>
        </section>

        <section className="public-card public-card--form">
          <form onSubmit={handleSubmit} className="public-card--form">
            <div className="public-form-grid">
              <label className="public-field">
                <span>Company Name *</span>
                <input
                  name="company_name"
                  value={form.company_name}
                  onChange={handleChange}
                  required
                  placeholder="Acme Associates Ltd."
                />
              </label>

              <label className="public-field">
                <span>Contact Name *</span>
                <input
                  name="contact_name"
                  value={form.contact_name}
                  onChange={handleChange}
                  required
                  placeholder="John Doe"
                />
              </label>
            </div>

            <div className="public-form-grid">
              <label className="public-field">
                <span>Email *</span>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  placeholder="john@acme.com"
                />
              </label>

              <label className="public-field">
                <span>Phone</span>
                <input
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="+91 9876543210"
                />
              </label>
            </div>

            <div className="public-form-grid">
              <label className="public-field">
                <span>City</span>
                <input
                  name="city"
                  value={form.city}
                  onChange={handleChange}
                  placeholder="Bengaluru"
                />
              </label>

              <label className="public-field">
                <span>Security Token (optional)</span>
                <input
                  name="captcha_token"
                  value={form.captcha_token}
                  onChange={handleChange}
                  placeholder="Only if support asks for it"
                />
              </label>
            </div>

            <label className="public-field">
              <span>Message</span>
              <textarea
                name="message"
                value={form.message}
                onChange={handleChange}
                placeholder="Tell us about your organisation and services."
              />
            </label>

            {error ? <div className="alert alert-danger">{error}</div> : null}
            {prefillNotice ? <div className="alert alert-info">{prefillNotice}</div> : null}

            <div className="public-actions">
              <button type="submit" disabled={loading || hydrating || !formReady}>
                {hydrating ? 'Loading intake...' : loading ? 'Submitting...' : 'Submit Request'}
              </button>
              <Link to="/login" className="public-link">
                Already have an account? Sign in
              </Link>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
