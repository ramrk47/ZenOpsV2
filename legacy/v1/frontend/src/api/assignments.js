import api from './client'

export async function fetchAssignments(params = {}) {
  const { data } = await api.get('/api/assignments/with-due', { params })
  return data
}

export async function fetchAssignment(id, params = {}) {
  const { data } = await api.get(`/api/assignments/${id}/detail`, { params })
  return data
}

export async function fetchAssignmentChecklist(id) {
  const { data } = await api.get(`/api/assignments/${id}/documents/checklist`)
  return data
}

export async function remindMissingDocs(id, payload = {}) {
  const { data } = await api.post(`/api/assignments/${id}/documents/remind`, payload)
  return data
}

export async function createAssignment(payload) {
  const { data } = await api.post('/api/assignments', payload)
  return data
}

export async function updateAssignment(id, payload) {
  const { data } = await api.patch(`/api/assignments/${id}`, payload)
  return data
}

export async function deleteAssignment(id, reason) {
  const { data } = await api.delete(`/api/assignments/${id}`, { params: { reason } })
  return data
}

export async function fetchAssignmentSummary() {
  const { data } = await api.get('/api/assignments/summary')
  return data
}

export async function fetchAssignmentWorkload() {
  const { data } = await api.get('/api/assignments/workload')
  return data
}
