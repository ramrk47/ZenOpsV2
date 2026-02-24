import React from 'react'
import { Outlet } from 'react-router-dom'
import AppShell from './AppShell'
import PartnerSidebar from '../sidebars/PartnerSidebar'
import WhatsAppBubble from '../WhatsAppBubble'

export default function PartnerLayout() {
  return (
    <AppShell sidebar={<PartnerSidebar />} showCommandPalette={false}>
      <Outlet />
      <WhatsAppBubble />
    </AppShell>
  )
}
