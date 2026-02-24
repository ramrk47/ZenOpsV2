import api from './client'

// Payroll Runs
export async function fetchPayrollRuns({ month, status, limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams()
  if (month) params.append('month', month)
  if (status) params.append('status', status)
  params.append('limit', String(limit))
  params.append('offset', String(offset))

  const { data } = await api.get(`/api/payroll/runs?${params}`)
  return data
}

export async function fetchPayrollRunDetail(runId) {
  const { data } = await api.get(`/api/payroll/runs/${runId}`)
  return data
}

export async function createPayrollRun(payload) {
  const { data } = await api.post('/api/payroll/runs', payload)
  return data
}

export async function calculatePayrollRun(runId) {
  const { data } = await api.post(`/api/payroll/runs/${runId}/calculate`)
  return data
}

export async function sendPayrollRunForApproval(runId) {
  const { data } = await api.post(`/api/payroll/runs/${runId}/send-approval`)
  return data
}

export async function approvePayrollRun(runId) {
  const { data } = await api.post(`/api/payroll/runs/${runId}/approve`)
  return data
}

export async function markPayrollRunPaid(runId) {
  const { data } = await api.post(`/api/payroll/runs/${runId}/mark-paid`)
  return data
}

export async function closePayrollRun(runId) {
  const { data} = await api.post(`/api/payroll/runs/${runId}/close`)
  return data
}

export async function exportPayrollRun(runId, exportType = 'csv') {
  const { data } = await api.get(`/api/payroll/runs/${runId}/export/${exportType}`, {
    responseType: exportType === 'pdf' ? 'blob' : 'json'
  })
  return data
}

// Salary Structures
export async function fetchSalaryStructures({ user_id, active_only = true, limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams()
  if (user_id) params.append('user_id', String(user_id))
  params.append('active_only', String(active_only))
  params.append('limit', String(limit))
  params.append('offset', String(offset))

  const { data } = await api.get(`/api/payroll/salary-structures?${params}`)
  return data
}

export async function fetchSalaryStructureDetail(structureId) {
  const { data } = await api.get(`/api/payroll/salary-structures/${structureId}`)
  return data
}

export async function createSalaryStructure(payload) {
  const { data } = await api.post('/api/payroll/salary-structures', payload)
  return data
}

export async function updateSalaryStructure(structureId, payload) {
  const { data } = await api.patch(`/api/payroll/salary-structures/${structureId}`, payload)
  return data
}

// Payslips
export async function fetchPayslips({ limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams()
  params.append('limit', String(limit))
  params.append('offset', String(offset))

  const { data } = await api.get(`/api/payroll/payslips?${params}`)
  return data
}

export async function fetchMyPayslips() {
  const { data } = await api.get('/api/payroll/payslips/my')
  return data
}

export async function downloadPayslip(payslipId) {
  const { data } = await api.get(`/api/payroll/payslips/${payslipId}/download`, {
    responseType: 'blob'
  })
  return data
}

export async function generatePayslip(payslipId) {
  const { data } = await api.post(`/api/payroll/payslips/${payslipId}/generate`)
  return data
}

export async function sendPayslipEmail(payslipId) {
  const { data } = await api.post(`/api/payroll/payslips/${payslipId}/send-email`)
  return data
}

// Stats & Config
export async function fetchPayrollStats() {
  const { data } = await api.get('/api/payroll/stats')
  return data
}

export async function fetchPayrollPolicy() {
  const { data } = await api.get('/api/payroll/policy')
  return data
}

export async function updatePayrollPolicy(payload) {
  const { data } = await api.patch('/api/payroll/policy', payload)
  return data
}
