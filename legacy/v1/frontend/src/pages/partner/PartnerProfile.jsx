import React, { useEffect, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { fetchPartnerProfile } from '../../api/partner'
import { toUserMessage } from '../../api/client'

export default function PartnerProfile() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchPartnerProfile()
        if (!cancelled) setProfile(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load partner profile'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <PageHeader
        title="Partner Profile"
        subtitle="Your firm information used for reports and invoicing."
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      {loading ? (
        <div className="muted">Loading profile…</div>
      ) : !profile ? (
        <EmptyState>Profile data unavailable.</EmptyState>
      ) : (
        <Card>
          <CardHeader title={profile.display_name || 'Partner'} subtitle="Read-only firm details" />
          <div className="grid cols-2">
            <div>
              <div className="kicker">Contact</div>
              <div>{profile.contact_name || '—'}</div>
            </div>
            <div>
              <div className="kicker">Legal Name</div>
              <div>{profile.legal_name || '—'}</div>
            </div>
            <div>
              <div className="kicker">Email</div>
              <div>{profile.email || '—'}</div>
            </div>
            <div>
              <div className="kicker">Phone</div>
              <div>{profile.phone || '—'}</div>
            </div>
            <div>
              <div className="kicker">Alternate Contact</div>
              <div>{profile.alternate_contact_name || '—'}</div>
            </div>
            <div>
              <div className="kicker">Alternate Email</div>
              <div>{profile.alternate_contact_email || '—'}</div>
            </div>
            <div>
              <div className="kicker">Alternate Phone</div>
              <div>{profile.alternate_contact_phone || '—'}</div>
            </div>
            <div>
              <div className="kicker">City</div>
              <div>{profile.city || '—'}</div>
            </div>
            <div>
              <div className="kicker">Billing Address</div>
              <div>{profile.billing_address || '—'}</div>
            </div>
            <div>
              <div className="kicker">Billing City</div>
              <div>{profile.billing_city || '—'}</div>
            </div>
            <div>
              <div className="kicker">Billing State</div>
              <div>{profile.billing_state || '—'}</div>
            </div>
            <div>
              <div className="kicker">Billing Postal</div>
              <div>{profile.billing_postal_code || '—'}</div>
            </div>
            <div>
              <div className="kicker">GSTIN</div>
              <div>{profile.gstin || '—'}</div>
            </div>
            <div>
              <div className="kicker">Service Lines</div>
              <div>{profile.service_lines && profile.service_lines.length ? profile.service_lines.join(', ') : '—'}</div>
            </div>
            <div>
              <div className="kicker">Multi-floor Entry</div>
              <div>{profile.multi_floor_enabled ? 'Enabled' : 'Disabled'}</div>
            </div>
            <div>
              <div className="kicker">Notes</div>
              <div>{profile.notes || '—'}</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
