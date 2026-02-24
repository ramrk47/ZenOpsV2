import api from './client'

export async function fetchDocuments(assignmentId) {
  const { data } = await api.get(`/api/assignments/${assignmentId}/documents`)
  return data
}

export async function uploadDocument(assignmentId, file, category = '') {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('category', category)
  formData.append('is_final', 'false')
  const { data } = await api.post(`/api/assignments/${assignmentId}/documents/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function uploadDocumentWithMeta(assignmentId, { file, category, isFinal }) {
  const formData = new FormData()
  formData.append('file', file)
  if (category) formData.append('category', category)
  formData.append('is_final', isFinal ? 'true' : 'false')
  const { data } = await api.post(`/api/assignments/${assignmentId}/documents/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function markDocumentFinal(assignmentId, documentId, isFinal = true) {
  const { data } = await api.post(`/api/assignments/${assignmentId}/documents/${documentId}/final`, {
    is_final: isFinal,
  })
  return data
}

export async function reviewDocument(assignmentId, documentId, reviewStatus, note = null) {
  const { data } = await api.post(`/api/assignments/${assignmentId}/documents/${documentId}/review`, {
    review_status: reviewStatus,
    note,
    lane: 'INTERNAL',
    is_visible_to_client: false,
  })
  return data
}

export function documentDownloadUrl(assignmentId, documentId) {
  // Return relative path for axios (which adds baseURL automatically)
  return `/api/assignments/${assignmentId}/documents/${documentId}/download`
}

export function documentPreviewUrl(assignmentId, documentId) {
  // Return relative path for axios (which adds baseURL automatically)
  return `/api/assignments/${assignmentId}/documents/${documentId}/preview`
}
