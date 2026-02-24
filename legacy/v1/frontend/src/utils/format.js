const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const moneyFormatters = new Map()

function getMoneyFormatter(currency) {
  const code = currency || 'INR'
  if (!moneyFormatters.has(code)) {
    moneyFormatters.set(code, new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }))
  }
  return moneyFormatters.get(code)
}

export function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return dateFormatter.format(date)
}

export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return dateTimeFormatter.format(date)
}

export function formatMoney(value, currency = 'INR') {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return getMoneyFormatter(currency).format(num)
}

export function titleCase(value) {
  if (!value) return ''
  return String(value)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function dueStateTone(state) {
  switch (state) {
    case 'OVERDUE':
      return 'danger'
    case 'DUE_SOON':
      return 'warn'
    case 'OK':
      return 'ok'
    default:
      return 'muted'
  }
}

export function dueStateLabel(assignment) {
  if (!assignment?.due_state) return 'No SLA'
  if (assignment.due_state === 'OVERDUE') {
    return `Overdue ${assignment.minutes_overdue ?? ''}m`.trim()
  }
  if (assignment.due_state === 'DUE_SOON') {
    return `Due in ${assignment.minutes_left ?? ''}m`.trim()
  }
  if (assignment.due_state === 'OK') {
    return assignment.minutes_left ? `Due in ${assignment.minutes_left}m` : 'On Track'
  }
  return titleCase(assignment.due_state)
}

export function isStaffRole(role) {
  return ['ADMIN', 'OPS_MANAGER', 'HR', 'FINANCE'].includes(role)
}

export function canAccessAdmin(role) {
  return isStaffRole(role)
}

export function statusTone(status) {
  if (!status) return 'muted'
  if (status === 'COMPLETED') return 'ok'
  if (status === 'CANCELLED') return 'muted'
  if (status === 'SUBMITTED') return 'info'
  if (status === 'SITE_VISIT') return 'warn'
  return 'accent'
}
