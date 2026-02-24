import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import { Card, CardHeader } from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import InfoTip from '../components/ui/InfoTip'
import { fetchCalendarEvents, createCalendarEvent, deleteCalendarEvent } from '../api/calendar'
import { fetchUserDirectory } from '../api/users'
import { fetchCalendarLabels } from '../api/master'
import { formatDateTime, titleCase } from '../utils/format'
import { toUserMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { canSeeAdmin } from '../utils/rbac'
import { loadJson, saveJson } from '../utils/storage'

const EVENT_TYPES = ['SITE_VISIT', 'REPORT_DUE', 'DOC_PICKUP', 'INTERNAL_MEETING', 'TASK_DUE', 'PAYMENT_FOLLOWUP', 'LEAVE']
const FILTERS_KEY = 'zenops.calendar.filters.v1'

const EVENT_META = {
  SITE_VISIT: { icon: '🚗', tone: 'warn', label: 'Site Visit' },
  REPORT_DUE: { icon: '🧾', tone: 'info', label: 'Report Due' },
  DOC_PICKUP: { icon: '📄', tone: 'accent', label: 'Doc Pickup' },
  INTERNAL_MEETING: { icon: '🧠', tone: 'ok', label: 'Meeting' },
  TASK_DUE: { icon: '✅', tone: 'danger', label: 'Task Due' },
  PAYMENT_FOLLOWUP: { icon: '💸', tone: 'warn', label: 'Payment Follow-up' },
  LEAVE: { icon: '🌴', tone: 'muted', label: 'Leave' },
}

function toIso(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function nowLocalInputValue() {
  const date = new Date()
  date.setSeconds(0, 0)
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16)
}

function isoToLocalInputValue(isoValue) {
  if (!isoValue) return ''
  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) return ''
  date.setSeconds(0, 0)
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16)
}

function getRangeForView(mode, baseDate = new Date()) {
  const start = new Date(baseDate)
  const end = new Date(baseDate)
  if (mode === 'day') {
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
  } else if (mode === 'week') {
    const day = start.getDay()
    const diff = day === 0 ? -6 : 1 - day
    start.setDate(start.getDate() + diff)
    start.setHours(0, 0, 0, 0)
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
  } else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    end.setMonth(start.getMonth() + 1)
    end.setDate(0)
    end.setHours(23, 59, 59, 999)
  }
  return { start, end }
}

function formatTimeOnly(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatTimeRange(start, end, allDay = false) {
  if (allDay) return 'All day'
  const startLabel = formatTimeOnly(start)
  const endLabel = formatTimeOnly(end)
  if (!startLabel && !endLabel) return ''
  if (!endLabel || startLabel === endLabel) return startLabel
  return `${startLabel} → ${endLabel}`
}

function toDayStart(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  date.setHours(0, 0, 0, 0)
  return date
}

function packLaneEvents(items) {
  const rows = []
  const positioned = []
  const sorted = [...items].sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex)
  sorted.forEach((item) => {
    let rowIndex = 0
    for (; rowIndex < rows.length; rowIndex += 1) {
      if (item.startIndex > rows[rowIndex]) {
        rows[rowIndex] = item.endIndex
        break
      }
    }
    if (rowIndex === rows.length) {
      rows.push(item.endIndex)
    }
    positioned.push({ ...item, laneRow: rowIndex })
  })
  return { positioned, rowCount: rows.length }
}

function getHeatLevel(value, max) {
  if (!value || max <= 0) return 0
  const ratio = value / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

export default function CalendarPage() {
  const { user, capabilities } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [users, setUsers] = useState([])
  const [labels, setLabels] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const storedFilters = loadJson(FILTERS_KEY, {})
  const [viewMode, setViewMode] = useState(storedFilters.viewMode || 'week')
  const [panelTab, setPanelTab] = useState(storedFilters.panelTab || 'agenda')
  const [density, setDensity] = useState(storedFilters.density || 'comfortable')
  const [focusedDayKey, setFocusedDayKey] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const createPanelRef = useRef(null)

  const [filters, setFilters] = useState(() => {
    const start = new Date()
    start.setDate(start.getDate() - 7)
    const end = new Date()
    end.setDate(end.getDate() + 21)
    if (storedFilters.filters) {
      return {
        assigned_to_user_id: storedFilters.filters.assigned_to_user_id || '',
        event_type: storedFilters.filters.event_type || '',
        event_label_id: storedFilters.filters.event_label_id || '',
        start_from: storedFilters.filters.start_from || start.toISOString(),
        start_to: storedFilters.filters.start_to || end.toISOString(),
      }
    }
    return {
      assigned_to_user_id: '',
      event_type: '',
      event_label_id: '',
      start_from: start.toISOString(),
      start_to: end.toISOString(),
    }
  })

  useEffect(() => {
    saveJson(FILTERS_KEY, {
      viewMode,
      panelTab,
      density,
      filters,
    })
  }, [viewMode, panelTab, density, filters])

  function applyViewRange(mode, baseDate = new Date()) {
    const { start, end } = getRangeForView(mode, baseDate)
    setViewMode(mode)
    setFilters((prev) => ({
      ...prev,
      start_from: start.toISOString(),
      start_to: end.toISOString(),
    }))
    if (mode !== viewMode) {
      const viewParam = mode === 'day' ? 'today' : mode
      setSearchParams({ view: viewParam })
    }
  }

  useEffect(() => {
    const view = searchParams.get('view')
    if (!view) return
    const normalized = view === 'today' ? 'day' : view
    if (!['day', 'week', 'month'].includes(normalized)) return
    if (normalized === viewMode) return
    const { start, end } = getRangeForView(normalized)
    setViewMode(normalized)
    setFilters((prev) => ({
      ...prev,
      start_from: start.toISOString(),
      start_to: end.toISOString(),
    }))
  }, [searchParams, viewMode])

  const [form, setForm] = useState(() => {
    const startLocal = nowLocalInputValue()
    const endLocal = nowLocalInputValue()
    return {
      event_type: 'SITE_VISIT',
      event_label_id: '',
      title: '',
      description: '',
      start_at: startLocal,
      end_at: endLocal,
      assigned_to_user_id: user?.id ? String(user.id) : '',
      assigned_to_all: false,
      assigned_user_ids: user?.id ? [String(user.id)] : [],
    }
  })

  const userMap = useMemo(() => {
    const map = new Map()
    users.forEach((u) => map.set(String(u.id), u))
    return map
  }, [users])

  const labelMap = useMemo(() => {
    const map = new Map()
    labels.forEach((label) => map.set(String(label.id), label))
    return map
  }, [labels])

  const getAssigneeLabel = (event) => {
    if (event.assigned_to_all) return 'Everyone'
    const primary = event.assigned_to_user_id ? userMap.get(String(event.assigned_to_user_id)) : null
    const extraAssignees = (event.assigned_user_ids || []).filter(
      (id) => String(id) !== String(event.assigned_to_user_id),
    )
    const extraCount = extraAssignees.length
    if (primary) {
      return `${primary.full_name || primary.email}${extraCount ? ` (+${extraCount})` : ''}`
    }
    if (extraCount > 0) return `Team (+${extraCount})`
    return ''
  }

  const getEventTitle = (event) => {
    const baseTitle = event.title || EVENT_META[event.event_type]?.label || 'Event'
    const assigneeLabel = getAssigneeLabel(event)
    if (!assigneeLabel) return baseTitle
    if (event.event_type === 'LEAVE' || event.event_type === 'TASK_DUE') {
      const normalized = baseTitle.toLowerCase()
      if (normalized.includes(assigneeLabel.toLowerCase())) return baseTitle
      return `${baseTitle} · ${assigneeLabel}`
    }
    return baseTitle
  }

  const eventsForDisplay = useMemo(() => {
    if (!filters.event_label_id) return events
    return events.filter((event) => String(event.event_label_id) === String(filters.event_label_id))
  }, [events, filters.event_label_id])

  useEffect(() => {
    let cancelled = false

    async function loadReferenceData() {
      try {
        const [userData, labelData] = await Promise.all([
          fetchUserDirectory(),
          fetchCalendarLabels().catch(() => []),
        ])
        if (cancelled) return
        setUsers(userData)
        setLabels(labelData)
      } catch (err) {
        console.error(err)
      }
    }

    loadReferenceData()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadEvents() {
      setLoading(true)
      setError(null)
      try {
        const params = {}
        if (filters.assigned_to_user_id) params.assigned_to_user_id = Number(filters.assigned_to_user_id)
        if (filters.event_type) params.event_type = filters.event_type
        if (filters.start_from) params.start_from = filters.start_from
        if (filters.start_to) params.start_to = filters.start_to
        const data = await fetchCalendarEvents(params)
        if (!cancelled) setEvents(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load calendar events'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadEvents()
    return () => {
      cancelled = true
    }
  }, [filters])

  function toggleEventAssignee(userId) {
    const id = String(userId)
    setForm((prev) => {
      const current = new Set(prev.assigned_user_ids.map(String))
      if (current.has(id)) {
        current.delete(id)
      } else {
        current.add(id)
      }
      return {
        ...prev,
        assigned_user_ids: Array.from(current),
      }
    })
  }

  function handleAssignToAllChange(checked) {
    setForm((prev) => ({
      ...prev,
      assigned_to_all: checked,
      assigned_to_user_id: checked ? '' : prev.assigned_to_user_id,
      assigned_user_ids: checked ? [] : prev.assigned_user_ids,
    }))
  }

  function handleLabelChange(value) {
    const selectedLabel = value ? labelMap.get(String(value)) : null
    setForm((prev) => ({
      ...prev,
      event_label_id: value,
      event_type: selectedLabel?.default_event_type || prev.event_type,
    }))
  }

  async function handleCreateEvent(e) {
    e.preventDefault()
    setError(null)
    try {
      const assignedToAll = Boolean(form.assigned_to_all)
      const assigneeIds = new Set()
      if (!assignedToAll) {
        if (form.assigned_to_user_id) assigneeIds.add(Number(form.assigned_to_user_id))
        form.assigned_user_ids.forEach((uid) => {
          const parsed = Number(uid)
          if (Number.isFinite(parsed)) assigneeIds.add(parsed)
        })
      }
      const assignedUserIds = assignedToAll ? [] : Array.from(assigneeIds)
      const primaryAssigneeId = assignedToAll
        ? null
        : form.assigned_to_user_id
          ? Number(form.assigned_to_user_id)
          : assignedUserIds[0] || null

      const payload = {
        event_type: form.event_type,
        event_label_id: form.event_label_id ? Number(form.event_label_id) : null,
        title: form.title.trim(),
        description: form.description.trim() || null,
        start_at: toIso(form.start_at),
        end_at: toIso(form.end_at),
        assigned_to_user_id: primaryAssigneeId,
        assigned_to_all: assignedToAll,
        assigned_user_ids: assignedUserIds,
        all_day: false,
      }
      if (!payload.title) {
        setError('Title is required')
        return
      }
      if (!payload.start_at || !payload.end_at) {
        setError('Start and end times are required')
        return
      }
      await createCalendarEvent(payload)
      setForm((prev) => ({ ...prev, title: '', description: '' }))
      setFilters((prev) => ({ ...prev }))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create event'))
    }
  }

  async function handleDeleteEvent(event) {
    const isLeave = event.event_type === 'LEAVE'
    if (isLeave && !canSeeAdmin(capabilities)) {
      setError('Leave events can only be deleted by HR/Admin/Ops.')
      return
    }
    const confirmed = window.confirm(`Delete event "${event.title}"?`)
    if (!confirmed) return
    try {
      await deleteCalendarEvent(event.id)
      setEvents((prev) => prev.filter((e) => e.id !== event.id))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to delete event'))
    }
  }

  function handleEventNavigate(event) {
    if (event.assignment_id) {
      navigate(`/assignments/${event.assignment_id}`)
      return
    }
    if (event.related_leave_request_id) {
      navigate('/requests?tab=leave')
    }
  }

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function toggleEventTypeFilter(type) {
    setFilters((prev) => ({ ...prev, event_type: prev.event_type === type ? '' : type }))
  }

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function focusDay(dayKey) {
    setFocusedDayKey((prev) => (prev === dayKey ? '' : dayKey))
    setPanelTab('agenda')
  }

  function shiftRange(direction) {
    const delta = direction === 'prev' ? -1 : 1
    const base = filters.start_from ? new Date(filters.start_from) : new Date()
    if (Number.isNaN(base.getTime())) return
    if (viewMode === 'day') {
      base.setDate(base.getDate() + delta)
    } else if (viewMode === 'week') {
      base.setDate(base.getDate() + delta * 7)
    } else {
      base.setMonth(base.getMonth() + delta)
    }
    applyViewRange(viewMode, base)
  }

  function jumpToDate(value) {
    if (!value) return
    const target = new Date(value)
    if (Number.isNaN(target.getTime())) return
    applyViewRange(viewMode, target)
  }

  const counts = useMemo(() => {
    const map = new Map()
    eventsForDisplay.forEach((event) => {
      map.set(event.event_type, (map.get(event.event_type) || 0) + 1)
    })
    return map
  }, [eventsForDisplay])

  const rangeLabel = useMemo(() => {
    const start = filters.start_from ? new Date(filters.start_from) : new Date()
    const end = filters.start_to ? new Date(filters.start_to) : new Date(start)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
    const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric' })
    const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' })
    const fullFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    if (viewMode === 'day') return fullFmt.format(start)
    if (sameMonth) {
      return `${monthFmt.format(start)} ${dayFmt.format(start)} – ${dayFmt.format(end)}`
    }
    return `${fullFmt.format(start)} – ${fullFmt.format(end)}`
  }, [filters.start_from, filters.start_to, viewMode])

  const rangeDays = useMemo(() => {
    const start = filters.start_from ? new Date(filters.start_from) : new Date()
    const end = filters.start_to ? new Date(filters.start_to) : new Date(start)
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    const days = []
    const cursor = new Date(start)
    const maxDays = 45
    while (cursor <= end && days.length < maxDays) {
      days.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    return days
  }, [filters.start_from, filters.start_to])

  const todayKey = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today.toISOString()
  }, [])

  const dayIndexMap = useMemo(() => {
    const map = new Map()
    rangeDays.forEach((day, index) => {
      map.set(day.toISOString(), index)
    })
    return map
  }, [rangeDays])

  const todayIndex = useMemo(() => {
    const index = dayIndexMap.get(todayKey)
    return Number.isFinite(index) ? index : -1
  }, [dayIndexMap, todayKey])

  const dayCountMap = useMemo(() => {
    const counts = new Map()
    eventsForDisplay.forEach((event) => {
      const day = toDayStart(event.start_at)
      if (!day) return
      const key = day.toISOString()
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return counts
  }, [eventsForDisplay])

  const dayTypeMap = useMemo(() => {
    const map = new Map()
    eventsForDisplay.forEach((event) => {
      const day = toDayStart(event.start_at)
      if (!day) return
      const key = day.toISOString()
      const entry = map.get(key) || {}
      entry[event.event_type] = (entry[event.event_type] || 0) + 1
      map.set(key, entry)
    })
    return map
  }, [eventsForDisplay])

  const focusSummary = useMemo(() => {
    if (!focusedDayKey) return null
    const date = new Date(focusedDayKey)
    if (Number.isNaN(date.getTime())) return null
    const count = dayCountMap.get(focusedDayKey) || 0
    return {
      label: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      count,
    }
  }, [focusedDayKey, dayCountMap])

  const todaySummary = useMemo(() => ({
    label: new Date(todayKey).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    count: dayCountMap.get(todayKey) || 0,
  }), [dayCountMap, todayKey])

  useEffect(() => {
    if (!focusedDayKey) return
    if (!dayIndexMap.has(focusedDayKey)) {
      setFocusedDayKey('')
    }
  }, [focusedDayKey, dayIndexMap])

  const laneData = useMemo(() => {
    const lanes = new Map()
    const eventsByLane = new Map()

    const ensureLane = (lane) => {
      if (!lanes.has(lane.id)) lanes.set(lane.id, lane)
    }

    const addEvent = (lane, event) => {
      ensureLane(lane)
      const list = eventsByLane.get(lane.id) || []
      list.push(event)
      eventsByLane.set(lane.id, list)
    }

    eventsForDisplay.forEach((event) => {
      if (event.assigned_to_all) {
        addEvent({ id: 'everyone', title: 'Everyone', meta: 'All-hands coverage' }, event)
        return
      }

      if (event.assigned_to_user_id) {
        const assignee = userMap.get(String(event.assigned_to_user_id))
        addEvent(
          {
            id: `user:${event.assigned_to_user_id}`,
            title: assignee?.full_name || assignee?.email || `User #${event.assigned_to_user_id}`,
            meta: assignee?.role || 'Assignee',
          },
          event,
        )
        return
      }

      if ((event.assigned_user_ids || []).length > 0) {
        addEvent({ id: 'team', title: 'Team', meta: 'Shared assignment' }, event)
        return
      }

      addEvent({ id: 'unassigned', title: 'Unassigned', meta: 'No owner yet' }, event)
    })

    const specialOrder = ['everyone', 'team', 'unassigned']
    const special = specialOrder.map((id) => lanes.get(id)).filter(Boolean)
    const users = Array.from(lanes.values())
      .filter((lane) => lane.id.startsWith('user:'))
      .sort((a, b) => a.title.localeCompare(b.title))

    return { ordered: [...special, ...users], eventsByLane }
  }, [eventsForDisplay, userMap])

  const laneLayouts = useMemo(() => {
    const layouts = new Map()
    if (rangeDays.length === 0) return layouts

    const rangeStart = rangeDays[0]
    const rangeEnd = rangeDays[rangeDays.length - 1]

    laneData.ordered.forEach((lane) => {
      const rawEvents = laneData.eventsByLane.get(lane.id) || []
      const items = []

      rawEvents.forEach((event) => {
        const startDay = toDayStart(event.start_at)
        let endDay = toDayStart(event.end_at || event.start_at)
        if (!startDay || !endDay) return
        if (endDay < startDay) endDay = startDay
        if (endDay < rangeStart || startDay > rangeEnd) return

        const startKey = startDay.toISOString()
        const endKey = endDay.toISOString()
        let startIndex = dayIndexMap.get(startKey)
        let endIndex = dayIndexMap.get(endKey)

        if (startIndex == null) startIndex = startDay < rangeStart ? 0 : rangeDays.length - 1
        if (endIndex == null) endIndex = endDay > rangeEnd ? rangeDays.length - 1 : 0
        if (startIndex == null || endIndex == null) return

        items.push({ event, startIndex, endIndex })
      })

      const { positioned, rowCount } = packLaneEvents(items)
      layouts.set(lane.id, { positioned, rowCount: Math.max(1, rowCount) })
    })

    return layouts
  }, [laneData, rangeDays, dayIndexMap])

  const heatmapData = useMemo(() => {
    const counts = new Map()
    let max = 0
    if (rangeDays.length === 0) return { counts, max }

    const rangeStart = rangeDays[0]
    const rangeEnd = rangeDays[rangeDays.length - 1]

    laneData.ordered.forEach((lane) => {
      const row = new Array(rangeDays.length).fill(0)
      const eventsForLane = laneData.eventsByLane.get(lane.id) || []

      eventsForLane.forEach((event) => {
        const startDay = toDayStart(event.start_at)
        let endDay = toDayStart(event.end_at || event.start_at)
        if (!startDay || !endDay) return
        if (endDay < startDay) endDay = startDay
        if (endDay < rangeStart || startDay > rangeEnd) return

        const cursor = new Date(startDay)
        cursor.setHours(0, 0, 0, 0)
        while (cursor <= endDay) {
          const key = cursor.toISOString()
          const index = dayIndexMap.get(key)
          if (index != null) {
            row[index] += 1
            if (row[index] > max) max = row[index]
          }
          cursor.setDate(cursor.getDate() + 1)
        }
      })

      counts.set(lane.id, row)
    })

    return { counts, max }
  }, [laneData, rangeDays, dayIndexMap])

  const agendaGroups = useMemo(() => {
    const sorted = [...eventsForDisplay].sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    const groups = []
    let currentKey = null
    sorted.forEach((event) => {
      const dayKey = new Date(event.start_at)
      dayKey.setHours(0, 0, 0, 0)
      const key = dayKey.toISOString()
      if (key !== currentKey) {
        groups.push({ key, date: new Date(dayKey), items: [] })
        currentKey = key
      }
      groups[groups.length - 1].items.push(event)
    })
    return groups
  }, [eventsForDisplay])

  const focusedAgenda = useMemo(() => {
    if (!focusedDayKey || focusedDayKey === todayKey) return null
    const match = agendaGroups.find((group) => group.key === focusedDayKey)
    const date = focusedDayKey ? new Date(focusedDayKey) : null
    return {
      date,
      items: match ? match.items : [],
    }
  }, [focusedDayKey, agendaGroups, todayKey])

  const todayAgenda = useMemo(() => {
    const match = agendaGroups.find((group) => group.key === todayKey)
    return {
      date: new Date(todayKey),
      items: match ? match.items : [],
    }
  }, [agendaGroups, todayKey])

  const remainingAgendaGroups = useMemo(() => {
    const excluded = new Set([todayKey, focusedDayKey].filter(Boolean))
    return agendaGroups.filter((group) => !excluded.has(group.key))
  }, [agendaGroups, todayKey, focusedDayKey])

  const dayColumnWidth = density === 'compact' ? 90 : 120
  const laneRowHeight = density === 'compact' ? 26 : 32

  const dayColumnStyle = useMemo(
    () => ({ gridTemplateColumns: `repeat(${rangeDays.length}, minmax(${dayColumnWidth}px, 1fr))` }),
    [rangeDays.length, dayColumnWidth],
  )

  const dayLabelNodes = useMemo(() => (
    rangeDays.map((day, index) => {
      const key = day.toISOString()
      const isToday = key === todayKey
      const isWeekend = day.getDay() === 0 || day.getDay() === 6
      const isSelected = focusedDayKey === key
      const weekdayLabel = day.toLocaleDateString(undefined, { weekday: 'short' })
      const monthLabel = day.toLocaleDateString(undefined, { month: 'short' })
      const dayNumber = day.getDate()
      const showMonth = dayNumber === 1 || index === 0
      const dayCount = dayCountMap.get(key) || 0
      const dayTypes = dayTypeMap.get(key) || {}
      const taskCount = dayTypes.TASK_DUE || 0
      const leaveCount = dayTypes.LEAVE || 0
      const otherCount = Math.max(0, dayCount - taskCount - leaveCount)
      const stackChips = []
      if (taskCount) stackChips.push({ label: `${taskCount} task${taskCount === 1 ? '' : 's'}`, tone: 'danger' })
      if (leaveCount) stackChips.push({ label: `${leaveCount} leave${leaveCount === 1 ? '' : 's'}`, tone: 'muted' })
      if (otherCount) stackChips.push({ label: `${otherCount} other`, tone: 'info' })
      const showStack = viewMode === 'month' && dayCount > 0
      return (
        <div
          key={key}
          className={`day-label ${isToday ? 'is-today' : ''} ${isWeekend ? 'is-weekend' : ''} ${isSelected ? 'is-selected' : ''}`}
          role="button"
          tabIndex={0}
          aria-pressed={isSelected}
          aria-label={`Focus agenda for ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`}
          onClick={() => focusDay(key)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              focusDay(key)
            }
          }}
          title="Focus agenda for this day"
        >
          <div className="day-label-weekday">{weekdayLabel}</div>
          <div className="day-label-number">{dayNumber}</div>
          {showMonth ? <div className="day-label-month">{monthLabel}</div> : null}
          {dayCount > 0 ? <div className="day-label-count">{dayCount}</div> : null}
          {showStack ? (
            <div className="day-label-stack">
              {stackChips.slice(0, 2).map((chip) => (
                <span key={chip.label} className={`day-chip tone-${chip.tone}`}>{chip.label}</span>
              ))}
              {stackChips.length > 2 ? (
                <span className="day-chip tone-muted">+{stackChips.length - 2}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      )
    })
  ), [rangeDays, todayKey, focusedDayKey, dayCountMap, dayTypeMap, viewMode])

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Site visits, due dates, leave, and operational scheduling in one place."
        actions={(
          <div className="calendar-header-actions">
            <div className="calendar-range">{rangeLabel}</div>
            <div className="calendar-focus-pill">
              {focusSummary
                ? `Focused: ${focusSummary.label} · ${focusSummary.count} item${focusSummary.count === 1 ? '' : 's'}`
                : `Today: ${todaySummary.count} item${todaySummary.count === 1 ? '' : 's'}`}
            </div>
            <Badge tone="info">{eventsForDisplay.length} events</Badge>
          </div>
        )}
      />

      <div className="calendar-toolbar">
        <div className="calendar-view">
          <div className="kicker">View</div>
          <button type="button" className={viewMode === 'day' ? 'secondary' : 'ghost'} onClick={() => applyViewRange('day')}>Day</button>
          <button type="button" className={viewMode === 'week' ? 'secondary' : 'ghost'} onClick={() => applyViewRange('week')}>Week</button>
          <button type="button" className={viewMode === 'month' ? 'secondary' : 'ghost'} onClick={() => applyViewRange('month')}>Month</button>
        </div>

        <div className="calendar-nav">
          <button type="button" className="ghost" onClick={() => shiftRange('prev')}>←</button>
          <button type="button" className="secondary" onClick={() => applyViewRange(viewMode, new Date())}>Today</button>
          <button type="button" className="ghost" onClick={() => shiftRange('next')}>→</button>
        </div>

        <label className="calendar-jump">
          <span className="kicker">Jump</span>
          <input type="date" onChange={(e) => jumpToDate(e.target.value)} />
        </label>

        <div className="calendar-density">
          <div className="kicker">Density</div>
          <button type="button" className={density === 'comfortable' ? 'secondary' : 'ghost'} onClick={() => setDensity('comfortable')}>Comfort</button>
          <button type="button" className={density === 'compact' ? 'secondary' : 'ghost'} onClick={() => setDensity('compact')}>Compact</button>
        </div>

        <button type="button" className="ghost" onClick={() => setSearchParams({})}>Clear</button>
      </div>

      <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
        {EVENT_TYPES.map((type) => (
          <div key={type} className="card tight">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="kicker">{titleCase(type)}</div>
              <InfoTip text="Count of events in the current calendar view." />
            </div>
            <div className="stat-value">{counts.get(type) || 0}</div>
          </div>
        ))}
      </div>

      <div className="calendar-legend">
        {EVENT_TYPES.map((type) => {
          const meta = EVENT_META[type]
          return (
            <div key={type} className={`legend-item tone-${meta.tone}`}>
              <span className="legend-icon">{meta.icon}</span>
              <span>{meta.label}</span>
            </div>
          )
        })}
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(340px, 1fr)' }}>
        <Card>
          <CardHeader
            title="Ops Calendar"
            subtitle="Heatmap, timeline lanes, and agenda in one view."
            action={(
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={panelTab === 'agenda' ? 'secondary' : 'ghost'}
                  onClick={() => setPanelTab('agenda')}
                >
                  Agenda
                </button>
                <button
                  type="button"
                  className={panelTab === 'create' ? 'secondary' : 'ghost'}
                  onClick={() => setPanelTab('create')}
                  aria-label="Create event"
                  title="Create event"
                >
                  +
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setFilters((prev) => ({ ...prev }))}
                >
                  Refresh
                </button>
              </div>
            )}
          />

          <div className="calendar-focus-dock">
            <div className="focus-dock-card">
              <div className="focus-dock-title">Today</div>
              <div className="focus-dock-date">{todaySummary.label}</div>
              <div className="focus-dock-count">{todayAgenda.items.length} item{todayAgenda.items.length === 1 ? '' : 's'}</div>
              {todayAgenda.items.length ? (
                <div className="focus-dock-list">
                  {todayAgenda.items.slice(0, 2).map((event) => (
                    <div key={event.id} className="focus-dock-item">{getEventTitle(event)}</div>
                  ))}
                  {todayAgenda.items.length > 2 ? (
                    <div className="focus-dock-more">+{todayAgenda.items.length - 2} more</div>
                  ) : null}
                </div>
              ) : (
                <div className="focus-dock-empty">No events today.</div>
              )}
            </div>
            <div className={`focus-dock-card ${focusSummary ? 'is-active' : ''}`}>
              <div className="focus-dock-title">Focused Day</div>
              <div className="focus-dock-date">
                {focusSummary ? focusSummary.label : 'Click a date to focus'}
              </div>
              <div className="focus-dock-count">
                {focusSummary ? `${focusSummary.count} item${focusSummary.count === 1 ? '' : 's'}` : 'No focused day'}
              </div>
              {focusedAgenda && focusedAgenda.items.length ? (
                <div className="focus-dock-list">
                  {focusedAgenda.items.slice(0, 2).map((event) => (
                    <div key={event.id} className="focus-dock-item">{getEventTitle(event)}</div>
                  ))}
                  {focusedAgenda.items.length > 2 ? (
                    <div className="focus-dock-more">+{focusedAgenda.items.length - 2} more</div>
                  ) : null}
                </div>
              ) : (
                <div className="focus-dock-empty">Pick a day to review its agenda.</div>
              )}
            </div>
          </div>

          <div className="filter-shell" style={{ marginBottom: '0.8rem' }}>
            <div className="toolbar dense">
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip ${!filters.event_type ? 'active' : ''}`.trim()}
                  onClick={() => updateFilter('event_type', '')}
                  aria-pressed={!filters.event_type}
                >
                  All
                </button>
                {EVENT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`chip ${filters.event_type === type ? 'active' : ''}`.trim()}
                    onClick={() => toggleEventTypeFilter(type)}
                    aria-pressed={filters.event_type === type}
                  >
                    {titleCase(type)}
                  </button>
                ))}
              </div>
              <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
                {filtersOpen ? 'Hide Filters' : 'Filters'}
              </button>
              <Badge tone="info">{eventsForDisplay.length} shown</Badge>
            </div>

            {filtersOpen ? (
              <div className="filter-panel">
                <div className="filter-grid">
                  <select value={filters.assigned_to_user_id} onChange={(e) => updateFilter('assigned_to_user_id', e.target.value)}>
                    <option value="">All Assignees</option>
                    {user ? <option value={user.id}>Me</option> : null}
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                    ))}
                  </select>

                  <select value={filters.event_type} onChange={(e) => updateFilter('event_type', e.target.value)}>
                    <option value="">All Types</option>
                    {EVENT_TYPES.map((type) => (
                      <option key={type} value={type}>{titleCase(type)}</option>
                    ))}
                  </select>

                  <select value={filters.event_label_id} onChange={(e) => updateFilter('event_label_id', e.target.value)}>
                    <option value="">All Labels</option>
                    {labels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                  </select>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="kicker" style={{ marginTop: 2 }}>From</span>
                    <input
                      type="datetime-local"
                      value={isoToLocalInputValue(filters.start_from)}
                      onChange={(e) => updateFilter('start_from', toIso(e.target.value))}
                    />
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="kicker" style={{ marginTop: 2 }}>To</span>
                    <input
                      type="datetime-local"
                      value={isoToLocalInputValue(filters.start_to)}
                      onChange={(e) => updateFilter('start_to', toIso(e.target.value))}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </div>

          {error ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div> : null}

          {loading ? (
            <div className="muted">Loading events…</div>
          ) : eventsForDisplay.length === 0 ? (
            <EmptyState>No events found for the current filters.</EmptyState>
          ) : (
            <div className="calendar-workspace">
              <section className="calendar-section">
                <div className="calendar-section-header">
                  <div>
                    <div className="section-title">Workload Heatmap</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Volume by assignee across the selected range. Click a date to focus the agenda.
                    </div>
                  </div>
                  <div className="heatmap-legend">
                    <span className="kicker">Load</span>
                    <div className="heatmap-legend-bar">
                      {[0, 1, 2, 3, 4].map((level) => (
                        <span key={level} className={`heatmap-cell heat-${level}`} />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="calendar-board heatmap-board">
                  <div className="board-scroll">
                    <div className="board-header">
                      <div className="board-title">Assignee</div>
                      <div className="day-labels" style={dayColumnStyle}>
                        {dayLabelNodes}
                      </div>
                    </div>
                    <div className="board-rows">
                      {laneData.ordered.map((lane) => {
                        const row = heatmapData.counts.get(lane.id) || []
                        return (
                          <div key={lane.id} className="board-row">
                            <div>
                              <div className="board-title">{lane.title}</div>
                              <div className="board-subtitle">{lane.meta}</div>
                            </div>
                            <div className="heatmap-cells" style={dayColumnStyle}>
                              {rangeDays.map((day, index) => {
                                const dayKey = day.toISOString()
                                const value = row[index] || 0
                                const level = getHeatLevel(value, heatmapData.max)
                                return (
                                  <div
                                    key={`${lane.id}-${dayKey}`}
                                    className={`heatmap-cell heat-${level} ${focusedDayKey === dayKey ? 'is-selected' : ''}`}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={focusedDayKey === dayKey}
                                    aria-label={`${day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${value} event${value === 1 ? '' : 's'}`}
                                    title={`${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${value} event${value === 1 ? '' : 's'}`}
                                    onClick={() => focusDay(dayKey)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        focusDay(dayKey)
                                      }
                                    }}
                                  />
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <section className="calendar-section">
                <div className="calendar-section-header">
                  <div>
                    <div className="section-title">Ops Timeline</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Bars span days; click to open the assignment or leave request.
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {rangeDays.length} days shown
                  </div>
                </div>

                <div className="calendar-board lane-board">
                  <div className="board-scroll">
                    <div className="board-header">
                      <div className="board-title">Assignee</div>
                      <div className="day-labels" style={dayColumnStyle}>
                        {dayLabelNodes}
                      </div>
                    </div>
                    <div className="board-rows">
                      {laneData.ordered.map((lane) => {
                        const layout = laneLayouts.get(lane.id) || { positioned: [], rowCount: 1 }
                        const laneEvents = laneData.eventsByLane.get(lane.id) || []
                        return (
                          <div key={lane.id} className="board-row lane-row">
                            <div>
                              <div className="board-title">{lane.title}</div>
                              <div className="board-subtitle">{lane.meta}</div>
                              <div className="muted" style={{ fontSize: 12 }}>
                                {laneEvents.length} items
                              </div>
                            </div>
                            <div
                              className={`lane-grid ${density}`}
                              style={{
                                gridTemplateColumns: `repeat(${rangeDays.length}, minmax(${dayColumnWidth}px, 1fr))`,
                                gridTemplateRows: `repeat(${layout.rowCount}, minmax(${laneRowHeight}px, auto))`,
                                '--lane-row-height': `${laneRowHeight}px`,
                              }}
                            >
                              {rangeDays.map((day, index) => {
                                const key = day.toISOString()
                                const isToday = key === todayKey
                                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                                const isSelected = focusedDayKey === key
                                return (
                                  <div
                                    key={`${lane.id}-${key}-bg`}
                                    className={`lane-day ${isToday ? 'is-today' : ''} ${isWeekend ? 'is-weekend' : ''} ${isSelected ? 'is-selected' : ''}`}
                                    style={{ gridColumn: index + 1, gridRow: `1 / ${layout.rowCount + 1}` }}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={isSelected}
                                    aria-label={`Focus agenda for ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`}
                                    onClick={() => focusDay(key)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        focusDay(key)
                                      }
                                    }}
                                  />
                                )
                              })}
                              {todayIndex >= 0 ? (
                                <div
                                  className="lane-today-marker"
                                  style={{ gridColumn: todayIndex + 1, gridRow: `1 / ${layout.rowCount + 1}` }}
                                  aria-hidden="true"
                                />
                              ) : null}
                              {layout.positioned.map((item) => {
                                const { event, startIndex, endIndex, laneRow } = item
                                const meta = EVENT_META[event.event_type] || { icon: '📌', tone: 'accent', label: event.event_type }
                                const timeLabel = formatTimeRange(event.start_at, event.end_at, event.all_day)
                                const assignmentLabel = event.assignment_code || (event.assignment_id ? `#${event.assignment_id}` : '')
                                const assigneeLabel = getAssigneeLabel(event)
                                const displayTitle = getEventTitle(event)
                                const detailParts = [meta.label]
                                if (timeLabel) detailParts.push(timeLabel)
                                if (assignmentLabel) detailParts.push(assignmentLabel)
                                if (assigneeLabel) detailParts.push(assigneeLabel)
                                const detail = detailParts.join(' · ')
                                return (
                                  <div
                                    key={event.id}
                                    className={`lane-event tone-${meta.tone}`}
                                    style={{ gridColumn: `${startIndex + 1} / ${endIndex + 2}`, gridRow: laneRow + 1 }}
                                    onClick={() => handleEventNavigate(event)}
                                    role="button"
                                    tabIndex={0}
                                    title={`${displayTitle} — ${detail}`}
                                  >
                                    <span className="lane-event-icon">{meta.icon}</span>
                                    <div className="lane-event-text">
                                      <div className="lane-event-title">{displayTitle}</div>
                                      <div className="lane-event-meta">{detail}</div>
                                    </div>
                                    <button
                                      type="button"
                                      className="ghost lane-event-delete"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteEvent(event)
                                      }}
                                      disabled={event.event_type === 'LEAVE' && !canSeeAdmin(capabilities)}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </Card>

        <div ref={createPanelRef}>
        <Card>
          {panelTab === 'agenda' ? (
            <>
              <CardHeader
                title="Agenda"
                subtitle="Today first, then focused day, then the rest of the range."
              />
              <div className="agenda-focus">
                <div className="agenda-section">
                  <div className="agenda-focus-header">
                    <div>
                      <div className="agenda-focus-title">Today</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {todayAgenda.items.length} item{todayAgenda.items.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    {focusedDayKey ? (
                      <button type="button" className="ghost" onClick={() => setFocusedDayKey('')}>Clear focus</button>
                    ) : null}
                  </div>
                  {todayAgenda.items.length ? (
                    <div className="agenda-items">
                      {todayAgenda.items.map((event) => {
                        const meta = EVENT_META[event.event_type] || { icon: '📌', tone: 'accent', label: event.event_type }
                        const labelName = event.event_label_name || (event.event_label_id ? labelMap.get(String(event.event_label_id))?.name : null)
                        const timeLabel = formatTimeRange(event.start_at, event.end_at, event.all_day)
                        const assigneeLabel = getAssigneeLabel(event)
                        const displayTitle = getEventTitle(event)
                        return (
                          <button
                            key={event.id}
                            type="button"
                            className={`agenda-item tone-${meta.tone}`}
                            onClick={() => handleEventNavigate(event)}
                          >
                            <div className="agenda-icon">{meta.icon}</div>
                            <div className="agenda-body">
                              <div className="agenda-title">{displayTitle}</div>
                              <div className="muted" style={{ fontSize: 12 }}>
                                {meta.label} · {timeLabel || formatDateTime(event.start_at)}
                              </div>
                              <div className="agenda-meta">
                                {event.assignment_code ? <span className="badge muted">{event.assignment_code}</span> : null}
                                {labelName ? <span className="badge info">{labelName}</span> : null}
                                {assigneeLabel ? <span className="badge">{assigneeLabel}</span> : null}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <EmptyState>No events scheduled for today.</EmptyState>
                  )}
                </div>

                {focusedAgenda ? (
                  <div className="agenda-section">
                    <div className="agenda-focus-header">
                      <div>
                        <div className="agenda-focus-title">
                          {focusedAgenda.date
                            ? focusedAgenda.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
                            : 'Focused day'}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {focusedAgenda.items.length} item{focusedAgenda.items.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <button type="button" className="ghost" onClick={() => setFocusedDayKey('')}>Clear focus</button>
                    </div>
                    {focusedAgenda.items.length ? (
                      <div className="agenda-items">
                        {focusedAgenda.items.map((event) => {
                        const meta = EVENT_META[event.event_type] || { icon: '📌', tone: 'accent', label: event.event_type }
                        const labelName = event.event_label_name || (event.event_label_id ? labelMap.get(String(event.event_label_id))?.name : null)
                        const timeLabel = formatTimeRange(event.start_at, event.end_at, event.all_day)
                        const assigneeLabel = getAssigneeLabel(event)
                        const displayTitle = getEventTitle(event)
                        return (
                          <button
                            key={event.id}
                            type="button"
                            className={`agenda-item tone-${meta.tone}`}
                            onClick={() => handleEventNavigate(event)}
                          >
                            <div className="agenda-icon">{meta.icon}</div>
                            <div className="agenda-body">
                              <div className="agenda-title">{displayTitle}</div>
                              <div className="muted" style={{ fontSize: 12 }}>
                                {meta.label} · {timeLabel || formatDateTime(event.start_at)}
                              </div>
                              <div className="agenda-meta">
                                {event.assignment_code ? <span className="badge muted">{event.assignment_code}</span> : null}
                                  {labelName ? <span className="badge info">{labelName}</span> : null}
                                  {assigneeLabel ? <span className="badge">{assigneeLabel}</span> : null}
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <EmptyState>No events scheduled for this day.</EmptyState>
                    )}
                  </div>
                ) : null}

                {remainingAgendaGroups.length === 0 ? (
                  <EmptyState>No other events in this range.</EmptyState>
                ) : (
                  <div className="agenda-list">
                    {remainingAgendaGroups.map((group) => (
                      <div key={group.key} className="agenda-group">
                        <div className="agenda-date">
                          {group.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                        </div>
                        <div className="agenda-items">
                          {group.items.map((event) => {
                            const meta = EVENT_META[event.event_type] || { icon: '📌', tone: 'accent', label: event.event_type }
                            const labelName = event.event_label_name || (event.event_label_id ? labelMap.get(String(event.event_label_id))?.name : null)
                            const timeLabel = formatTimeRange(event.start_at, event.end_at, event.all_day)
                            const assigneeLabel = getAssigneeLabel(event)
                            const displayTitle = getEventTitle(event)
                            return (
                              <button
                                key={event.id}
                                type="button"
                                className={`agenda-item tone-${meta.tone}`}
                                onClick={() => handleEventNavigate(event)}
                              >
                                <div className="agenda-icon">{meta.icon}</div>
                                <div className="agenda-body">
                                  <div className="agenda-title">{displayTitle}</div>
                                  <div className="muted" style={{ fontSize: 12 }}>
                                    {meta.label} · {timeLabel || formatDateTime(event.start_at)}
                                  </div>
                                  <div className="agenda-meta">
                                    {event.assignment_code ? <span className="badge muted">{event.assignment_code}</span> : null}
                                    {labelName ? <span className="badge info">{labelName}</span> : null}
                                    {assigneeLabel ? <span className="badge">{assigneeLabel}</span> : null}
                                  </div>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <CardHeader
                title="Create Event"
                subtitle="Log a site visit, due date, meeting, or reminder."
              />

              <form className="grid" onSubmit={handleCreateEvent}>
            <div className="grid cols-3 tight-cols">
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Type</span>
                <select value={form.event_type} onChange={(e) => updateForm('event_type', e.target.value)}>
                  {EVENT_TYPES.filter((type) => type !== 'LEAVE').map((type) => (
                    <option key={type} value={type}>{titleCase(type)}</option>
                  ))}
                </select>
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Label</span>
                <select value={form.event_label_id} onChange={(e) => handleLabelChange(e.target.value)}>
                  <option value="">No label</option>
                  {labels.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Assignee</span>
                <select
                  value={form.assigned_to_user_id}
                  onChange={(e) => updateForm('assigned_to_user_id', e.target.value)}
                  disabled={form.assigned_to_all}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                  ))}
                </select>
              </label>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={form.assigned_to_all}
                onChange={(e) => handleAssignToAllChange(e.target.checked)}
              />
              Assign to everyone
            </label>

            {!form.assigned_to_all ? (
              <div>
                <div className="kicker" style={{ marginBottom: 6 }}>Additional Assignees</div>
                <div style={{ maxHeight: 180, overflow: 'auto', paddingRight: 4 }}>
                  <div className="grid cols-2" style={{ gap: 8 }}>
                    {users.map((u) => {
                      const isPrimary = String(u.id) === String(form.assigned_to_user_id)
                      const checked = form.assigned_user_ids.includes(String(u.id))
                      return (
                        <label key={u.id} className="list-item" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <input
                            type="checkbox"
                            checked={isPrimary || checked}
                            disabled={isPrimary}
                            onChange={() => toggleEventAssignee(u.id)}
                          />
                          <div>
                            <div style={{ fontWeight: 600 }}>{u.full_name || u.email}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{u.role}</div>
                            {isPrimary ? <Badge tone="info">Primary</Badge> : null}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            <label className="grid" style={{ gap: 6 }}>
              <span className="kicker">Title</span>
              <input value={form.title} onChange={(e) => updateForm('title', e.target.value)} placeholder="Site visit - borrower meeting" />
            </label>

            <label className="grid" style={{ gap: 6 }}>
              <span className="kicker">Description</span>
              <textarea value={form.description} onChange={(e) => updateForm('description', e.target.value)} rows={3} placeholder="Optional details, address cues, or prep notes." />
            </label>

            <div className="grid cols-2">
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Start</span>
                <input type="datetime-local" value={form.start_at} onChange={(e) => updateForm('start_at', e.target.value)} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">End</span>
                <input type="datetime-local" value={form.end_at} onChange={(e) => updateForm('end_at', e.target.value)} />
              </label>
            </div>

            <button type="submit">Create Event</button>
            <div className="muted" style={{ fontSize: 12 }}>
              Leave events are automatically created from approved leave requests.
            </div>
              </form>
            </>
          )}
        </Card>
        </div>
      </div>
      <button
        type="button"
        className="calendar-fab"
        onClick={() => {
          setPanelTab('create')
          createPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
        aria-label="Create event"
        title="Create event"
      >
        +
      </button>
    </div>
  )
}
