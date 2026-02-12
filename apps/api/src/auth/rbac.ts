export const Capabilities = {
  employeesRead: 'employees.read',
  employeesWrite: 'employees.write',
  attendanceRead: 'attendance.read',
  attendanceWrite: 'attendance.write',
  payrollRead: 'payroll.read',
  payrollWrite: 'payroll.write',
  payrollRun: 'payroll.run',
  notificationsRoutesRead: 'notifications.routes.read',
  notificationsRoutesWrite: 'notifications.routes.write',
  notificationsSend: 'notifications.send',
  invoicesRead: 'invoices.read',
  invoicesWrite: 'invoices.write'
} as const;

export const RoleCapabilities: Record<string, string[]> = {
  super_admin: Object.values(Capabilities),
  ops_manager: [
    Capabilities.employeesRead,
    Capabilities.attendanceRead,
    Capabilities.attendanceWrite,
    Capabilities.notificationsRoutesRead,
    Capabilities.notificationsSend,
    Capabilities.invoicesRead
  ],
  valuer: [Capabilities.attendanceWrite],
  accounts: [
    Capabilities.payrollRead,
    Capabilities.payrollWrite,
    Capabilities.payrollRun,
    Capabilities.invoicesRead,
    Capabilities.invoicesWrite
  ],
  hr: [
    Capabilities.employeesRead,
    Capabilities.employeesWrite,
    Capabilities.attendanceRead,
    Capabilities.attendanceWrite,
    Capabilities.payrollRead
  ],
  portal_user: []
};

export const expandCapabilitiesFromRoles = (roles: string[]): string[] => {
  const expanded = new Set<string>();
  for (const role of roles) {
    const capabilities = RoleCapabilities[role] ?? [];
    for (const capability of capabilities) {
      expanded.add(capability);
    }
  }
  return [...expanded];
};
