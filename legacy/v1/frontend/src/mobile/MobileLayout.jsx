import React from 'react'
import MobileHeader from './MobileHeader'
import MobileTabs from './MobileTabs'
import useMobileTabs from './useMobileTabs'
import { useAuth } from '../auth/AuthContext'

export default function MobileLayout({
  title,
  subtitle,
  primaryAction,
  secondaryAction,
  children,
}) {
  const { user, capabilities } = useAuth()
  const tabs = useMobileTabs({ user, capabilities })

  return (
    <div className="m-shell">
      <MobileHeader
        title={title}
        subtitle={subtitle}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
      />
      <main className="m-content">{children}</main>
      <MobileTabs tabs={tabs} />
    </div>
  )
}
