export const Capabilities = {
  masterDataRead: 'masterdata.read',
  masterDataWrite: 'masterdata.write',
  masterDataApprove: 'masterdata.approve',
  employeesRead: 'employees.read',
  employeesWrite: 'employees.write',
  attendanceRead: 'attendance.read',
  attendanceWrite: 'attendance.write',
  assignmentsTransition: 'assignments.transition',
  tasksRead: 'tasks.read',
  tasksWrite: 'tasks.write',
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
    Capabilities.masterDataRead,
    Capabilities.masterDataWrite,
    Capabilities.employeesRead,
    Capabilities.attendanceRead,
    Capabilities.attendanceWrite,
    Capabilities.assignmentsTransition,
    Capabilities.tasksRead,
    Capabilities.tasksWrite,
    Capabilities.notificationsRoutesRead,
    Capabilities.notificationsSend,
    Capabilities.invoicesRead
  ],
  valuer: [Capabilities.attendanceWrite, Capabilities.masterDataRead],
  accounts: [
    Capabilities.masterDataRead,
    Capabilities.tasksRead,
    Capabilities.payrollRead,
    Capabilities.payrollWrite,
    Capabilities.payrollRun,
    Capabilities.invoicesRead,
    Capabilities.invoicesWrite
  ],
  hr: [
    Capabilities.masterDataRead,
    Capabilities.employeesRead,
    Capabilities.employeesWrite,
    Capabilities.attendanceRead,
    Capabilities.attendanceWrite,
    Capabilities.tasksRead,
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
