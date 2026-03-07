const RAW_APP_INSTANCE = String(import.meta.env.VITE_APP_INSTANCE || 'pilot').trim()

export const APP_INSTANCE = RAW_APP_INSTANCE || 'pilot'

export function storageKey(key) {
  return `${APP_INSTANCE}:${key}`
}

function readFromStorage(storage, key, legacyKeys = []) {
  const scopedKey = storageKey(key)
  const candidates = [scopedKey, ...legacyKeys.filter(Boolean)]
  for (const candidate of candidates) {
    try {
      const value = storage.getItem(candidate)
      if (value !== null) return value
    } catch {
      return null
    }
  }
  return null
}

function writeToStorage(storage, key, value) {
  try {
    storage.setItem(storageKey(key), value)
  } catch {
    // ignore storage failures
  }
}

function removeFromStorage(storage, key, legacyKeys = []) {
  const candidates = [storageKey(key), ...legacyKeys.filter(Boolean)]
  for (const candidate of candidates) {
    try {
      storage.removeItem(candidate)
    } catch {
      // ignore storage failures
    }
  }
}

export function getLocalStorageItem(key, legacyKeys = []) {
  if (typeof window === 'undefined') return null
  return readFromStorage(window.localStorage, key, legacyKeys)
}

export function setLocalStorageItem(key, value) {
  if (typeof window === 'undefined') return
  writeToStorage(window.localStorage, key, value)
}

export function removeLocalStorageItem(key, legacyKeys = []) {
  if (typeof window === 'undefined') return
  removeFromStorage(window.localStorage, key, legacyKeys)
}

export function getSessionStorageItem(key, legacyKeys = []) {
  if (typeof window === 'undefined') return null
  return readFromStorage(window.sessionStorage, key, legacyKeys)
}

export function setSessionStorageItem(key, value) {
  if (typeof window === 'undefined') return
  writeToStorage(window.sessionStorage, key, value)
}

export function removeSessionStorageItem(key, legacyKeys = []) {
  if (typeof window === 'undefined') return
  removeFromStorage(window.sessionStorage, key, legacyKeys)
}
