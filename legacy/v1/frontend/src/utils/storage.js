import { getLocalStorageItem, setLocalStorageItem } from './appInstance'

export function loadJson(key, fallback) {
  try {
    const raw = getLocalStorageItem(key, [key])
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch (err) {
    console.warn('Failed to read localStorage key', key, err)
    return fallback
  }
}

export function saveJson(key, value) {
  try {
    setLocalStorageItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn('Failed to save localStorage key', key, err)
  }
}
