import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import HomeScreen from './screens/HomeScreen'
import AssignmentsScreen from './screens/AssignmentsScreen'
import AssignmentDetailScreen from './screens/AssignmentDetailScreen'
import CreateAssignmentScreen from './screens/CreateAssignmentScreen'
import UploadsScreen from './screens/UploadsScreen'
import ApprovalsScreen from './screens/ApprovalsScreen'
import InvoicesScreen from './screens/InvoicesScreen'
import NotificationsScreen from './screens/NotificationsScreen'
import ProfileScreen from './screens/ProfileScreen'
import SearchScreen from './screens/SearchScreen'
import './mobile.css'

export default function MobileApp() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="home" replace />} />
      <Route path="home" element={<HomeScreen />} />
      <Route path="assignments" element={<AssignmentsScreen />} />
      <Route path="assignments/:id" element={<AssignmentDetailScreen />} />
      <Route path="assignments/:id/uploads" element={<UploadsScreen />} />
      <Route path="create" element={<CreateAssignmentScreen />} />
      <Route path="approvals" element={<ApprovalsScreen />} />
      <Route path="invoices" element={<InvoicesScreen />} />
      <Route path="notifications" element={<NotificationsScreen />} />
      <Route path="profile" element={<ProfileScreen />} />
      <Route path="search" element={<SearchScreen />} />
      <Route path="uploads" element={<UploadsScreen />} />
      <Route path="*" element={<Navigate to="home" replace />} />
    </Routes>
  )
}
