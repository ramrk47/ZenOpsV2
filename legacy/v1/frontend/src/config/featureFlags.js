const PILOT_MODE = String(import.meta.env.VITE_PILOT_MODE || '0') === '1'
const DEMO_MODE = String(import.meta.env.VITE_DEMO_MODE || '0') === '1'

export function isPilotMode() {
  return PILOT_MODE
}

export function isFeatureEnabled(feature) {
  if (feature === 'billingMonitor') return !PILOT_MODE
  if (feature === 'analyticsForecastV2') return true
  return true
}

export function isDemoMode() {
  return DEMO_MODE
}
