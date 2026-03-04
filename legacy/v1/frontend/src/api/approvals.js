import api from './client'

export async function fetchApprovalsInbox(includeDecided = false, approvalType = null, status = null) {
  const { data } = await api.get('/api/approvals/inbox', {
    params: {
      include_decided: includeDecided,
      approval_type: approvalType || undefined,
      status: status || undefined,
    },
  })
  return data
}

export async function fetchMyApprovals(includeDecided = true) {
  const { data } = await api.get('/api/approvals/mine', {
    params: { include_decided: includeDecided },
  })
  return data
}

export async function requestApproval(payload) {
  const { data } = await api.post('/api/approvals/request', payload)
  return data
}

export async function fetchApproval(id) {
  const { data } = await api.get(`/api/approvals/${id}`)
  return data
}

export async function approveApproval(id, comment) {
  const { data } = await api.post(`/api/approvals/${id}/approve`, { comment })
  return data
}

export async function rejectApproval(id, comment) {
  const { data } = await api.post(`/api/approvals/${id}/reject`, { comment })
  return data
}

export async function fetchApprovalTemplates() {
  const { data } = await api.get('/api/approvals/templates')
  return data
}

export async function fetchApprovalsInboxCount(approvalType = null) {
  const { data } = await api.get('/api/approvals/inbox-count', {
    params: { approval_type: approvalType || undefined },
  })
  return data
}

export async function fetchApprovalsInboxCountsByType(approvalTypes = []) {
  const requests = approvalTypes.map((approvalType) => fetchApprovalsInboxCount(approvalType).then((res) => [approvalType, res?.pending || 0]))
  const pairs = await Promise.all(requests)
  return Object.fromEntries(pairs)
}
