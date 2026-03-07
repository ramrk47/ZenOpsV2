import { matchPath } from 'react-router-dom'

export function resolveMobileTarget(pathname) {
  const assignmentMatch = matchPath('/assignments/:id', pathname)
  if (assignmentMatch?.params?.id) {
    return `/m/assignments/${assignmentMatch.params.id}`
  }

  const supportedRoutes = new Map([
    ['/', '/m/home'],
    ['/account', '/m/home'],
    ['/partner', '/m/home'],
    ['/admin/dashboard', '/m/home'],
    ['/assignments', '/m/assignments'],
    ['/admin/open-queue', '/m/assignments'],
    ['/partner/requests', '/m/assignments'],
    ['/partner/requests/new', '/m/request/new'],
    ['/assignments/new', '/m/create'],
    ['/partner/assignments/new', '/m/create'],
    ['/notifications', '/m/notifications'],
    ['/admin/approvals', '/m/approvals'],
    ['/invoices', '/m/invoices'],
  ])

  return supportedRoutes.get(pathname) || null
}

export function isPublicDesktopRoute(pathname) {
  return pathname.startsWith('/login')
    || pathname.startsWith('/m')
    || pathname.startsWith('/partner/request-access')
    || pathname.startsWith('/partner/verify')
    || pathname.startsWith('/invite/accept')
}
