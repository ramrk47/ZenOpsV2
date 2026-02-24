import api from './client'

// ─── Public Config ───────────────────────────────────────────────────────────

export async function fetchPublicSupportConfig() {
  const { data } = await api.get('/api/support/public/config')
  return data
}

// ─── Internal Support Threads (Admin/Ops) ────────────────────────────────────

export async function fetchSupportThreads(params = {}) {
  const { data } = await api.get('/api/support/threads', { params })
  return data
}

export async function createSupportThread(payload) {
  const { data } = await api.post('/api/support/threads', payload)
  return data
}

export async function fetchSupportThread(threadId) {
  const { data } = await api.get(`/api/support/threads/${threadId}`)
  return data
}

export async function updateSupportThread(threadId, payload) {
  const { data } = await api.patch(`/api/support/threads/${threadId}`, payload)
  return data
}

export async function createSupportMessage(threadId, payload) {
  const { data } = await api.post(`/api/support/threads/${threadId}/messages`, payload)
  return data
}

export async function resolveSupportThread(threadId) {
  const { data } = await api.post(`/api/support/threads/${threadId}/resolve`)
  return data
}

export async function closeSupportThread(threadId) {
  const { data } = await api.post(`/api/support/threads/${threadId}/close`)
  return data
}

// ─── Token Management ────────────────────────────────────────────────────────

export async function createSupportToken(payload) {
  const { data } = await api.post('/api/support/tokens', payload)
  return data
}

export async function revokeSupportToken(tokenId) {
  const { data } = await api.post(`/api/support/tokens/${tokenId}/revoke`)
  return data
}

// ─── External Portal (Token-based, no auth) ──────────────────────────────────

export async function fetchPortalContext(token) {
  const { data } = await api.get('/api/support/portal/context', { params: { token } })
  return data
}

export async function createExternalSupportThread(token, payload) {
  const { data } = await api.post('/api/support/portal/threads', { token, ...payload })
  return data
}

export async function createExternalSupportMessage(token, threadId, payload) {
  const { data } = await api.post(`/api/support/portal/threads/${threadId}/messages`, {
    token,
    ...payload,
  })
  return data
}
