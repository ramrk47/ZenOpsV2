import React, { useMemo } from 'react'
import { Link, matchPath, useLocation } from 'react-router-dom'
import useIsMobile from './useIsMobile'
import { useAuth } from '../auth/AuthContext'

function resolveTarget(pathname) {
  const assignmentMatch = matchPath('/assignments/:id', pathname)
  if (assignmentMatch?.params?.id) {
    return `/m/assignments/${assignmentMatch.params.id}`
  }
  return '/m/home'
}

export default function MobileModeBanner() {
  const location = useLocation()
  const { user } = useAuth()
  const isMobile = useIsMobile()

  const hidden = useMemo(() => {
    const path = location.pathname
    if (!user || !isMobile) return true
    if (path.startsWith('/m')) return true
    if (path.startsWith('/login')) return true
    if (path.startsWith('/partner/request-access')) return true
    if (path.startsWith('/invite/accept')) return true
    return false
  }, [isMobile, location.pathname, user])

  if (hidden) return null

  return (
    <div className="m-mode-banner" role="status">
      <span>Mobile mode is available for faster on-the-go workflows.</span>
      <Link to={resolveTarget(location.pathname)}>Open Mobile Mode</Link>
    </div>
  )
}
