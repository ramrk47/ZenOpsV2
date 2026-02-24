import api from './client'

export async function fetchSourceIntel(params = {}) {
  const { data } = await api.get('/api/analytics/source-intel', { params })
  return data
}

export async function fetchBankAnalytics(params = {}) {
  const { data } = await api.get('/api/analytics/banks', { params })
  return data
}

export async function fetchServiceLineAnalytics(params = {}) {
  const { data } = await api.get('/api/analytics/service-lines', { params })
  return data
}

export async function fetchCaseTypeAnalytics(params = {}) {
  const { data } = await api.get('/api/analytics/case-types', { params })
  return data
}

export async function fetchAnalyticsSettings() {
  const { data } = await api.get('/api/analytics/settings')
  return data
}

export async function updateAnalyticsSettings(payload) {
  const { data } = await api.patch('/api/analytics/settings', payload)
  return data
}

export async function fetchAnalyticsSignals(params = {}) {
  const { data } = await api.get('/api/analytics/signals', { params })
  return data
}

export async function fetchFollowUpTasks(params = {}) {
  const { data } = await api.get('/api/analytics/follow-ups', { params })
  return data
}

export async function updateFollowUpTask(taskId, payload) {
  const { data } = await api.patch(`/api/analytics/follow-ups/${taskId}`, payload)
  return data
}

export async function fetchRelationshipLogs(params = {}) {
  const { data } = await api.get('/api/analytics/relationship-logs', { params })
  return data
}

export async function createRelationshipLog(payload) {
  const { data } = await api.post('/api/analytics/relationship-logs', payload)
  return data
}

export async function fetchForecastV2(params = {}) {
  const { data } = await api.get('/api/analytics/forecast-v2', { params })
  return data
}

export async function fetchWeeklyDigest(params = {}) {
  const { data } = await api.get('/api/analytics/weekly-digest', { params })
  return data
}

export async function createVisitReminder(payload) {
  const { data } = await api.post('/api/analytics/visit-reminders', payload)
  return data
}

export async function exportAnalyticsPdf(params = {}) {
  const { data } = await api.get('/api/analytics/export.pdf', { params, responseType: 'blob' })
  return data
}

export async function fetchPartnerSummary() {
  const { data } = await api.get('/api/analytics/partners/summary')
  return data
}

export async function fetchPartnerBankBreakdown(partnerId) {
  const { data } = await api.get(`/api/analytics/partners/${partnerId}/bank-branch`)
  return data
}
