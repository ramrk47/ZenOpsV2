import { storageKey } from '../../utils/appInstance'

const BASE_KEYS = {
  state: 'maulya.tutorial.state.v3',
  dismissed: 'maulya.tutorial.dismissed.v3',
  preferredFlow: 'maulya.tutorial.role.v3',
}

const LEGACY_KEYS = {
  state: ['maulya.tutorial.state.v2', 'maulya.demo.tutorial.state.v1'],
  dismissed: ['maulya.tutorial.dismissed.v2', 'maulya.demo.tutorial.dismissed.v1'],
  preferredFlow: ['maulya.tutorial.role.v2', 'maulya.demo.tutorial.role.v1'],
}

function scopedKey(baseKey, scope = 'global') {
  return storageKey(`${baseKey}:${scope}`)
}

function safeParse(rawValue, fallback) {
  if (!rawValue) return fallback
  try {
    return JSON.parse(rawValue)
  } catch {
    return fallback
  }
}

function readScopedItem(baseKey, scope) {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(scopedKey(baseKey, scope))
  } catch {
    return null
  }
}

function writeScopedItem(baseKey, scope, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(scopedKey(baseKey, scope), value)
  } catch {
    // ignore storage failures
  }
}

function removeScopedItem(baseKey, scope) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(scopedKey(baseKey, scope))
  } catch {
    // ignore storage failures
  }
}

function removeLegacyKeys(keys) {
  if (typeof window === 'undefined') return
  for (const key of keys) {
    try {
      window.localStorage.removeItem(storageKey(key))
      window.localStorage.removeItem(key)
    } catch {
      // ignore storage failures
    }
  }
}

export function clearLegacyTutorialStorage() {
  removeLegacyKeys([
    ...LEGACY_KEYS.state,
    ...LEGACY_KEYS.dismissed,
    ...LEGACY_KEYS.preferredFlow,
  ])
}

export function loadTutorialState(scope) {
  return safeParse(readScopedItem(BASE_KEYS.state, scope), null)
}

export function saveTutorialState(scope, state) {
  writeScopedItem(BASE_KEYS.state, scope, JSON.stringify(state))
}

export function clearTutorialState(scope) {
  removeScopedItem(BASE_KEYS.state, scope)
}

export function loadTutorialDismissed(scope) {
  return safeParse(readScopedItem(BASE_KEYS.dismissed, scope), false) === true
}

export function saveTutorialDismissed(scope, value) {
  writeScopedItem(BASE_KEYS.dismissed, scope, JSON.stringify(Boolean(value)))
}

export function clearTutorialDismissed(scope) {
  removeScopedItem(BASE_KEYS.dismissed, scope)
}

export function loadPreferredTutorialFlow(scope) {
  return readScopedItem(BASE_KEYS.preferredFlow, scope)
}

export function savePreferredTutorialFlow(scope, flowId) {
  if (!flowId) return
  writeScopedItem(BASE_KEYS.preferredFlow, scope, flowId)
}

export function clearPreferredTutorialFlow(scope) {
  removeScopedItem(BASE_KEYS.preferredFlow, scope)
}
