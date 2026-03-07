import React, { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import useIsMobile from './useIsMobile'
import { useAuth } from '../auth/AuthContext'
import { isPublicDesktopRoute, resolveMobileTarget } from './routing'
import { isPartner } from '../utils/rbac'

export default function MobileModeBanner() {
  const location = useLocation()
  const { user } = useAuth()
  const isMobile = useIsMobile()
  const target = resolveMobileTarget(location.pathname)
  const partnerMode = isPartner(user)

  const hidden = useMemo(() => {
    const path = location.pathname
    if (!user || !isMobile) return true
    if (isPublicDesktopRoute(path)) return true
    if (!target) return true
    return false
  }, [isMobile, location.pathname, target, user])

  if (hidden) return null

  return (
    <div className="m-mode-banner" role="status">
      <span>{partnerMode ? 'Mobile mode is available for faster request updates and file sharing.' : 'Mobile mode is available for faster on-the-go workflows.'}</span>
      <Link to={target}>Open Mobile Mode</Link>
    </div>
  )
}
