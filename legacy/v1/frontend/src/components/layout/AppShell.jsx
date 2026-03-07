import React from 'react'
import Navbar from '../Navbar'
import CommandPalette from '../CommandPalette'
import DemoMarker from '../DemoMarker'

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
          {children}
        </div>
      </main>
      {showCommandPalette ? <CommandPalette /> : null}
    </div>
  )
}
