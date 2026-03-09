import { getLocalStorageItem, removeLocalStorageItem, setLocalStorageItem } from '../../utils/appInstance'

export const DEMO_TUTORIAL_STORAGE_KEYS = {
  state: 'maulya.tutorial.state.v2',
  dismissed: 'maulya.tutorial.dismissed.v2',
  preferredFlow: 'maulya.tutorial.role.v2',
}

const LEGACY_KEYS = {
  state: ['maulya.demo.tutorial.state.v1'],
  dismissed: ['maulya.demo.tutorial.dismissed.v1'],
  preferredFlow: ['maulya.demo.tutorial.role.v1'],
}

function safeParse(rawValue, fallback) {
  if (!rawValue) return fallback
  try {
    return JSON.parse(rawValue)
  } catch {
    return fallback
  }
}

export function loadTutorialState() {
  return safeParse(getLocalStorageItem(DEMO_TUTORIAL_STORAGE_KEYS.state, LEGACY_KEYS.state), null)
}

export function saveTutorialState(state) {
  setLocalStorageItem(DEMO_TUTORIAL_STORAGE_KEYS.state, JSON.stringify(state))
}

export function clearTutorialState() {
  removeLocalStorageItem(DEMO_TUTORIAL_STORAGE_KEYS.state, LEGACY_KEYS.state)
}

export function loadTutorialDismissed() {
  return safeParse(getLocalStorageItem(DEMO_TUTORIAL_STORAGE_KEYS.dismissed, LEGACY_KEYS.dismissed), false) === true
}

export function saveTutorialDismissed(value) {
  setLocalStorageItem(DEMO_TUTORIAL_STORAGE_KEYS.dismissed, JSON.stringify(Boolean(value)))
}

export function clearTutorialDismissed() {
  removeLocalStorageItem(DEMO_TUTORIAL_STORAGE_KEYS.dismissed, LEGACY_KEYS.dismissed)
}

export function loadPreferredTutorialFlow() {
  return getLocalStorageItem(DEMO_TUTORIAL_STORAGE_KEYS.preferredFlow, LEGACY_KEYS.preferredFlow)
}

export function savePreferredTutorialFlow(flowId) {
  if (!flowId) return
  setLocalStorageItem(DEMO_TUTORIAL_STORAGE_KEYS.preferredFlow, flowId)
}

export function clearPreferredTutorialFlow() {
  removeLocalStorageItem(DEMO_TUTORIAL_STORAGE_KEYS.preferredFlow, LEGACY_KEYS.preferredFlow)
}
