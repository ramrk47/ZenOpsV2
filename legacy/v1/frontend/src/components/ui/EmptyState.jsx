import React from 'react'

export default function EmptyState({ children, title, body, action, icon, className = '' }) {
  const hasStructuredContent = title || body || action || icon
  if (!hasStructuredContent) {
    return <div className={`empty ${className}`.trim()}>{children}</div>
  }

  return (
    <div className={`empty ${className}`.trim()}>
      {icon ? <div className="empty-icon" aria-hidden="true">{icon}</div> : null}
      {title ? <strong className="empty-title">{title}</strong> : null}
      {body ? <p className="empty-body">{body}</p> : null}
      {children ? <div className="empty-extra">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}
