import React from 'react'
import { Outlet } from 'react-router-dom'
import AppShell from './AppShell'
import EmployeeSidebar from '../sidebars/EmployeeSidebar'
import AdminSidebar from '../sidebars/AdminSidebar'
import { useAuth } from '../../auth/AuthContext'
import { canSeeAdmin } from '../../utils/rbac'

export default function EmployeeLayout() {
  const { capabilities } = useAuth()
  const showAdminSidebar = canSeeAdmin(capabilities)
  return (
    <AppShell sidebar={showAdminSidebar ? <AdminSidebar /> : <EmployeeSidebar />}>
      <Outlet />
    </AppShell>
  )
}
