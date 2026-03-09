import React from 'react'
import Navbar from '../Navbar'
import CommandPalette from '../CommandPalette'
import DemoMarker from '../DemoMarker'
import DemoOnboardingModal from '../../demo/tutorial/DemoOnboardingModal.jsx'
import DemoCoachmarkLayer from '../../demo/tutorial/DemoCoachmarkLayer.jsx'
import DemoTutorialLauncher from '../../demo/tutorial/DemoTutorialLauncher.jsx'

export default function AppShell({ children, sidebar, showCommandPalette = true }) {
  const sidebarContent = sidebar || <Navbar />

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        {sidebarContent}
      </aside>
      <main className="app-main">
        <div className="page">
          <DemoMarker variant="banner" className="demo-marker--app" />
          <DemoTutorialLauncher className="tutorial-launcher--desktop" />
          <DemoOnboardingModal />
          <DemoCoachmarkLayer />
          {children}
        </div>
      </main>
      {showCommandPalette ? <CommandPalette /> : null}
    </div>
  )
}
