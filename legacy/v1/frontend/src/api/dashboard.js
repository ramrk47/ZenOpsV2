import api from './client'

export async function fetchDashboardOverview() {
  const { data } = await api.get('/api/dashboard/overview')
  return data
}

export async function fetchDashboardActivitySummary() {
  const { data } = await api.get('/api/dashboard/activity-summary')
  return data
}
