import React from 'react'

export function Card({ children, className = '' }) {
  return <article className={`m-card ${className}`.trim()}>{children}</article>
}

export function Section({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`m-section ${className}`.trim()}>
      {(title || subtitle || action) ? (
        <header className="m-section-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action ? <div className="m-section-action">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export function Chip({ active, onClick, children, type = 'button' }) {
  return (
    <button
      type={type}
      className={`m-chip ${active ? 'active' : ''}`.trim()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function KVRow({ label, value }) {
  return (
    <div className="m-kv-row">
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
    </div>
  )
}

export function StickyFooter({ children }) {
  return <footer className="m-sticky-footer">{children}</footer>
}

export function BottomSheet({ open, title, onClose, children }) {
  if (!open) return null
  return (
    <div className="m-sheet-overlay" role="presentation" onClick={onClose}>
      <div className="m-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{title}</h3>
          <button type="button" className="m-link-btn" onClick={onClose}>Close</button>
        </header>
        <div>{children}</div>
      </div>
    </div>
  )
}

export function SearchBar({ value, onChange, placeholder = 'Search' }) {
  return (
    <div className="m-search">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value ? (
        <button type="button" className="m-link-btn" onClick={() => onChange('')}>
          Clear
        </button>
      ) : null}
    </div>
  )
}

export function MobileListSkeleton({ rows = 5 }) {
  return (
    <div className="m-skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="m-skeleton-item" />
      ))}
    </div>
  )
}

export function MobileEmptyState({ title, body, action }) {
  return (
    <div className="m-empty">
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  )
}
