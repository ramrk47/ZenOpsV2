import api from './client'

export async function fetchPartnerCommissions(params = {}) {
  const { data } = await api.get('/api/partner/commissions', { params })
  return data
}

export async function fetchPartnerCommission(id) {
  const { data } = await api.get(`/api/partner/commissions/${id}`)
  return data
}

export async function createPartnerCommission(payload) {
  const { data } = await api.post('/api/partner/commissions', payload)
  return data
}

export async function updatePartnerCommission(id, payload) {
  const { data } = await api.patch(`/api/partner/commissions/${id}`, payload)
  return data
}

export async function submitPartnerCommission(id) {
  const { data } = await api.post(`/api/partner/commissions/${id}/submit`)
  return data
}

export async function uploadPartnerCommissionDocument(id, { file, category }) {
  const formData = new FormData()
  formData.append('file', file)
  if (category) formData.append('category', category)
  const { data } = await api.post(`/api/partner/commissions/${id}/uploads`, formData)
  return data
}

export async function fetchPartnerRequests(params = {}) {
  const { data } = await api.get('/api/partner/requests', { params })
  return data
}

export async function respondPartnerRequest(id, payload) {
  const { data } = await api.post(`/api/partner/requests/${id}/respond`, payload)
  return data
}

export async function uploadPartnerRequestAttachment(id, { file, category, message }) {
  const formData = new FormData()
  formData.append('file', file)
  if (category) formData.append('category', category)
  if (message) formData.append('message', message)
  const { data } = await api.post(`/api/partner/requests/${id}/uploads`, formData)
  return data
}

export async function fetchPartnerRequestAttachments(id) {
  const { data } = await api.get(`/api/partner/requests/${id}/attachments`)
  return data
}

export async function fetchPartnerAssignments() {
  const { data } = await api.get('/api/partner/assignments')
  return data
}

export async function fetchPartnerAssignment(id) {
  const { data } = await api.get(`/api/partner/assignments/${id}`)
  return data
}

export async function fetchPartnerInvoices() {
  const { data } = await api.get('/api/partner/invoices')
  return data
}

export async function fetchPartnerInvoice(id) {
  const { data } = await api.get(`/api/partner/invoices/${id}`)
  return data
}

export async function fetchPartnerDeliverables(assignmentId) {
  const { data } = await api.get(`/api/partner/assignments/${assignmentId}/deliverables`)
  return data
}

export async function downloadPartnerDeliverable(deliverableId) {
  const response = await api.get(`/api/partner/deliverables/${deliverableId}/download`, { responseType: 'blob' })
  return response.data
}

export async function fetchPartnerProfile() {
  const { data } = await api.get('/api/partner/profile')
  return data
}

export async function fetchPartnerNotifications(params = {}) {
  const { data } = await api.get('/api/partner/notifications', { params })
  return data
}

export async function fetchPartnerNotificationUnreadCount() {
  const { data } = await api.get('/api/partner/notifications/unread-count')
  return data
}

export async function markPartnerNotificationRead(id) {
  const { data } = await api.post(`/api/partner/notifications/${id}/read`)
  return data
}

export async function markAllPartnerNotificationsRead() {
  const { data } = await api.post('/api/partner/notifications/read-all')
  return data
}
