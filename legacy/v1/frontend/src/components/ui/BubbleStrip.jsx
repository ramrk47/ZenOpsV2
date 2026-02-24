import React from 'react'
import { useNavigate } from 'react-router-dom'
import Tooltip from './Tooltip'

export default function BubbleStrip({ items = [], className = '' }) {
  const navigate = useNavigate()

  return (
    <div className={`nav-bubbles ${className}`.trim()}>
      {items.map((bubble) => (
        <Tooltip key={bubble.key} content={bubble.tooltip}>
          <button
            type="button"
            className={`bubble ${bubble.enabled ? '' : 'disabled'}`.trim()}
            onClick={() => {
              if (!bubble.enabled) return
              navigate(bubble.to)
            }}
            disabled={!bubble.enabled}
            aria-label={bubble.label}
            aria-disabled={!bubble.enabled}
          >
            <span className="bubble-icon">{bubble.icon}</span>
            <span className="bubble-label">{bubble.label}</span>
            {bubble.count > 0 ? <span className="bubble-badge">{bubble.count}</span> : null}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}
