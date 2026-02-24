export const PARTNER_ROLE = 'EXTERNAL_PARTNER'
export const ADMIN_ROLES = ['ADMIN', 'OPS_MANAGER', 'HR', 'FINANCE']
export const EMPLOYEE_ROLES = ['ASSISTANT_VALUER', 'FIELD_VALUER', 'EMPLOYEE']

export function getUserRoles(user) {
  if (!user) return []
  if (Array.isArray(user.roles) && user.roles.length) return user.roles
  if (user.role) return [user.role]
  return []
}

export function userHasRole(user, role) {
  return getUserRoles(user).includes(role)
}

export function userHasAnyRole(user, roles) {
  const userRoles = new Set(getUserRoles(user))
  return roles.some((role) => userRoles.has(role))
}

export function hasCapability(capabilities, key) {
  if (!capabilities) return false
  return Boolean(capabilities[key])
}

export function canManageUsers(capabilities) {
  return hasCapability(capabilities, 'manage_users')
}

export function canManageMasterData(capabilities) {
  return hasCapability(capabilities, 'manage_master_data')
}

export function canManageCompanyAccounts(capabilities) {
  return hasCapability(capabilities, 'manage_company_accounts')
}

export function canSeeAdmin(capabilities) {
  if (!capabilities) return false
  return Boolean(
    capabilities.view_all_assignments ||
    capabilities.manage_master_data ||
    capabilities.manage_users ||
    capabilities.manage_company_accounts ||
    capabilities.approve_actions,
  )
}

export function canViewAnalytics(capabilities) {
  return hasCapability(capabilities, 'view_analytics')
}

export function isPartner(user) {
  return userHasRole(user, PARTNER_ROLE)
}

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role)
}

export function isEmployeeRole(role) {
  return EMPLOYEE_ROLES.includes(role)
}

export function resolveHomeRoute(user, capabilities) {
  if (!user) return '/login'
  if (isPartner(user)) return '/partner'
  if (canSeeAdmin(capabilities) || userHasAnyRole(user, ADMIN_ROLES)) return '/admin/dashboard'
  return '/account'
}
