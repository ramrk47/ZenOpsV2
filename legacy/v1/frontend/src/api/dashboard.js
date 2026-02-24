import api from './client'

export async function fetchDashboardOverview() {
  const { data } = await api.get('/api/dashboard/overview')
  return data
}
