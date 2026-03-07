import { useMemo } from 'react'
import { hasCapability, isPartner } from '../utils/rbac'

function makeTab(key, label, to) {
  return { key, label, to }
}

export default function useMobileTabs({ user, capabilities }) {
  return useMemo(() => {
    const canCreate = hasCapability(capabilities, 'create_assignment') || hasCapability(capabilities, 'create_assignment_draft')
    const canApprove = hasCapability(capabilities, 'approve_actions')
    const canViewInvoices = hasCapability(capabilities, 'view_invoices')
    const partnerMode = isPartner(user)

    const tabs = [makeTab('home', 'Home', '/m/home'), makeTab('assignments', 'Assignments', '/m/assignments')]

    if (partnerMode) {
      if (canCreate) {
        tabs.push(makeTab('create', 'Request', '/m/request/new'))
      }
      tabs.push(makeTab('uploads', 'Uploads', '/m/uploads'))
      tabs.push(makeTab('notifications', 'Alerts', '/m/notifications'))
      tabs.push(makeTab('profile', 'Profile', '/m/profile'))
      return tabs
    }

    if (canCreate) {
      tabs.push(makeTab('create', 'Create', '/m/create'))
    }

    if (canApprove) {
      tabs.push(makeTab('approvals', 'Approvals', '/m/approvals'))
    }

    if (canViewInvoices) {
      tabs.push(makeTab('invoices', 'Invoices', '/m/invoices'))
    }

    tabs.push(makeTab('notifications', 'Alerts', '/m/notifications'))
    tabs.push(makeTab('profile', 'Profile', '/m/profile'))
    return tabs
  }, [capabilities, user])
}
