import React from 'react'

export default function Drawer({ open, onClose, children, ariaLabel = 'Drawer' }) {
  if (!open) return null
  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="drawer-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </aside>
    </div>
  )
}
