import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, Section } from '../components/Primitives'
import { useAuth } from '../../auth/AuthContext'

export default function ProfileScreen() {
  const { user, capabilities, logout } = useAuth()

  const enabledCaps = useMemo(
    () => Object.entries(capabilities || {}).filter(([, value]) => Boolean(value)).map(([key]) => key),
    [capabilities],
  )

  return (
    <MobileLayout title="Profile" subtitle="Account and quick links" primaryAction={{ label: 'Search', to: '/m/search' }}>
      <Section title="Account">
        <Card>
          <p><strong>Name:</strong> {user?.full_name || '—'}</p>
          <p><strong>Email:</strong> {user?.email || '—'}</p>
          <p><strong>Role:</strong> {(user?.roles || [user?.role]).filter(Boolean).join(', ') || '—'}</p>
        </Card>
      </Section>

      <Section title="Capabilities" subtitle={`${enabledCaps.length} enabled`}>
        <Card>
          <ul className="m-simple-list">
            {enabledCaps.map((capability) => <li key={capability}>{capability}</li>)}
          </ul>
        </Card>
      </Section>

      <Section title="Quick Actions">
        <div className="m-inline-actions">
          <Link className="m-link-btn" to="/m/home">Mobile Home</Link>
          <Link className="m-link-btn" to="/">Desktop Mode</Link>
          <button type="button" className="m-secondary-btn" onClick={logout}>Logout</button>
        </div>
      </Section>
    </MobileLayout>
  )
}
