import api from './client'

export async function fetchMobileSummary() {
  const { data } = await api.get('/api/mobile/summary')
  return data
}

export async function fetchMobileAssignmentDetail(assignmentId) {
  const { data } = await api.get(`/api/mobile/assignments/${assignmentId}`)
  return data
}

export async function uploadMobileDocument(assignmentId, { file, category = '' }) {
  const formData = new FormData()
  formData.append('file', file)
  if (category) formData.append('category', category)
  const { data } = await api.post(`/api/mobile/assignments/${assignmentId}/documents/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function createMobileComment(assignmentId, payload) {
  const { data } = await api.post(`/api/mobile/assignments/${assignmentId}/comments`, payload)
  return data
}

export async function raiseMobileRequest(assignmentId, payload) {
  const { data } = await api.post(`/api/mobile/assignments/${assignmentId}/request`, payload)
  return data
}
