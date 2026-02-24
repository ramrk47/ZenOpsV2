const SUMMARY_SNAPSHOT_KEY = 'zenops.mobile.summary.v1'
const STATUS_HISTORY_KEY = 'zenops.mobile.history.v1'
const ASSIGNMENT_SNAPSHOT_PREFIX = 'zenops.mobile.assignment.'
const MAX_STATUS_HISTORY = 20

function safeParse(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function readSummarySnapshot() {
  if (typeof window === 'undefined') return null
  return safeParse(localStorage.getItem(SUMMARY_SNAPSHOT_KEY))
}

export function writeSummarySnapshot(summary) {
  if (typeof window === 'undefined' || !summary) return
  const snapshot = {
    ...summary,
    my_queue: Array.isArray(summary.my_queue) ? summary.my_queue.slice(0, 20) : [],
    cached_at: new Date().toISOString(),
  }
  localStorage.setItem(SUMMARY_SNAPSHOT_KEY, JSON.stringify(snapshot))
}

export function readStatusHistory() {
  if (typeof window === 'undefined') return []
  const parsed = safeParse(localStorage.getItem(STATUS_HISTORY_KEY))
  if (!Array.isArray(parsed)) return []
  return parsed
}

export function appendStatusHistory(summary) {
  if (typeof window === 'undefined' || !summary) return
  const entry = {
    generated_at: summary.generated_at || new Date().toISOString(),
    unread_notifications: Number(summary.unread_notifications || 0),
    approvals_pending: Number(summary.approvals_pending || 0),
    overdue_assignments: Number(summary.overdue_assignments || 0),
    payments_pending: Number(summary.payments_pending || 0),
  }
  const current = readStatusHistory()
  const history = [entry, ...current].slice(0, MAX_STATUS_HISTORY)
  localStorage.setItem(STATUS_HISTORY_KEY, JSON.stringify(history))
}

function assignmentKey(assignmentId) {
  return `${ASSIGNMENT_SNAPSHOT_PREFIX}${assignmentId}.v1`
}

export function readAssignmentSnapshot(assignmentId) {
  if (typeof window === 'undefined') return null
  return safeParse(localStorage.getItem(assignmentKey(assignmentId)))
}

export function writeAssignmentSnapshot(assignmentId, detail) {
  if (typeof window === 'undefined' || !assignmentId || !detail) return
  const snapshot = {
    ...detail,
    timeline: Array.isArray(detail.timeline) ? detail.timeline.slice(0, 10) : [],
    comments: Array.isArray(detail.comments) ? detail.comments.slice(0, 20) : [],
    cached_at: new Date().toISOString(),
  }
  localStorage.setItem(assignmentKey(assignmentId), JSON.stringify(snapshot))
}
