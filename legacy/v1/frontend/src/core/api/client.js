import axios from 'axios'
import {
  getLocalStorageItem,
  getSessionStorageItem,
  removeSessionStorageItem,
  setSessionStorageItem,
} from '../../utils/appInstance'

const inferBaseUrl = () => {
  if (typeof window === 'undefined') return ''
  if (import.meta.env.DEV) {
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:8000`
  }
  return ''
}

const envBase = (import.meta.env.VITE_API_URL || '').trim()
const rawBase = envBase || inferBaseUrl()
export const API_BASE_URL = rawBase.endsWith('/api') ? rawBase.slice(0, -4) || '' : rawBase

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
})

const STEP_UP_KIND_TOKEN = 'step_up_token'
const STEP_UP_KIND_MASTER_KEY = 'admin_master_key'

api.interceptors.request.use((config) => {
  const token = getLocalStorageItem('token', ['token'])
  if (token) config.headers.Authorization = `Bearer ${token}`
  const stepUp = getSessionStorageItem('step_up_token', ['step_up_token'])
  if (stepUp) config.headers['X-Step-Up-Token'] = stepUp
  const adminMasterKey = getSessionStorageItem('admin_master_key', ['admin_master_key'])
  if (adminMasterKey) config.headers['X-Admin-Master-Key'] = adminMasterKey
  return config
})

let _stepUpResolver = null

export function onStepUpRequired() {
  return new Promise((resolve, reject) => {
    _stepUpResolver = { resolve, reject }
    window.dispatchEvent(new CustomEvent('step-up-required'))
  })
}

function _resolveStepUpPayload(payload) {
  if (typeof payload === 'string' && payload.trim()) {
    const token = payload.trim()
    setSessionStorageItem('step_up_token', token)
    return { kind: STEP_UP_KIND_TOKEN, token }
  }
  if (payload?.kind === STEP_UP_KIND_TOKEN && String(payload?.value || '').trim()) {
    const token = String(payload.value).trim()
    setSessionStorageItem('step_up_token', token)
    return { kind: STEP_UP_KIND_TOKEN, token }
  }
  if (payload?.kind === STEP_UP_KIND_MASTER_KEY && String(payload?.value || '').trim()) {
    const key = String(payload.value).trim()
    setSessionStorageItem('admin_master_key', key)
    return { kind: STEP_UP_KIND_MASTER_KEY, key }
  }
  return null
}

export function resolveStepUp(payload) {
  const resolved = _resolveStepUpPayload(payload)
  if (!resolved) return
  if (_stepUpResolver) {
    _stepUpResolver.resolve(resolved)
    _stepUpResolver = null
  }
}

export function rejectStepUp() {
  removeSessionStorageItem('step_up_token', ['step_up_token'])
  if (_stepUpResolver) {
    _stepUpResolver.reject(new Error('Step-up authentication cancelled'))
    _stepUpResolver = null
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const requestId = getErrorRequestId(error)
    const status = error?.response?.status

    if (status && status >= 400) {
      console.error(`[API ${status}] ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url}`, {
        requestId,
        detail: error?.response?.data?.detail,
        message: error?.message,
      })
    }

    if (status === 403 && error?.response?.data?.detail === 'step_up_required' && !originalRequest._stepUpRetry) {
      try {
        const credential = await onStepUpRequired()
        originalRequest._stepUpRetry = true
        if (credential?.kind === STEP_UP_KIND_MASTER_KEY && credential?.key) {
          originalRequest.headers['X-Admin-Master-Key'] = credential.key
        } else if (credential?.kind === STEP_UP_KIND_TOKEN && credential?.token) {
          originalRequest.headers['X-Step-Up-Token'] = credential.token
        }
        return api(originalRequest)
      } catch {
        return Promise.reject(error)
      }
    }
    return Promise.reject(error)
  },
)

export function toUserMessage(error, fallback = 'Something went wrong') {
  const detail = error?.response?.data?.detail
  if (!detail) return fallback
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return fallback
  }
}

export function getErrorRequestId(error) {
  return error?.response?.headers?.['x-request-id'] || 'unknown'
}

export function logApiError(error, context = '') {
  const requestId = getErrorRequestId(error)
  const status = error?.response?.status || 'unknown'
  const message = toUserMessage(error)
  const path = error?.config?.url || 'unknown'

  console.error(`[API Error] ${context}`, { status, path, message, requestId, error: error?.message })
  return { requestId, status, message, path }
}

export default api
