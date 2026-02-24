import api from './client'

export async function getSummary({ refresh = false } = {}) {
  const { data } = await api.get('/v1/admin/billing-monitor/summary', {
    params: refresh ? { refresh: true } : undefined,
  })
  return data
}

export async function getAccountDetail(externalKey, { refresh = false } = {}) {
  const encoded = encodeURIComponent(externalKey)
  const { data } = await api.get(`/v1/admin/billing-monitor/account/${encoded}`, {
    params: refresh ? { refresh: true } : undefined,
  })
  return data
}
