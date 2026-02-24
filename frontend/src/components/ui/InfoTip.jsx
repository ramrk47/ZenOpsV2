import React from 'react'
import Tooltip from './Tooltip'

export default function InfoTip({ text }) {
  if (!text) return null
  return (
    <Tooltip content={text}>
      <button type="button" className="info-tip" aria-label={text}>
        i
      </button>
    </Tooltip>
  )
}
