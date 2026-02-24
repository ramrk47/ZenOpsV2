import api from './client'

export async function fetchActivity(params = {}) {
  const { data } = await api.get('/api/activity', { params })
  return data
}
