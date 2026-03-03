import api from './client'

function buildAttendanceParams({ userId, fromDate, toDate } = {}) {
  const params = {}
  if (userId) params.user_id = userId
  if (fromDate) params.from_date = fromDate
  if (toDate) params.to_date = toDate
  return params
}

export async function fetchAttendance({ userId, fromDate, toDate } = {}) {
  const { data } = await api.get('/api/attendance', {
    params: buildAttendanceParams({ userId, fromDate, toDate }),
  })
  return data
}

export async function exportAttendanceCsv({ userId, fromDate, toDate } = {}) {
  const response = await api.get('/api/attendance/export', {
    params: buildAttendanceParams({ userId, fromDate, toDate }),
    responseType: 'blob',
  })
  return response.data
}
