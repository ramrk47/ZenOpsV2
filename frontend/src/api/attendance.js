import api from './client'

export async function fetchAttendance({ userId, fromDate, toDate } = {}) {
  const params = new URLSearchParams()
  if (userId) params.set('user_id', userId)
  if (fromDate) params.set('from_date', fromDate)
  if (toDate) params.set('to_date', toDate)
  const res = await api.get(`/api/attendance?${params}`)
  return res.data
}

export function exportAttendanceCsvUrl({ userId, fromDate, toDate } = {}) {
  const params = new URLSearchParams()
  if (userId) params.set('user_id', userId)
  if (fromDate) params.set('from_date', fromDate)
  if (toDate) params.set('to_date', toDate)
  return `/api/attendance/export?${params}`
}
