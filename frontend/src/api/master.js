import api from './client'

export async function fetchBanks() {
  const { data } = await api.get('/api/master/banks')
  return data
}

export async function fetchBranches() {
  const { data } = await api.get('/api/master/branches')
  return data
}

export async function fetchClients() {
  const { data } = await api.get('/api/master/clients')
  return data
}

export async function fetchPropertyTypes() {
  const { data } = await api.get('/api/master/property-types')
  return data
}

export async function fetchPropertySubtypes(propertyTypeId) {
  const { data } = await api.get('/api/master/property-subtypes', {
    params: { property_type_id: propertyTypeId || undefined },
  })
  return data
}

export async function fetchCompanyAccounts({ bankId } = {}) {
  const { data } = await api.get('/api/master/company-accounts', {
    params: { bank_id: bankId || undefined },
  })
  return data
}

export async function fetchDocTemplates() {
  const { data } = await api.get('/api/master/doc-templates')
  return data
}

export async function fetchCompanyProfile() {
  const { data } = await api.get('/api/master/company-profile')
  return data
}

export async function fetchCalendarLabels() {
  const { data } = await api.get('/api/master/calendar-labels')
  return data
}

export async function fetchExternalPartners() {
  const { data } = await api.get('/api/master/partners')
  return data
}

export async function createBank(payload) {
  const { data } = await api.post('/api/master/banks', payload)
  return data
}

export async function updateBank(id, payload) {
  const { data } = await api.patch(`/api/master/banks/${id}`, payload)
  return data
}

export async function createBranch(payload) {
  const { data } = await api.post('/api/master/branches', payload)
  return data
}

export async function updateBranch(id, payload) {
  const { data } = await api.patch(`/api/master/branches/${id}`, payload)
  return data
}

export async function createClient(payload) {
  const { data } = await api.post('/api/master/clients', payload)
  return data
}

export async function updateClient(id, payload) {
  const { data } = await api.patch(`/api/master/clients/${id}`, payload)
  return data
}

export async function createPropertyType(payload) {
  const { data } = await api.post('/api/master/property-types', payload)
  return data
}

export async function updatePropertyType(id, payload) {
  const { data } = await api.patch(`/api/master/property-types/${id}`, payload)
  return data
}

export async function createPropertySubtype(payload) {
  const { data } = await api.post('/api/master/property-subtypes', payload)
  return data
}

export async function updatePropertySubtype(id, payload) {
  const { data } = await api.patch(`/api/master/property-subtypes/${id}`, payload)
  return data
}

export async function createCompanyAccount(payload) {
  const { data } = await api.post('/api/master/company-accounts', payload)
  return data
}

export async function updateCompanyAccount(id, payload) {
  const { data } = await api.patch(`/api/master/company-accounts/${id}`, payload)
  return data
}

export async function updateCompanyProfile(payload) {
  const { data } = await api.patch('/api/master/company-profile', payload)
  return data
}

export async function createCalendarLabel(payload) {
  const { data } = await api.post('/api/master/calendar-labels', payload)
  return data
}

export async function updateCalendarLabel(id, payload) {
  const { data } = await api.patch(`/api/master/calendar-labels/${id}`, payload)
  return data
}

export async function createDocTemplate(payload) {
  const { data } = await api.post('/api/master/doc-templates', payload)
  return data
}

export async function updateDocTemplate(id, payload) {
  const { data } = await api.patch(`/api/master/doc-templates/${id}`, payload)
  return data
}

export async function createExternalPartner(payload) {
  const { data } = await api.post('/api/master/partners', payload)
  return data
}

export async function updateExternalPartner(id, payload) {
  const { data } = await api.patch(`/api/master/partners/${id}`, payload)
  return data
}

export async function deleteExternalPartner(id) {
  const { data } = await api.delete(`/api/master/partners/${id}`)
  return data
}
