const PILOT_MODE = String(import.meta.env.VITE_PILOT_MODE || '0') === '1'
const ENABLE_REPOGEN_INPUTS = String(import.meta.env.VITE_ENABLE_REPOGEN_INPUTS || '0') === '1'

export function isPilotMode() {
  return PILOT_MODE
}

export function isFeatureEnabled(feature) {
  if (feature === 'billingMonitor') return !PILOT_MODE
  if (feature === 'analyticsForecastV2') return true
  if (feature === 'repogenInputs') return !PILOT_MODE && ENABLE_REPOGEN_INPUTS
  return true
}
