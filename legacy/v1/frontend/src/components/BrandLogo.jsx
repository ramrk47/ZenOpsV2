import React from 'react'
import markSrc from '../assets/brand/maulya-mark.png'
import wordmarkSrc from '../assets/brand/maulya-wordmark.png'

export default function BrandLogo({
  variant = 'sidebar',
  showCredit = false,
  className = '',
}) {
  return (
    <div className={`brand-lockup brand-lockup--${variant} ${className}`.trim()}>
      <img className="brand-lockup__mark" src={markSrc} alt="" aria-hidden="true" />
      <div className="brand-lockup__meta">
        <img className="brand-lockup__wordmark" src={wordmarkSrc} alt="Maulya" />
        {showCredit ? <div className="brand-credit">by Not Alone Studios</div> : null}
      </div>
    </div>
  )
}
