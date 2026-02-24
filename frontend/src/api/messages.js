import api from './client'

export async function fetchMessages(assignmentId) {
  const { data } = await api.get(`/api/assignments/${assignmentId}/messages`)
  return data
}

export async function createMessage(assignmentId, payload) {
  const { data } = await api.post(`/api/assignments/${assignmentId}/messages`, payload)
  return data
}

export async function updateMessage(assignmentId, messageId, payload) {
  const { data } = await api.patch(`/api/assignments/${assignmentId}/messages/${messageId}`, payload)
  return data
}

export async function pinMessage(assignmentId, messageId) {
  const { data } = await api.post(`/api/assignments/${assignmentId}/messages/${messageId}/pin`)
  return data
}

export async function unpinMessage(assignmentId, messageId) {
  const { data } = await api.post(`/api/assignments/${assignmentId}/messages/${messageId}/unpin`)
  return data
}

export async function deleteMessage(assignmentId, messageId) {
  await api.delete(`/api/assignments/${assignmentId}/messages/${messageId}`)
  return true
}
