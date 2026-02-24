import api from './client'

export async function fetchMyLeave() {
  const { data } = await api.get('/api/leave/my')
  return data
}

export async function fetchLeaveInbox() {
  const { data } = await api.get('/api/leave/inbox')
  return data
}

export async function requestLeave(payload) {
  const { data } = await api.post('/api/leave/request', payload)
  return data
}

export async function approveLeave(id) {
  const { data } = await api.post(`/api/leave/${id}/approve`)
  return data
}

export async function rejectLeave(id, comment) {
  const { data } = await api.post(`/api/leave/${id}/reject`, null, {
    params: { comment },
  })
  return data
}
