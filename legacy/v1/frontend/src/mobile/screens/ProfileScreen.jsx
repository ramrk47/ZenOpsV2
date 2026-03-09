import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, KVRow, Section } from '../components/Primitives'
import { useAuth } from '../../auth/AuthContext'
import { useDemoTutorial } from '../../demo/tutorial/useDemoTutorial'

export default function ProfileScreen() {
  const { user, capabilities, logout } = useAuth()
  const {
    isEnabled: tutorialEnabled,
    policy: tutorialPolicy,
    helpPath: tutorialHelpPath,
    openTutorialModal,
    resetTutorial,
  } = useDemoTutorial()

  const enabledCaps = useMemo(
    () => Object.entries(capabilities || {}).filter(([, value]) => Boolean(value)).map(([key]) => key),
    [capabilities],
  )

  return (
    <MobileLayout title="Profile" subtitle="Account details and useful links" primaryAction={{ label: 'Search', to: '/m/search' }}>
      <Section title="Account" subtitle="Identity and access context for this signed-in user.">
        <Card className="m-detail-hero">
          <div className="m-detail-hero-copy">
            <p>Signed in as</p>
            <h3>{user?.full_name || user?.email || 'Maulya User'}</h3>
          </div>
          <div className="m-detail-hero-meta">
            <span>{user?.email || '—'}</span>
            <span>{(user?.roles || [user?.role]).filter(Boolean).join(', ') || '—'}</span>
          </div>
        </Card>
        <Card style={{ marginTop: '0.7rem' }}>
          <KVRow label="Name" value={user?.full_name || '—'} />
          <KVRow label="Email" value={user?.email || '—'} />
          <KVRow label="Role" value={(user?.roles || [user?.role]).filter(Boolean).join(', ') || '—'} />
        </Card>
      </Section>

      <Section title="Capabilities" subtitle={`${enabledCaps.length} enabled`}>
        <Card>
          <ul className="m-simple-list">
            {enabledCaps.map((capability) => <li key={capability}>{capability}</li>)}
          </ul>
        </Card>
      </Section>

      <Section title="Quick Actions" subtitle="Switch views or sign out without losing your place.">
        <div className="m-inline-actions">
          <Link className="m-link-btn" to="/m/home">Mobile Dashboard</Link>
          <Link className="m-link-btn" to="/">Desktop View</Link>
          <button type="button" className="m-secondary-btn" onClick={logout}>Logout</button>
        </div>
      </Section>

      {tutorialEnabled ? (
        <Section title={tutorialPolicy.academyLabel} subtitle="Replay guided onboarding or reopen tutorial help from mobile.">
          <div className="m-inline-actions">
            <button type="button" className="m-link-btn" onClick={() => openTutorialModal()}>Start Guided Tour</button>
            <Link className="m-link-btn" to={tutorialHelpPath}>{tutorialPolicy.helpLabel}</Link>
            <button type="button" className="m-secondary-btn" onClick={resetTutorial}>{tutorialPolicy.resetLabel}</button>
          </div>
        </Section>
      ) : null}
    </MobileLayout>
  )
}
