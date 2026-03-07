import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import useIsMobile from './useIsMobile'
import { isPublicDesktopRoute, resolveMobileTarget } from './routing'

export default function MobileAutoRedirect() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, initialising } = useAuth()
  const isMobile = useIsMobile()

  useEffect(() => {
    if (initialising || !user || !isMobile) return

    const pathname = location.pathname
    if (isPublicDesktopRoute(pathname)) return

    const target = resolveMobileTarget(pathname)
    if (!target || target === pathname) return

    navigate(target, { replace: true })
  }, [initialising, isMobile, location.pathname, navigate, user])

  return null
}
