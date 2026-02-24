import api from './client'

export async function fetchCalendarEvents(params = {}) {
  const { data } = await api.get('/api/calendar/events', { params })
  return data
}

export async function createCalendarEvent(payload) {
  const { data } = await api.post('/api/calendar/events', payload)
  return data
}

export async function updateCalendarEvent(id, payload) {
  const { data } = await api.patch(`/api/calendar/events/${id}`, payload)
  return data
}

export async function deleteCalendarEvent(id) {
  await api.delete(`/api/calendar/events/${id}`)
  return true
}
