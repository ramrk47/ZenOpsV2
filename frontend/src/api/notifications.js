import api from './client'

export async function fetchNotifications(params = {}) {
  const { data } = await api.get('/api/notifications', { params })
  return data
}

export async function markNotificationRead(id) {
  const { data } = await api.post(`/api/notifications/${id}/read`)
  return data
}

export async function markAllNotificationsRead() {
  const { data } = await api.post('/api/notifications/read-all')
  return data
}

export async function fetchNotificationUnreadCount() {
  const { data } = await api.get('/api/notifications/unread-count')
  return data
}

export async function sweepNotifications() {
  const { data } = await api.post('/api/notifications/sweep')
  return data
}

export async function snoozeNotifications(payload) {
  const { data } = await api.post('/api/notifications/snooze', payload)
  return data
}

export async function fetchNotificationDeliveries(params = {}) {
  const { data } = await api.get('/api/notifications/deliveries', { params })
  return data
}
