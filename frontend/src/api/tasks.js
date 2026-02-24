import api from './client'

export async function fetchTasks(assignmentId) {
  const { data } = await api.get(`/api/assignments/${assignmentId}/tasks`)
  return data
}

export async function createTask(assignmentId, payload) {
  const { data } = await api.post(`/api/assignments/${assignmentId}/tasks`, payload)
  return data
}

export async function updateTask(assignmentId, taskId, payload) {
  const { data } = await api.patch(`/api/assignments/${assignmentId}/tasks/${taskId}`, payload)
  return data
}

export async function deleteTask(assignmentId, taskId) {
  await api.delete(`/api/assignments/${assignmentId}/tasks/${taskId}`)
  return true
}

export async function fetchMyTasks(params = {}) {
  const { data } = await api.get('/api/tasks/my', { params })
  return data
}

export async function fetchTaskQueue(params = {}) {
  const { data } = await api.get('/api/tasks/queue', { params })
  return data
}
