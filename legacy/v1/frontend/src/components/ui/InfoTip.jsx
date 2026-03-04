import React from 'react'
import Tooltip from './Tooltip'

export default function InfoTip({ text, as = 'button' }) {
  if (!text) return null
  const useSpan = as === 'span'
  const stopEvent = (event) => event.stopPropagation()
  return (
    <Tooltip content={text}>
      {useSpan ? (
        <span
          className="info-tip"
          aria-label={text}
          role="note"
          tabIndex={0}
          onClick={stopEvent}
          onMouseDown={stopEvent}
          onKeyDown={stopEvent}
        >
          i
        </span>
      ) : (
        <button
          type="button"
          className="info-tip"
          aria-label={text}
          onClick={stopEvent}
          onMouseDown={stopEvent}
        >
          i
        </button>
      )}
    </Tooltip>
  )
}
