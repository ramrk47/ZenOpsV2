import axios from 'axios'

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

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  const stepUp = sessionStorage.getItem('step_up_token')
  if (stepUp) config.headers['X-Step-Up-Token'] = stepUp
  return config
})

let _stepUpResolver = null

export function onStepUpRequired() {
  return new Promise((resolve, reject) => {
    _stepUpResolver = { resolve, reject }
    window.dispatchEvent(new CustomEvent('step-up-required'))
  })
}

export function resolveStepUp(token) {
  sessionStorage.setItem('step_up_token', token)
  if (_stepUpResolver) {
    _stepUpResolver.resolve(token)
    _stepUpResolver = null
  }
}

export function rejectStepUp() {
  sessionStorage.removeItem('step_up_token')
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
        const token = await onStepUpRequired()
        originalRequest._stepUpRetry = true
        originalRequest.headers['X-Step-Up-Token'] = token
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
