import { getLocalStorageItem, setLocalStorageItem } from './appInstance'

const SUMMARY_SNAPSHOT_KEY = 'maulya.mobile.summary.v1'
const STATUS_HISTORY_KEY = 'maulya.mobile.history.v1'
const ASSIGNMENT_SNAPSHOT_PREFIX = 'maulya.mobile.assignment.'
const MAX_STATUS_HISTORY = 20

function safeParse(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function sanitizeScopePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
}

export function buildMobileSnapshotScope(user) {
  const idPart = sanitizeScopePart(user?.id ? `u${user.id}` : '')
  const emailPart = sanitizeScopePart(user?.email || '')
  const rolePart = sanitizeScopePart(
    Array.isArray(user?.roles) && user.roles.length ? user.roles.join('-') : user?.role || '',
  )
  const scope = [idPart, emailPart, rolePart].filter(Boolean).join('__')
  return scope || 'anonymous'
}

function summaryKey(scope = 'anonymous') {
  return `${SUMMARY_SNAPSHOT_KEY}:${scope}`
}

function historyKey(scope = 'anonymous') {
  return `${STATUS_HISTORY_KEY}:${scope}`
}

function assignmentKey(scope = 'anonymous', assignmentId) {
  return `${ASSIGNMENT_SNAPSHOT_PREFIX}${scope}.${assignmentId}.v1`
}

export function purgeLegacyMobileSnapshots() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SUMMARY_SNAPSHOT_KEY)
  localStorage.removeItem(STATUS_HISTORY_KEY)
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (!key) continue
    if (/^maulya\.mobile\.assignment\.\d+\.v1$/.test(key)) {
      localStorage.removeItem(key)
    }
  }
}

export function readSummarySnapshot(scope) {
  if (typeof window === 'undefined') return null
  const key = summaryKey(scope)
  return safeParse(getLocalStorageItem(key, [key]))
}

export function writeSummarySnapshot(scope, summary) {
  if (typeof window === 'undefined' || !summary) return
  const snapshot = {
    ...summary,
    my_queue: Array.isArray(summary.my_queue) ? summary.my_queue.slice(0, 20) : [],
    cached_at: new Date().toISOString(),
  }
  setLocalStorageItem(summaryKey(scope), JSON.stringify(snapshot))
}

export function readStatusHistory(scope) {
  if (typeof window === 'undefined') return []
  const key = historyKey(scope)
  const parsed = safeParse(getLocalStorageItem(key, [key]))
  if (!Array.isArray(parsed)) return []
  return parsed
}

export function appendStatusHistory(scope, summary) {
  if (typeof window === 'undefined' || !summary) return
  const entry = {
    generated_at: summary.generated_at || new Date().toISOString(),
    unread_notifications: Number(summary.unread_notifications || 0),
    approvals_pending: Number(summary.approvals_pending || 0),
    overdue_assignments: Number(summary.overdue_assignments || 0),
    payments_pending: Number(summary.payments_pending || 0),
  }
  const current = readStatusHistory(scope)
  const history = [entry, ...current].slice(0, MAX_STATUS_HISTORY)
  setLocalStorageItem(historyKey(scope), JSON.stringify(history))
}

export function readAssignmentSnapshot(scope, assignmentId) {
  if (typeof window === 'undefined') return null
  const key = assignmentKey(scope, assignmentId)
  return safeParse(getLocalStorageItem(key, [key]))
}

export function writeAssignmentSnapshot(scope, assignmentId, detail) {
  if (typeof window === 'undefined' || !assignmentId || !detail) return
  const snapshot = {
    ...detail,
    timeline: Array.isArray(detail.timeline) ? detail.timeline.slice(0, 10) : [],
    comments: Array.isArray(detail.comments) ? detail.comments.slice(0, 20) : [],
    cached_at: new Date().toISOString(),
  }
  setLocalStorageItem(assignmentKey(scope, assignmentId), JSON.stringify(snapshot))
}
