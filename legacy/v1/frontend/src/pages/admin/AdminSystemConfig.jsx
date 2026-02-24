import React, { useEffect, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { toUserMessage } from '../../api/client'
import api from '../../api/client'

export default function AdminSystemConfig() {
  const [config, setConfig] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // Form fields
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [opsEmail, setOpsEmail] = useState('')
  const [supportBubbleEnabled, setSupportBubbleEnabled] = useState(true)
  const [supportPortalBaseUrl, setSupportPortalBaseUrl] = useState('')

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig() {
    setLoading(true)
    setError(null)
    try {
      // Fetch all config
      const { data } = await api.get('/api/support/config')
      setConfig(data)
      
      // Populate form fields
      setWhatsappNumber(data.WHATSAPP_NUMBER || '')
      setOpsEmail(data.OPS_SUPPORT_EMAIL || '')
      setSupportBubbleEnabled(data.SUPPORT_BUBBLE_ENABLED !== false)
      setSupportPortalBaseUrl(data.SUPPORT_PORTAL_BASE_URL || '')
    } catch (err) {
      console.error('Failed to load system config:', err)
      setError(toUserMessage(err, 'Failed to load system configuration'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const updates = {
        WHATSAPP_NUMBER: whatsappNumber,
        OPS_SUPPORT_EMAIL: opsEmail,
        SUPPORT_BUBBLE_ENABLED: supportBubbleEnabled,
        SUPPORT_PORTAL_BASE_URL: supportPortalBaseUrl,
      }

      await api.put('/api/support/config', updates)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Failed to save system config:', err)
      setError(toUserMessage(err, 'Failed to save system configuration'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="System Configuration" description="Manage system-wide settings" />
        <Card>
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading configuration...</div>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="System Configuration"
        description="Manage system-wide settings (non-secret values only)"
      />

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
          {error}
        </div>
      )}

      {success && (
        <div className="alert alert-ok" style={{ marginBottom: '1.5rem' }}>
          Configuration saved successfully!
        </div>
      )}

      <Card>
        <CardHeader title="Support & Contact Settings" />
        <form onSubmit={handleSave} className="system-config-form">
          <div className="form-group">
            <label htmlFor="whatsappNumber">
              WhatsApp Contact Number
              <small className="form-hint">
                International format, digits only (e.g., 917975357599). No spaces, dashes, or country code symbol.
              </small>
            </label>
            <input
              id="whatsappNumber"
              type="text"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="917975357599"
              pattern="[0-9]+"
              maxLength={15}
            />
          </div>

          <div className="form-group">
            <label htmlFor="opsEmail">
              Operations Support Email
              <small className="form-hint">
                Email address where support notifications will be sent.
              </small>
            </label>
            <input
              id="opsEmail"
              type="email"
              value={opsEmail}
              onChange={(e) => setOpsEmail(e.target.value)}
              placeholder="support@zenops.com"
            />
          </div>

          <div className="form-group">
            <label htmlFor="supportPortalBaseUrl">
              Support Portal Base URL
              <small className="form-hint">
                Base URL for support portal links in emails (e.g., https://zenops.com)
              </small>
            </label>
            <input
              id="supportPortalBaseUrl"
              type="url"
              value={supportPortalBaseUrl}
              onChange={(e) => setSupportPortalBaseUrl(e.target.value)}
              placeholder="https://zenops.com"
            />
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={supportBubbleEnabled}
                onChange={(e) => setSupportBubbleEnabled(e.target.checked)}
                style={{ marginRight: '0.5rem' }}
              />
              Enable WhatsApp Support Bubble
              <small className="form-hint">
                Shows floating WhatsApp button on external partner portal.
              </small>
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </Card>

      <Card style={{ marginTop: '1.5rem' }}>
        <CardHeader title="Important Notes" />
        <div style={{ padding: '1.5rem' }}>
          <ul style={{ marginLeft: '1.5rem', lineHeight: '1.8' }}>
            <li><strong>API Keys & Secrets:</strong> Provider API keys (Resend, etc.) must be configured in server environment variables only. They cannot be managed through this UI for security reasons.</li>
            <li><strong>Email Configuration:</strong> Email provider settings are configured via <code>EMAIL_PROVIDER</code> and <code>EMAIL_API_KEY</code> environment variables in the backend.</li>
            <li><strong>WhatsApp:</strong> Uses free click-to-chat links (wa.me). No API or WhatsApp Business account required.</li>
            <li><strong>Changes:</strong> Configuration changes take effect immediately.</li>
          </ul>
        </div>
      </Card>
    </div>
  )
}
