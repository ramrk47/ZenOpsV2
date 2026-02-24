import api from './client'

export async function fetchDocumentTemplates(params = {}) {
  const { data } = await api.get('/api/master/document-templates', { params })
  return data
}

export async function fetchDocumentTemplate(id) {
  const { data } = await api.get(`/api/master/document-templates/${id}`)
  return data
}

export async function createDocumentTemplate(formData) {
  const { data } = await api.post('/api/master/document-templates', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function updateDocumentTemplate(id, payload) {
  const { data } = await api.patch(`/api/master/document-templates/${id}`, payload)
  return data
}

export async function deleteDocumentTemplate(id) {
  await api.delete(`/api/master/document-templates/${id}`)
}

export async function downloadDocumentTemplate(id) {
  const response = await api.get(`/api/master/document-templates/${id}/download`, {
    responseType: 'blob',
  })
  return response
}

export async function fetchAvailableTemplates(assignmentId) {
  const { data } = await api.get(
    `/api/master/document-templates/assignments/${assignmentId}/available`
  )
  return data
}

export async function addDocumentFromTemplate(assignmentId, templateId) {
  const { data } = await api.post(
    `/api/master/document-templates/assignments/${assignmentId}/from-template/${templateId}`
  )
  return data
}
