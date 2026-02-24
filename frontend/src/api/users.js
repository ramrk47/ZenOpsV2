import api from './client'

export async function fetchUsers(params = {}) {
  const { data } = await api.get('/api/auth/users', { params })
  return data
}

export async function fetchUserDirectory({ includeInactive = false } = {}) {
  const { data } = await api.get('/api/auth/users/directory', {
    params: { include_inactive: includeInactive || undefined },
  })
  return data
}

export async function createUser(payload) {
  const { data } = await api.post('/api/auth/users', payload)
  return data
}

export async function updateUser(id, payload) {
  const { data } = await api.patch(`/api/auth/users/${id}`, payload)
  return data
}

export async function resetPassword(id, password) {
  const { data } = await api.post(`/api/auth/users/${id}/reset-password`, { password })
  return data
}

export async function updateMyProfile(payload) {
  const { data } = await api.patch('/api/auth/me', payload)
  return data
}
