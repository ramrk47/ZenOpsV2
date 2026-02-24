import React from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAuth } from './auth/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import AdminLayout from './components/layout/AdminLayout.jsx'
import EmployeeLayout from './components/layout/EmployeeLayout.jsx'
import PartnerLayout from './components/layout/PartnerLayout.jsx'
import Login from './pages/Login'
import PartnerRequestAccess from './pages/PartnerRequestAccess'
import Account from './pages/Account'
import Assignments from './pages/Assignments'
import NewAssignment from './pages/NewAssignment'
import AssignmentDetail from './pages/AssignmentDetail'
import MobileCockpit from './pages/mobile/MobileCockpit.jsx'
import MobileAssignmentDetail from './pages/mobile/MobileAssignmentDetail.jsx'
import CalendarPage from './pages/CalendarPage.jsx'
import NotificationsPage from './pages/NotificationsPage.jsx'
import InvoicesPage from './pages/InvoicesPage.jsx'
import RequestsPage from './pages/RequestsPage.jsx'
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import AdminPersonnel from './pages/admin/AdminPersonnel.jsx'
import AdminWorkload from './pages/admin/AdminWorkload.jsx'
import AdminApprovals from './pages/admin/AdminApprovals.jsx'
import AdminMasterData from './pages/admin/AdminMasterData.jsx'
import AdminCompanyAccounts from './pages/admin/AdminCompanyAccounts.jsx'
import AdminActivity from './pages/admin/AdminActivity.jsx'
import AdminOpenQueue from './pages/admin/AdminOpenQueue.jsx'
import AdminAnalytics from './pages/admin/AdminAnalytics.jsx'
import AdminAttendance from './pages/admin/AdminAttendance.jsx'
import AdminBackups from './pages/admin/AdminBackups.jsx'
import BillingMonitor from './pages/admin/BillingMonitor.jsx'
import AdminPartnerDetail from './pages/admin/AdminPartnerDetail.jsx'
import AdminNotificationDeliveries from './pages/admin/AdminNotificationDeliveries.jsx'
import AdminPartnerRequests from './pages/admin/AdminPartnerRequests.jsx'
import PayrollRuns from './pages/admin/PayrollRuns.jsx'
import PayrollRunDetail from './pages/admin/PayrollRunDetail.jsx'
import PayrollEmployees from './pages/admin/PayrollEmployees.jsx'
import PayrollReports from './pages/admin/PayrollReports.jsx'
import SupportInbox from './pages/admin/SupportInbox.jsx'
import AdminSystemConfig from './pages/admin/AdminSystemConfig.jsx'
import PartnerHome from './pages/partner/PartnerHome.jsx'
import PartnerRequests from './pages/partner/PartnerRequests.jsx'
import PartnerRequestNew from './pages/partner/PartnerRequestNew.jsx'
import PartnerRequestDetail from './pages/partner/PartnerRequestDetail.jsx'
import PartnerPayments from './pages/partner/PartnerPayments.jsx'
import PartnerNotifications from './pages/partner/PartnerNotifications.jsx'
import PartnerProfile from './pages/partner/PartnerProfile.jsx'
import PartnerHelp from './pages/partner/PartnerHelp.jsx'
import Forbidden from './pages/Forbidden.jsx'
import { canSeeAdmin, hasCapability, isPartner, resolveHomeRoute } from './utils/rbac.js'

function RequireCapability({ children, capability }) {
  const { user, capabilities, initialising } = useAuth()
  if (initialising) {
    return <div style={{ padding: '2rem' }}>Loading…</div>
  }
  if (!user) return <Navigate to="/login" replace />
  if (isPartner(user)) return <Forbidden />
  if (!hasCapability(capabilities, capability)) {
    return <Forbidden />
  }
  return children
}

function RequireAuthenticated({ children }) {
  const { user, initialising } = useAuth()
  if (initialising) {
    return <div style={{ padding: '2rem' }}>Loading…</div>
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RequirePartnerArea({ children }) {
  const { user, initialising } = useAuth()
  if (initialising) {
    return <div style={{ padding: '2rem' }}>Loading…</div>
  }
  if (!user) return <Navigate to="/login" replace />
  if (!isPartner(user)) return <Forbidden />
  return children
}

function RequireEmployeeArea({ children }) {
  const { user, initialising } = useAuth()
  if (initialising) {
    return <div style={{ padding: '2rem' }}>Loading…</div>
  }
  if (!user) return <Navigate to="/login" replace />
  if (isPartner(user)) return <Forbidden />
  return children
}

function RequireAdminArea({ children }) {
  const { user, capabilities, initialising } = useAuth()
  if (initialising) {
    return <div style={{ padding: '2rem' }}>Loading…</div>
  }
  if (!user) return <Navigate to="/login" replace />
  if (isPartner(user)) return <Forbidden />
  if (!canSeeAdmin(capabilities)) return <Forbidden />
  return children
}

function InternalLayoutSwitch() {
  const { capabilities } = useAuth()
  if (canSeeAdmin(capabilities)) return <AdminLayout />
  return <EmployeeLayout />
}

function MobileAssignmentRedirect() {
  const { id } = useParams()
  return <Navigate to={`/m/assignments/${id}`} replace />
}

export default function App() {
  const { user, capabilities } = useAuth()
  const homeRoute = resolveHomeRoute(user, capabilities)
  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/partner/request-access" element={<PartnerRequestAccess />} />
      <Route
        path="/m"
        element={(
          <RequireAuthenticated>
            <MobileCockpit />
          </RequireAuthenticated>
        )}
      />
      <Route
        path="/m/assignments/:id"
        element={(
          <RequireAuthenticated>
            <MobileAssignmentDetail />
          </RequireAuthenticated>
        )}
      />
      <Route path="/mobile" element={<Navigate to="/m" replace />} />
      <Route path="/mobile/assignments/:id" element={<MobileAssignmentRedirect />} />

      <Route element={(
        <RequireEmployeeArea>
          <InternalLayoutSwitch />
        </RequireEmployeeArea>
      )}
      >
        <Route path="/account" element={<Account />} />

        <Route path="/assignments" element={<Assignments />} />

        <Route path="/assignments/new" element={<NewAssignment />} />

        <Route path="/assignments/:id" element={<AssignmentDetail />} />

        <Route path="/calendar" element={<CalendarPage />} />

        <Route path="/notifications" element={<NotificationsPage />} />

        <Route path="/invoices" element={<InvoicesPage />} />

        <Route path="/requests" element={<RequestsPage />} />

        <Route
          path="/admin/dashboard"
          element={(
            <RequireAdminArea>
              <AdminDashboard />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/workload"
          element={(
            <RequireAdminArea>
              <AdminWorkload />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/approvals"
          element={(
            <RequireAdminArea>
              <AdminApprovals />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/open-queue"
          element={(
            <RequireAdminArea>
              <AdminOpenQueue />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/activity"
          element={(
            <RequireAdminArea>
              <AdminActivity />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/backups"
          element={(
            <RequireAdminArea>
              <AdminBackups />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/analytics"
          element={(
            <RequireAdminArea>
              <RequireCapability capability="view_analytics">
                <AdminAnalytics />
              </RequireCapability>
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/personnel"
          element={(
            <RequireAdminArea>
              <RequireCapability capability="manage_users">
                <AdminPersonnel />
              </RequireCapability>
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/partners/:id"
          element={(
            <RequireAdminArea>
              <RequireCapability capability="manage_users">
                <AdminPartnerDetail />
              </RequireCapability>
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/masterdata"
          element={(
            <RequireAdminArea>
              <RequireCapability capability="manage_master_data">
                <AdminMasterData />
              </RequireCapability>
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/company"
          element={(
            <RequireAdminArea>
              <RequireCapability capability="manage_company_accounts">
                <AdminCompanyAccounts />
              </RequireCapability>
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/notification-deliveries"
          element={(
            <RequireAdminArea>
              <AdminNotificationDeliveries />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/attendance"
          element={(
            <RequireAdminArea>
              <AdminAttendance />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/partner-requests"
          element={(
            <RequireAdminArea>
              <AdminPartnerRequests />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/billing-monitor"
          element={(
            <RequireAdminArea>
              <BillingMonitor />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/payroll"
          element={(
            <RequireAdminArea>
              <PayrollRuns />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/payroll/runs/:id"
          element={(
            <RequireAdminArea>
              <PayrollRunDetail />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/payroll/employees"
          element={(
            <RequireAdminArea>
              <PayrollEmployees />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/payroll/reports"
          element={(
            <RequireAdminArea>
              <PayrollReports />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/support"
          element={(
            <RequireAdminArea>
              <SupportInbox />
            </RequireAdminArea>
          )}
        />
        <Route
          path="/admin/system-config"
          element={(
            <RequireAdminArea>
              <AdminSystemConfig />
            </RequireAdminArea>
          )}
        />
      </Route>

      <Route element={(
        <RequirePartnerArea>
          <PartnerLayout />
        </RequirePartnerArea>
      )}
      >
        <Route path="/partner" element={<PartnerHome />} />
        <Route path="/partner/requests" element={<PartnerRequests />} />
        <Route path="/partner/requests/new" element={<PartnerRequestNew />} />
        <Route path="/partner/requests/:id" element={<PartnerRequestDetail />} />
        <Route path="/partner/payments" element={<PartnerPayments />} />
        <Route path="/partner/notifications" element={<PartnerNotifications />} />
        <Route path="/partner/profile" element={<PartnerProfile />} />
        <Route path="/partner/help" element={<PartnerHelp />} />
      </Route>

      <Route path="/" element={<Navigate to={user ? homeRoute : '/login'} replace />} />
      <Route path="*" element={<Navigate to={user ? homeRoute : '/login'} replace />} />
    </Routes>
    </ErrorBoundary>
  )
}
