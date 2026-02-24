import api from './client'

export async function fetchInvoices(params = {}) {
  const { data } = await api.get('/api/invoices', { params })
  return data
}

export async function fetchInvoice(id) {
  const { data } = await api.get(`/api/invoices/${id}`)
  return data
}

export async function fetchInvoiceContext(id) {
  const { data } = await api.get(`/api/invoices/${id}/context`)
  return data
}

export async function createInvoice(payload) {
  const { data } = await api.post('/api/invoices', payload)
  return data
}

export async function updateInvoice(id, payload) {
  const { data } = await api.patch(`/api/invoices/${id}`, payload)
  return data
}

export async function issueInvoice(id) {
  const { data } = await api.post(`/api/invoices/${id}/issue`)
  return data
}

export async function markInvoicePaid(id) {
  const { data } = await api.post(`/api/invoices/${id}/mark-paid`)
  return data
}

export async function fetchInvoicePdf(id, { regenerate = false } = {}) {
  const response = await api.get(`/api/invoices/${id}/pdf`, {
    params: { regenerate: regenerate || undefined },
    responseType: 'blob',
  })
  return response.data
}

export async function sendInvoiceReminder(id, { idempotencyKey } = {}) {
  const headers = {}
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const { data } = await api.post(`/api/invoices/${id}/remind`, null, { headers })
  return data
}

export async function sendInvoice(id, payload = {}) {
  const { data } = await api.post(`/api/invoices/${id}/send`, payload)
  return data
}

export async function addInvoicePayment(id, payload) {
  const { data } = await api.post(`/api/invoices/${id}/payments`, payload)
  return data
}

export async function addInvoiceAdjustment(id, payload) {
  const { data } = await api.post(`/api/invoices/${id}/adjustments`, payload)
  return data
}

export async function voidInvoice(id, payload) {
  const { data } = await api.post(`/api/invoices/${id}/void`, payload)
  return data
}

export async function exportInvoicesCsv(params = {}) {
  const response = await api.get('/api/invoices/export.csv', {
    params,
    responseType: 'blob',
  })
  return response.data
}

export async function fetchInvoiceAttachments(id) {
  const { data } = await api.get(`/api/invoices/${id}/attachments`)
  return data
}

export async function uploadInvoiceAttachment(id, { file, category }) {
  const formData = new FormData()
  formData.append('file', file)
  if (category) formData.append('category', category)
  const { data } = await api.post(`/api/invoices/${id}/attachments/upload`, formData)
  return data
}

export async function downloadInvoiceAttachment(id, attachmentId) {
  const response = await api.get(`/api/invoices/${id}/attachments/${attachmentId}/download`, {
    responseType: 'blob',
  })
  return response.data
}

export async function deleteInvoiceAttachment(id, attachmentId) {
  const { data } = await api.delete(`/api/invoices/${id}/attachments/${attachmentId}`)
  return data
}
