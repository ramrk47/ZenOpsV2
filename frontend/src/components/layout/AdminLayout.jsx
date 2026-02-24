import React from 'react'
import { Outlet } from 'react-router-dom'
import AppShell from './AppShell'
import AdminSidebar from '../sidebars/AdminSidebar'

export default function AdminLayout() {
  return (
    <AppShell sidebar={<AdminSidebar />}>
      <Outlet />
    </AppShell>
  )
}
