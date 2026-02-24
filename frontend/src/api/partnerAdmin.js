import api from './client'

export async function fetchAdminCommissions(params = {}) {
  const { data } = await api.get('/api/admin/commissions', { params })
  return data
}

export async function fetchAdminCommission(id) {
  const { data } = await api.get(`/api/admin/commissions/${id}`)
  return data
}

export async function fetchAdminCommissionBillingStatus(id) {
  const { data } = await api.get(`/api/admin/commissions/${id}/billing-status`)
  return data
}

export async function approveAdminCommission(id, payload = {}) {
  const { data } = await api.post(`/api/admin/commissions/${id}/approve`, payload)
  return data
}

export async function rejectAdminCommission(id, payload = {}) {
  const { data } = await api.post(`/api/admin/commissions/${id}/reject`, payload)
  return data
}

export async function needsInfoAdminCommission(id, payload = {}) {
  const { data } = await api.post(`/api/admin/commissions/${id}/needs-info`, payload)
  return data
}
