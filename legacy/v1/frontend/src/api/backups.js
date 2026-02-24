import api, { API_BASE_URL } from './client'

export async function fetchBackups() {
  const response = await api.get('/api/backups')
  return response.data
}

export async function triggerBackup(pin) {
  const response = await api.post('/api/backups/trigger', { pin })
  return response.data
}

export function backupDownloadUrl(filename) {
  const base = API_BASE_URL || ''
  return `${base}/api/backups/download/${encodeURIComponent(filename)}`
}
