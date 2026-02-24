import React, { useEffect, useId, useMemo, useRef, useState } from 'react'

function chainHandlers(primary, secondary) {
  if (!primary) return secondary
  if (!secondary) return primary
  return (event) => {
    primary(event)
    secondary(event)
  }
}

export default function Tooltip({ content, children, className = '', placement = 'top' }) {
  const reactId = useId()
  const tooltipId = useMemo(() => `tooltip-${reactId.replace(/:/g, '')}`, [reactId])
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const tooltipRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!content) return children

  if (!React.isValidElement(children)) {
    return <span>{children}</span>
  }

  function handleTriggerLeave(event) {
    const next = event.relatedTarget
    if (tooltipRef.current && tooltipRef.current.contains(next)) return
    setOpen(false)
  }

  function handleTooltipLeave(event) {
    const next = event.relatedTarget
    if (triggerRef.current && triggerRef.current.contains(next)) return
    setOpen(false)
  }

  const triggerProps = {
    'aria-describedby': tooltipId,
    onMouseEnter: chainHandlers(() => setOpen(true), children.props.onMouseEnter),
    onMouseLeave: chainHandlers(handleTriggerLeave, children.props.onMouseLeave),
    onFocus: chainHandlers(() => setOpen(true), children.props.onFocus),
    onBlur: chainHandlers(() => setOpen(false), children.props.onBlur),
    onKeyDown: chainHandlers((event) => {
      if (event.key === 'Escape') setOpen(false)
    }, children.props.onKeyDown),
    ref: triggerRef,
  }

  return (
    <span className={`tooltip-anchor ${className}`.trim()}>
      {React.cloneElement(children, triggerProps)}
      <span
        id={tooltipId}
        role="tooltip"
        className={`tooltip-bubble ${open ? 'open' : ''} placement-${placement}`.trim()}
        aria-hidden={!open}
        ref={tooltipRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={handleTooltipLeave}
      >
        {content}
      </span>
    </span>
  )
}
