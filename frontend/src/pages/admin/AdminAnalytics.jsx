import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import InfoTip from '../../components/ui/InfoTip'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import {
  fetchBankAnalytics,
  fetchServiceLineAnalytics,
  fetchCaseTypeAnalytics,
  fetchAnalyticsSettings,
  updateAnalyticsSettings,
  fetchAnalyticsSignals,
  fetchRelationshipLogs,
  createRelationshipLog,
  fetchForecastV2,
  fetchWeeklyDigest,
  createVisitReminder,
  exportAnalyticsPdf,
  fetchPartnerSummary,
  fetchPartnerBankBreakdown,
} from '../../api/analytics'
import { formatDate, formatDateTime, formatMoney, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { loadJson, saveJson } from '../../utils/storage'

const RANGE_PRESETS = [
  { key: 'last-30', label: 'Last 30 Days', days: 30 },
  { key: 'last-90', label: 'Last 90 Days', days: 90 },
  { key: 'last-6', label: 'Last 6 Months', months: 6 },
  { key: 'last-12', label: 'Last 12 Months', months: 12 },
  { key: 'custom', label: 'Custom', custom: true },
]

const VIEW_MODES = [
  { key: 'banks', label: 'By Bank (Branches)' },
  { key: 'service-lines', label: 'By Service Line' },
  { key: 'case-types', label: 'By Case Type' },
]

const FILTERS_KEY = 'zenops.analytics.filters.v1'

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function rangeFromPreset(presetKey) {
  const preset = RANGE_PRESETS.find((p) => p.key === presetKey) || RANGE_PRESETS[2]
  const now = new Date()
  if (preset.days) {
    const start = new Date(now)
    start.setDate(start.getDate() - (preset.days - 1))
    return { start: startOfDay(start), end: endOfDay(now) }
  }
  if (preset.months) {
    const base = new Date(now.getFullYear(), now.getMonth(), 1)
    const start = new Date(base)
    start.setMonth(base.getMonth() - (preset.months - 1))
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { start: startOfDay(start), end: endOfDay(end) }
  }
  return { start: startOfDay(now), end: endOfDay(now) }
}

function toInputDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function fromInputDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function changeLabel(value) {
  if (value === null || value === undefined) return '-'
  const pct = Math.round(value * 100)
  return `${pct > 0 ? '+' : ''}${pct}%`
}

function changeTone(value) {
  if (value === null || value === undefined) return 'muted'
  if (value >= 0.2) return 'ok'
  if (value <= -0.2) return 'danger'
  return 'info'
}

function healthTone(label) {
  if (label === 'Healthy') return 'ok'
  if (label === 'Watch') return 'warn'
  if (label === 'At Risk') return 'danger'
  return 'muted'
}

function forecastLabel(forecast) {
  if (!forecast) return '-'
  const range = `${forecast.expected_assignments_low}-${forecast.expected_assignments_high}`
  return `${forecast.expected_assignments} (${range})`
}

function healthTip(row) {
  if (!row) return ''
  const reasons = row.health_reasons?.length ? row.health_reasons.join('; ') : 'No risk flags.'
  return `Score ${row.health_score}. ${reasons}`
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export default function AdminAnalytics() {
  const navigate = useNavigate()
  const storedFilters = loadJson(FILTERS_KEY, {})
  const initialViewMode = storedFilters.viewMode || 'banks'
  const initialPreset = storedFilters.preset || 'last-6'
  const storedStart = storedFilters.rangeStart ? new Date(storedFilters.rangeStart) : null
  const storedEnd = storedFilters.rangeEnd ? new Date(storedFilters.rangeEnd) : null
  const hasStoredRange = initialPreset === 'custom'
    && storedStart
    && storedEnd
    && !Number.isNaN(storedStart.getTime())
    && !Number.isNaN(storedEnd.getTime())

  const [viewMode, setViewMode] = useState(initialViewMode)
  const [preset, setPreset] = useState(initialPreset)
  const [range, setRange] = useState(() => (
    hasStoredRange ? { start: storedStart, end: storedEnd } : rangeFromPreset(initialPreset)
  ))
  const [includeNonBank, setIncludeNonBank] = useState(Boolean(storedFilters.includeNonBank))
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [bankData, setBankData] = useState(null)
  const [segmentData, setSegmentData] = useState(null)
  const [signals, setSignals] = useState([])
  const [signalsError, setSignalsError] = useState(null)
  const [forecastV2, setForecastV2] = useState(null)
  const [forecastV2Error, setForecastV2Error] = useState(null)
  const [digest, setDigest] = useState(null)
  const [digestError, setDigestError] = useState(null)
  const [visitNotice, setVisitNotice] = useState(null)
  const [visitLoading, setVisitLoading] = useState(false)

  const [settingsData, setSettingsData] = useState(null)
  const [settingsForm, setSettingsForm] = useState(null)
  const [settingsNotice, setSettingsNotice] = useState(null)

  const [expandedBanks, setExpandedBanks] = useState(new Set())
  const [selectedEntity, setSelectedEntity] = useState(null)
  const [relationshipLogs, setRelationshipLogs] = useState([])
  const [logForm, setLogForm] = useState({ note: '', next_follow_up_date: '' })

  const [partnerSummary, setPartnerSummary] = useState([])
  const [partnerSummaryError, setPartnerSummaryError] = useState(null)
  const [partnerLoading, setPartnerLoading] = useState(false)
  const [selectedPartnerId, setSelectedPartnerId] = useState('')
  const [partnerBreakdown, setPartnerBreakdown] = useState([])
  const [partnerBreakdownError, setPartnerBreakdownError] = useState(null)

  function resolveClientId(row) {
    if (!row) return null
    if (row.entity_id) return row.entity_id
    if (row.entity_key && row.entity_key.startsWith('CLIENT:')) {
      const token = row.entity_key.split(':')[1]
      const parsed = Number(token)
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }

  function buildAssignmentParams(row) {
    if (!row?.entity_type) return null
    const params = new URLSearchParams()
    params.set('completion', 'ALL')
    if (row.entity_type === 'BANK') {
      params.set('case_type', 'BANK')
      if (row.entity_id) params.set('bank_id', String(row.entity_id))
    }
    if (row.entity_type === 'BRANCH') {
      params.set('case_type', 'BANK')
      if (row.entity_id) params.set('branch_id', String(row.entity_id))
    }
    if (row.entity_type === 'SERVICE_LINE') {
      params.set('service_line', row.entity_label)
    }
    if (row.entity_type === 'CASE_TYPE') {
      params.set('case_type', row.entity_label)
    }
    if (row.entity_type === 'CLIENT') {
      const clientId = resolveClientId(row)
      if (clientId) params.set('client_id', String(clientId))
      else return null
    }
    return params
  }

  function handleOpenAssignments(row) {
    const params = buildAssignmentParams(row)
    if (!params) return
    navigate(`/assignments?${params.toString()}`)
  }

  const exportRows = useMemo(() => {
    const rows = []
    if (viewMode === 'banks' && bankData) {
      bankData.banks?.forEach((bank) => {
        rows.push({ parent: '', ...bank })
        bank.children?.forEach((branch) => {
          rows.push({ parent: bank.entity_label, ...branch })
        })
      })
      if (includeNonBank) {
        bankData.non_bank_sources?.forEach((client) => {
          rows.push({ parent: 'Non Bank', ...client })
        })
      }
    } else if (segmentData?.rows?.length) {
      segmentData.rows.forEach((row) => rows.push({ parent: '', ...row }))
    }
    return rows
  }, [viewMode, bankData, segmentData, includeNonBank])

  function handleExportCsv() {
    if (!exportRows.length) {
      setError('No analytics rows to export.')
      return
    }
    const headers = [
      'entity_type',
      'entity_label',
      'parent_label',
      'assignments',
      'assignments_change_pct',
      'billed',
      'billed_change_pct',
      'collected',
      'outstanding',
      'health_label',
      'health_score',
      'last_assignment_at',
      'forecast_expected',
      'forecast_low',
      'forecast_high',
    ]
    const rows = exportRows.map((row) => ([
      row.entity_type || '',
      row.entity_label || '',
      row.parent || '',
      row.assignments ?? '',
      row.assignments_change_pct ?? '',
      row.billed ?? '',
      row.billed_change_pct ?? '',
      row.collected ?? '',
      row.outstanding ?? '',
      row.health_label || '',
      row.health_score ?? '',
      row.last_assignment_at || '',
      row.forecast?.expected_assignments ?? '',
      row.forecast?.expected_assignments_low ?? '',
      row.forecast?.expected_assignments_high ?? '',
    ]))
    const csvContent = [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `analytics_${viewMode}_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  }

  async function handleExportPdf() {
    try {
      const params = {
        view_mode: viewMode,
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        include_non_bank: includeNonBank,
      }
      const blob = await exportAnalyticsPdf(params)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `analytics_${viewMode}_${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to export PDF'))
    }
  }

  useEffect(() => {
    if (preset === 'custom') return
    setRange(rangeFromPreset(preset))
  }, [preset])

  useEffect(() => {
    saveJson(FILTERS_KEY, {
      viewMode,
      preset,
      includeNonBank,
      rangeStart: range?.start ? range.start.toISOString() : null,
      rangeEnd: range?.end ? range.end.toISOString() : null,
    })
  }, [viewMode, preset, includeNonBank, range])

  useEffect(() => {
    setSelectedEntity(null)
    setExpandedBanks(new Set())
  }, [viewMode])

  useEffect(() => {
    let cancelled = false
    async function loadSettings() {
      try {
        const data = await fetchAnalyticsSettings()
        if (cancelled) return
        setSettingsData(data)
        if (data?.settings) {
          setSettingsForm({
            time_window_days: data.settings.time_window_days,
            decline_threshold_count: Number(data.settings.decline_threshold_count) * 100,
            decline_threshold_revenue: Number(data.settings.decline_threshold_revenue) * 100,
            inactivity_days: data.settings.inactivity_days,
            baseline_min_count: data.settings.baseline_min_count,
            baseline_min_revenue: data.settings.baseline_min_revenue,
            followup_cooldown_days: data.settings.followup_cooldown_days,
            outstanding_threshold: data.settings.outstanding_threshold,
          })
        }
      } catch (err) {
        console.error(err)
      }
    }
    loadSettings()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadAnalytics() {
      setLoading(true)
      setError(null)
      const params = {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      }
      try {
        if (viewMode === 'banks') {
          const data = await fetchBankAnalytics({ ...params, include_non_bank: includeNonBank })
          if (!cancelled) setBankData(data)
        } else if (viewMode === 'service-lines') {
          const data = await fetchServiceLineAnalytics(params)
          if (!cancelled) setSegmentData(data)
        } else {
          const data = await fetchCaseTypeAnalytics(params)
          if (!cancelled) setSegmentData(data)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load analytics'))
        if (!cancelled) setLoading(false)
        return
      }

      try {
        const signalWindowDays = settingsData?.settings?.time_window_days
        let signalParams = { ...params, create_tasks: true }
        if (signalWindowDays) {
          const end = new Date()
          const start = new Date(end)
          start.setDate(start.getDate() - (signalWindowDays - 1))
          signalParams = { start: start.toISOString(), end: end.toISOString(), create_tasks: true }
        }
        const signalData = await fetchAnalyticsSignals(signalParams)
        if (!cancelled) {
          setSignals(signalData)
          setSignalsError(null)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setSignals([])
          setSignalsError(toUserMessage(err, 'Signals temporarily unavailable'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAnalytics()
    return () => {
      cancelled = true
    }
  }, [viewMode, range, includeNonBank, settingsData])

  useEffect(() => {
    if (!selectedEntity || !['BANK', 'BRANCH'].includes(selectedEntity.entity_type)) {
      setRelationshipLogs([])
      return
    }
    let cancelled = false
    async function loadLogs() {
      try {
        const data = await fetchRelationshipLogs({
          entity_type: selectedEntity.entity_type,
          entity_id: selectedEntity.entity_id,
        })
        if (!cancelled) setRelationshipLogs(data)
      } catch (err) {
        console.error(err)
      }
    }
    loadLogs()
    return () => {
      cancelled = true
    }
  }, [selectedEntity])

  useEffect(() => {
    if (!selectedEntity) {
      setForecastV2(null)
      setForecastV2Error(null)
      setVisitNotice(null)
      return
    }
    if (!['BANK', 'BRANCH', 'SERVICE_LINE', 'CASE_TYPE'].includes(selectedEntity.entity_type)) {
      setForecastV2(null)
      setForecastV2Error(null)
      return
    }
    let cancelled = false
    async function loadForecastV2() {
      try {
        const params = { entity_type: selectedEntity.entity_type }
        if (selectedEntity.entity_type === 'BANK' || selectedEntity.entity_type === 'BRANCH') {
          if (!selectedEntity.entity_id) {
            throw new Error('Missing entity id')
          }
          params.entity_id = selectedEntity.entity_id
        } else if (selectedEntity.entity_type === 'SERVICE_LINE') {
          params.service_line = selectedEntity.entity_label
        } else if (selectedEntity.entity_type === 'CASE_TYPE') {
          params.case_type = selectedEntity.entity_label
        }
        const data = await fetchForecastV2(params)
        if (!cancelled) {
          setForecastV2(data)
          setForecastV2Error(null)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setForecastV2(null)
          setForecastV2Error(toUserMessage(err, 'Forecast v2 unavailable'))
        }
      }
    }
    loadForecastV2()
    return () => {
      cancelled = true
    }
  }, [selectedEntity])

  useEffect(() => {
    let cancelled = false
    async function loadPartnerSummary() {
      setPartnerLoading(true)
      setPartnerSummaryError(null)
      try {
        const data = await fetchPartnerSummary()
        if (!cancelled) {
          setPartnerSummary(data)
          if (!selectedPartnerId && data.length > 0) {
            setSelectedPartnerId(String(data[0].id))
          }
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setPartnerSummaryError(toUserMessage(err, 'Partner summary unavailable'))
      } finally {
        if (!cancelled) setPartnerLoading(false)
      }
    }
    loadPartnerSummary()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedPartnerId) {
      setPartnerBreakdown([])
      return
    }
    let cancelled = false
    async function loadPartnerBreakdown() {
      setPartnerBreakdownError(null)
      try {
        const data = await fetchPartnerBankBreakdown(Number(selectedPartnerId))
        if (!cancelled) setPartnerBreakdown(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setPartnerBreakdownError(toUserMessage(err, 'Partner breakdown unavailable'))
      }
    }
    loadPartnerBreakdown()
    return () => {
      cancelled = true
    }
  }, [selectedPartnerId])

  const overview = viewMode === 'banks' ? bankData?.overview : segmentData?.overview

  const topBanks = useMemo(() => {
    if (!bankData?.banks) return []
    return [...bankData.banks].sort((a, b) => b.billed - a.billed).slice(0, 3)
  }, [bankData])

  const topBranches = useMemo(() => {
    if (!bankData?.banks) return []
    const branches = bankData.banks.flatMap((bank) => bank.children || [])
    return branches.sort((a, b) => b.assignments - a.assignments).slice(0, 3)
  }, [bankData])

  const topDeclines = useMemo(() => {
    if (!bankData?.banks) return []
    const rows = bankData.banks.flatMap((bank) => [bank, ...(bank.children || [])])
    return rows
      .filter((row) => row.assignments_change_pct !== null && row.assignments_change_pct < 0)
      .sort((a, b) => (a.assignments_change_pct || 0) - (b.assignments_change_pct || 0))
      .slice(0, 3)
  }, [bankData])

  const topPartnersByVolume = useMemo(() => (
    [...partnerSummary].sort((a, b) => (b.commission_count || 0) - (a.commission_count || 0)).slice(0, 5)
  ), [partnerSummary])

  const topPartnersByOutstanding = useMemo(() => (
    [...partnerSummary].sort((a, b) => Number(b.unpaid_total || 0) - Number(a.unpaid_total || 0)).slice(0, 5)
  ), [partnerSummary])

  const selectedPartner = useMemo(
    () => partnerSummary.find((p) => String(p.id) === String(selectedPartnerId)),
    [partnerSummary, selectedPartnerId],
  )

  const segmentTotalAssignments = useMemo(() => {
    if (!segmentData?.rows) return 0
    return segmentData.rows.reduce((sum, row) => sum + row.assignments, 0)
  }, [segmentData])

  function toggleExpand(key) {
    setExpandedBanks((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  async function handleSaveSettings(e) {
    e.preventDefault()
    if (!settingsForm) return
    setSettingsNotice(null)
    try {
      const payload = {
        time_window_days: Number(settingsForm.time_window_days),
        decline_threshold_count: Number(settingsForm.decline_threshold_count) / 100,
        decline_threshold_revenue: Number(settingsForm.decline_threshold_revenue) / 100,
        inactivity_days: Number(settingsForm.inactivity_days),
        baseline_min_count: Number(settingsForm.baseline_min_count),
        baseline_min_revenue: Number(settingsForm.baseline_min_revenue),
        followup_cooldown_days: Number(settingsForm.followup_cooldown_days),
        outstanding_threshold: Number(settingsForm.outstanding_threshold),
      }
      const updated = await updateAnalyticsSettings(payload)
      setSettingsData((prev) => (prev ? { ...prev, settings: updated } : prev))
      setSettingsNotice('Threshold settings saved.')
    } catch (err) {
      console.error(err)
      setSettingsNotice(toUserMessage(err, 'Failed to save settings'))
    }
  }

  async function handleAddLog(e) {
    e.preventDefault()
    if (!selectedEntity || !logForm.note.trim()) return
    try {
      await createRelationshipLog({
        entity_type: selectedEntity.entity_type,
        entity_id: selectedEntity.entity_id,
        entity_label: selectedEntity.entity_label,
        note: logForm.note.trim(),
        next_follow_up_date: logForm.next_follow_up_date || null,
      })
      setLogForm({ note: '', next_follow_up_date: '' })
      const logs = await fetchRelationshipLogs({
        entity_type: selectedEntity.entity_type,
        entity_id: selectedEntity.entity_id,
      })
      setRelationshipLogs(logs)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleCreateVisitReminder() {
    if (!selectedEntity) return
    setVisitNotice(null)
    setVisitLoading(true)
    try {
      const payload = {
        entity_type: selectedEntity.entity_type,
        entity_id: selectedEntity.entity_id,
        entity_label: selectedEntity.entity_label,
        note: selectedEntity.health_reasons?.length ? selectedEntity.health_reasons.join('; ') : null,
      }
      const data = await createVisitReminder(payload)
      setVisitNotice(`Reminder scheduled for ${formatDate(data.start_at)}.`)
    } catch (err) {
      console.error(err)
      setVisitNotice(toUserMessage(err, 'Failed to create visit reminder'))
    } finally {
      setVisitLoading(false)
    }
  }

  async function handleLoadDigest() {
    setDigestError(null)
    try {
      const data = await fetchWeeklyDigest({ days: 7 })
      setDigest(data)
    } catch (err) {
      console.error(err)
      setDigest(null)
      setDigestError(toUserMessage(err, 'Weekly digest unavailable'))
    }
  }

  const recommended = settingsData?.recommended
  const performanceTitle = viewMode === 'banks'
    ? 'Bank & Branch Performance'
    : viewMode === 'service-lines'
      ? 'Service Line Performance'
      : 'Case Type Mix'

  return (
    <div>
      <PageHeader
        title="Analytics & Intelligence"
        subtitle="Forecast momentum, detect declines early, and trigger follow-ups."
        actions={null}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      <div className="filter-shell" style={{ marginBottom: '0.9rem' }}>
        <div className="toolbar dense">
          <div className="chip-row">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`chip ${viewMode === mode.key ? 'active' : ''}`.trim()}
                onClick={() => setViewMode(mode.key)}
                aria-pressed={viewMode === mode.key}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
            {filtersOpen ? 'Hide Filters' : 'Filters'}
          </button>
          <button type="button" className="secondary" onClick={handleExportCsv}>
            Export CSV
          </button>
          <button type="button" className="secondary" onClick={handleExportPdf}>
            Export PDF
          </button>
          {overview ? (
            <Badge tone="info">
              {formatDate(overview.period_start)} {"->"} {formatDate(overview.period_end)}
            </Badge>
          ) : null}
        </div>
        {filtersOpen ? (
          <div className="filter-panel">
            <div className="filter-grid">
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="kicker">Range Preset</span>
                <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {RANGE_PRESETS.map((opt) => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </label>
              {preset === 'custom' ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  <span className="kicker">Custom Range</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      type="date"
                      value={toInputDate(range.start)}
                      onChange={(e) => {
                        const start = fromInputDate(e.target.value)
                        if (start) setRange((prev) => ({ ...prev, start }))
                      }}
                    />
                    <input
                      type="date"
                      value={toInputDate(range.end)}
                      onChange={(e) => {
                        const end = fromInputDate(e.target.value)
                        if (end) setRange((prev) => ({ ...prev, end }))
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {viewMode === 'banks' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={includeNonBank}
                    onChange={(e) => setIncludeNonBank(e.target.checked)}
                  />
                  Include Direct/External clients
                </label>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {loading ? (
        <>
          <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={`sk-analytic-${idx}`} className="card tight">
                <div className="skeleton-line short" style={{ marginBottom: '0.6rem' }} />
                <div className="skeleton-line" style={{ height: 20 }} />
              </div>
            ))}
          </div>
          <Card>
            <CardHeader title={performanceTitle} subtitle="Forecasting, decline detection, and health scoring." />
            <DataTable loading columns={9} rows={6} />
          </Card>
        </>
      ) : !overview ? (
        <EmptyState>No analytics data found.</EmptyState>
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
            <OverviewCard label="Assignments" value={overview.assignments} help="Assignments created in the selected period." />
            <OverviewCard label="Billed" value={formatMoney(overview.billed)} help="Invoices issued in the selected period." />
            <OverviewCard label="Collected" value={formatMoney(overview.collected)} tone="ok" help="Paid invoices in the selected period." />
            <OverviewCard label="Outstanding" value={formatMoney(overview.outstanding)} tone="warn" help="Unpaid invoice total for the period." />
          </div>

          {viewMode === 'banks' ? (
            <div className="grid cols-3" style={{ marginBottom: '1rem' }}>
              <Card>
                <CardHeader title="Top Banks (Revenue)" subtitle="Highest billed totals." />
                <ol className="analytics-list">
                  {topBanks.map((row) => (
                    <li key={row.entity_key}>
                      <strong>{row.entity_label}</strong>
                      <span className="muted">{formatMoney(row.billed)}</span>
                      <button type="button" className="ghost" onClick={() => handleOpenAssignments(row)}>
                        Open
                      </button>
                    </li>
                  ))}
                </ol>
              </Card>
              <Card>
                <CardHeader title="Top Branches (Frequency)" subtitle="Most assignments." />
                <ol className="analytics-list">
                  {topBranches.map((row) => (
                    <li key={row.entity_key}>
                      <strong>{row.entity_label}</strong>
                      <span className="muted">{row.assignments} assignments</span>
                      <button type="button" className="ghost" onClick={() => handleOpenAssignments(row)}>
                        Open
                      </button>
                    </li>
                  ))}
                </ol>
              </Card>
              <Card>
                <CardHeader title="Top Declines" subtitle="Largest drops in volume." />
                <ol className="analytics-list">
                  {topDeclines.map((row) => (
                    <li key={row.entity_key}>
                      <strong>{row.entity_label}</strong>
                      <span className="muted">{changeLabel(row.assignments_change_pct)}</span>
                      <button type="button" className="ghost" onClick={() => handleOpenAssignments(row)}>
                        Open
                      </button>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          ) : null}

          <div className="split" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)' }}>
            <Card>
              <CardHeader
                title={performanceTitle}
                subtitle="Forecasting, decline detection, and health scoring."
                action={<InfoTip text="Expand banks to reveal branch performance and forecasts." />}
              />

              {viewMode === 'banks' ? (
                bankData?.banks?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Bank / Branch</th>
                          <th>Assignments</th>
                          <th>Chg Assign</th>
                          <th>Billed</th>
                          <th>Chg Billed</th>
                          <th>Collected</th>
                          <th>Outstanding</th>
                          <th>Health</th>
                          <th>Forecast</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bankData.banks.map((bank) => (
                          <React.Fragment key={bank.entity_key}>
                            <tr
                              className="analytics-row"
                              onClick={() => setSelectedEntity(bank)}
                              onDoubleClick={() => handleOpenAssignments(bank)}
                            >
                              <td>
                                <div className="analytics-cell">
                                  <button
                                    type="button"
                                    className="ghost"
                                    disabled={!bank.children?.length}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (bank.children?.length) toggleExpand(bank.entity_key)
                                    }}
                                  >
                                    {bank.children?.length ? (expandedBanks.has(bank.entity_key) ? 'v' : '>') : '-'}
                                  </button>
                                  <strong>{bank.entity_label}</strong>
                                </div>
                              </td>
                              <td>{bank.assignments}</td>
                              <td>
                                <Badge tone={changeTone(bank.assignments_change_pct)}>
                                  {changeLabel(bank.assignments_change_pct)}
                                </Badge>
                              </td>
                              <td>{formatMoney(bank.billed)}</td>
                              <td>
                                <Badge tone={changeTone(bank.billed_change_pct)}>
                                  {changeLabel(bank.billed_change_pct)}
                                </Badge>
                              </td>
                              <td>{formatMoney(bank.collected)}</td>
                              <td>{formatMoney(bank.outstanding)}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Badge tone={healthTone(bank.health_label)}>{bank.health_label}</Badge>
                                  <InfoTip text={healthTip(bank)} />
                                </div>
                              </td>
                              <td>{forecastLabel(bank.forecast)}</td>
                            </tr>
                            {expandedBanks.has(bank.entity_key) && bank.children?.length
                              ? bank.children.map((branch) => (
                                <tr
                                  key={branch.entity_key}
                                  className="analytics-row child"
                                  onClick={() => setSelectedEntity(branch)}
                                  onDoubleClick={() => handleOpenAssignments(branch)}
                                >
                                  <td>
                                    <div className="analytics-cell indent">
                                      <span>{"->"}</span>
                                      <span>{branch.entity_label}</span>
                                    </div>
                                  </td>
                                  <td>{branch.assignments}</td>
                                  <td>
                                    <Badge tone={changeTone(branch.assignments_change_pct)}>
                                      {changeLabel(branch.assignments_change_pct)}
                                    </Badge>
                                  </td>
                                  <td>{formatMoney(branch.billed)}</td>
                                  <td>
                                    <Badge tone={changeTone(branch.billed_change_pct)}>
                                      {changeLabel(branch.billed_change_pct)}
                                    </Badge>
                                  </td>
                                  <td>{formatMoney(branch.collected)}</td>
                                  <td>{formatMoney(branch.outstanding)}</td>
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <Badge tone={healthTone(branch.health_label)}>{branch.health_label}</Badge>
                                      <InfoTip text={healthTip(branch)} />
                                    </div>
                                  </td>
                                  <td>{forecastLabel(branch.forecast)}</td>
                                </tr>
                              ))
                              : null}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState>No bank data in this range.</EmptyState>
                )
              ) : (
                segmentData?.rows?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{viewMode === 'service-lines' ? 'Service Line' : 'Case Type'}</th>
                          <th>Assignments</th>
                          {viewMode === 'case-types' ? <th>Share</th> : null}
                          <th>Chg Assign</th>
                          <th>Billed</th>
                          <th>Chg Billed</th>
                          <th>Collected</th>
                          <th>Outstanding</th>
                          <th>Health</th>
                          <th>Forecast</th>
                        </tr>
                      </thead>
                      <tbody>
                        {segmentData.rows.map((row) => (
                          <tr
                            key={row.entity_key}
                            className="analytics-row"
                            onClick={() => setSelectedEntity(row)}
                            onDoubleClick={() => handleOpenAssignments(row)}
                          >
                            <td>{titleCase(row.entity_label)}</td>
                            <td>{row.assignments}</td>
                            {viewMode === 'case-types' ? (
                              <td>{segmentTotalAssignments ? `${Math.round((row.assignments / segmentTotalAssignments) * 100)}%` : '-'}</td>
                            ) : null}
                            <td>
                              <Badge tone={changeTone(row.assignments_change_pct)}>
                                {changeLabel(row.assignments_change_pct)}
                              </Badge>
                            </td>
                            <td>{formatMoney(row.billed)}</td>
                            <td>
                              <Badge tone={changeTone(row.billed_change_pct)}>
                                {changeLabel(row.billed_change_pct)}
                              </Badge>
                            </td>
                            <td>{formatMoney(row.collected)}</td>
                            <td>{formatMoney(row.outstanding)}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Badge tone={healthTone(row.health_label)}>{row.health_label}</Badge>
                                <InfoTip text={healthTip(row)} />
                              </div>
                            </td>
                            <td>{forecastLabel(row.forecast)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState>No analytics rows in this range.</EmptyState>
                )
              )}

              {viewMode === 'banks' && includeNonBank && bankData?.non_bank_sources?.length ? (
                <div style={{ marginTop: '1rem' }}>
                  <div className="kicker" style={{ marginBottom: 6 }}>Direct/External Sources</div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>Assignments</th>
                          <th>Chg Assign</th>
                          <th>Billed</th>
                          <th>Chg Billed</th>
                          <th>Outstanding</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bankData.non_bank_sources.map((row) => (
                          <tr
                            key={row.entity_key}
                            className="analytics-row"
                            onClick={() => setSelectedEntity(row)}
                            onDoubleClick={() => handleOpenAssignments(row)}
                          >
                            <td>{row.entity_label}</td>
                            <td>{row.assignments}</td>
                            <td>
                              <Badge tone={changeTone(row.assignments_change_pct)}>
                                {changeLabel(row.assignments_change_pct)}
                              </Badge>
                            </td>
                            <td>{formatMoney(row.billed)}</td>
                            <td>
                              <Badge tone={changeTone(row.billed_change_pct)}>
                                {changeLabel(row.billed_change_pct)}
                              </Badge>
                            </td>
                            <td>{formatMoney(row.outstanding)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </Card>

            <div className="grid">
              <Card>
                <CardHeader title="Action Needed" subtitle="Auto-detected declines and inactivity." />
                {signalsError ? <div className="muted">{signalsError}</div> : null}
                {!signalsError && signals.length === 0 ? (
                  <div className="muted">No active signals in this range.</div>
                ) : null}
                {signals.length ? (
                  <div className="list">
                    {signals.slice(0, 8).map((signal, idx) => (
                      <div key={`${signal.message}-${idx}`} className="list-item">
                        <Badge tone={signal.level === 'danger' ? 'danger' : 'warn'}>
                          {signal.level === 'danger' ? 'Alert' : 'Watch'}
                        </Badge>
                        <div style={{ marginTop: 6, fontWeight: 600 }}>{signal.message}</div>
                        {signal.recommended_action ? (
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{signal.recommended_action}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </Card>

              <Card>
                <CardHeader title="Threshold Settings" subtitle="Admin-configurable follow-up triggers." />
                {recommended ? (
                  <div className="list" style={{ marginBottom: '0.7rem' }}>
                    <div className="list-item">
                      <div className="kicker">Recommended</div>
                      <div className="muted" style={{ fontSize: 12 }}>{settingsData?.recommended_note || 'Based on volatility.'}</div>
                      <div style={{ marginTop: 6 }}>
                        <div className="muted" style={{ fontSize: 12 }}>Window: {recommended.time_window_days} days</div>
                        <div className="muted" style={{ fontSize: 12 }}>Frequency drop: {Number(recommended.decline_threshold_count) * 100}%</div>
                        <div className="muted" style={{ fontSize: 12 }}>Revenue drop: {Number(recommended.decline_threshold_revenue) * 100}%</div>
                        <div className="muted" style={{ fontSize: 12 }}>Inactivity: {recommended.inactivity_days} days</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          Baseline: {recommended.baseline_min_count} assignments or {formatMoney(recommended.baseline_min_revenue)}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {settingsForm ? (
                  <form className="grid" onSubmit={handleSaveSettings}>
                    <label className="grid" style={{ gap: 6 }}>
                      <span className="kicker">Comparison Window (days)</span>
                      <input
                        type="number"
                        value={settingsForm.time_window_days}
                        onChange={(e) => setSettingsForm((prev) => ({ ...prev, time_window_days: e.target.value }))}
                      />
                    </label>
                    <label className="grid" style={{ gap: 6 }}>
                      <span className="kicker">Decline Threshold (Assignments %)</span>
                      <input
                        type="number"
                        value={settingsForm.decline_threshold_count}
                        onChange={(e) => setSettingsForm((prev) => ({ ...prev, decline_threshold_count: e.target.value }))}
                      />
                    </label>
                    <label className="grid" style={{ gap: 6 }}>
                      <span className="kicker">Decline Threshold (Revenue %)</span>
                      <input
                        type="number"
                        value={settingsForm.decline_threshold_revenue}
                        onChange={(e) => setSettingsForm((prev) => ({ ...prev, decline_threshold_revenue: e.target.value }))}
                      />
                    </label>
                    <label className="grid" style={{ gap: 6 }}>
                      <span className="kicker">Inactivity Days</span>
                      <input
                        type="number"
                        value={settingsForm.inactivity_days}
                        onChange={(e) => setSettingsForm((prev) => ({ ...prev, inactivity_days: e.target.value }))}
                      />
                    </label>
                    <label className="grid" style={{ gap: 6 }}>
                      <span className="kicker">Baseline Min Count</span>
                      <input
                        type="number"
                        value={settingsForm.baseline_min_count}
                        onChange={(e) => setSettingsForm((prev) => ({ ...prev, baseline_min_count: e.target.value }))}
                      />
                    </label>
                    <label className="grid" style={{ gap: 6 }}>
                      <span className="kicker">Baseline Min Revenue</span>
                      <input
                        type="number"
                        value={settingsForm.baseline_min_revenue}
                        onChange={(e) => setSettingsForm((prev) => ({ ...prev, baseline_min_revenue: e.target.value }))}
                      />
                    </label>
                    <label className="grid" style={{ gap: 6 }}>
                      <span className="kicker">Follow-up Cooldown (days)</span>
                      <input
                        type="number"
                        value={settingsForm.followup_cooldown_days}
                        onChange={(e) => setSettingsForm((prev) => ({ ...prev, followup_cooldown_days: e.target.value }))}
                      />
                    </label>
                    <label className="grid" style={{ gap: 6 }}>
                      <span className="kicker">Outstanding Trigger Amount</span>
                      <input
                        type="number"
                        value={settingsForm.outstanding_threshold}
                        onChange={(e) => setSettingsForm((prev) => ({ ...prev, outstanding_threshold: e.target.value }))}
                      />
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button type="submit">Save Settings</button>
                      {settingsNotice ? <span className="muted" style={{ fontSize: 12 }}>{settingsNotice}</span> : null}
                    </div>
                  </form>
                ) : (
                  <div className="muted">Loading settings...</div>
                )}
              </Card>

              <Card>
                <CardHeader title="Selected Insight" subtitle="Forecast, health, and relationship log." />
                {!selectedEntity ? (
                  <div className="muted">Select a row to see details.</div>
                ) : (
                  <div className="grid" style={{ gap: 10 }}>
                    <div>
                      <strong>{selectedEntity.entity_label}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>{titleCase(selectedEntity.entity_type)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleOpenAssignments(selectedEntity)}
                        disabled={!buildAssignmentParams(selectedEntity)}
                      >
                        Open Assignments
                      </button>
                    </div>
                    {selectedEntity.forecast ? (
                      <div className="list-item">
                        <div className="kicker">Forecast Next Month</div>
                        <div>Expected: {selectedEntity.forecast.expected_assignments} assignments</div>
                        <div className="muted" style={{ fontSize: 12 }}>Band: {selectedEntity.forecast.expected_assignments_low}-{selectedEntity.forecast.expected_assignments_high}</div>
                        <div className="muted" style={{ fontSize: 12 }}>Expected billed: {formatMoney(selectedEntity.forecast.expected_billed)}</div>
                      </div>
                    ) : null}
                    <div className="list-item">
                      <div className="kicker">Health</div>
                      <Badge tone={healthTone(selectedEntity.health_label)}>{selectedEntity.health_label}</Badge>
                      {selectedEntity.health_reasons?.length ? (
                        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{selectedEntity.health_reasons.join('; ')}</div>
                      ) : null}
                    </div>
                    <div className="list-item">
                      <div className="kicker">Visit Scheduler</div>
                      <div className="muted" style={{ fontSize: 12 }}>Create calendar reminders when an entity is At Risk.</div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <button
                          type="button"
                          className="secondary"
                          onClick={handleCreateVisitReminder}
                          disabled={
                            visitLoading
                            || !['BANK', 'BRANCH'].includes(selectedEntity.entity_type)
                            || selectedEntity.health_label !== 'At Risk'
                          }
                        >
                          {visitLoading ? 'Scheduling...' : 'Draft Visit Reminder'}
                        </button>
                        {visitNotice ? <div className="muted" style={{ fontSize: 12 }}>{visitNotice}</div> : null}
                      </div>
                    </div>
                    <div className="list-item">
                      <div className="kicker">Forecasting v2</div>
                      {forecastV2Error ? (
                        <div className="muted" style={{ fontSize: 12 }}>{forecastV2Error}</div>
                      ) : forecastV2 ? (
                        <div className="grid" style={{ gap: 6 }}>
                          {forecastV2.confidence_note ? (
                            <div className="muted" style={{ fontSize: 12 }}>{forecastV2.confidence_note}</div>
                          ) : null}
                          <div className="muted" style={{ fontSize: 12 }}>
                            Quarterly: {forecastV2.quarterly.map((q) => `${q.period} ${q.assignments}`).join(', ') || '—'}
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Seasonality: {forecastV2.seasonality.map((s) => `${s.period} ${s.assignments}`).join(', ') || '—'}
                          </div>
                        </div>
                      ) : (
                        <div className="muted" style={{ fontSize: 12 }}>Loading forecast v2...</div>
                      )}
                    </div>
                    <div className="list-item">
                      <div className="kicker">Weekly Digest</div>
                      <div className="muted" style={{ fontSize: 12 }}>Weekly summary of at-risk branches.</div>
                      <button type="button" className="secondary" onClick={handleLoadDigest}>Load Digest</button>
                      {digestError ? <div className="muted" style={{ fontSize: 12 }}>{digestError}</div> : null}
                      {digest ? (
                        <div className="list" style={{ marginTop: 6 }}>
                          <div className="list-item">
                            <div style={{ fontWeight: 600 }}>{digest.summary || 'Weekly summary'}</div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {digest.total_at_risk} at risk, {digest.total_watch} watch.
                            </div>
                          </div>
                          {digest.items?.slice(0, 3).map((item) => (
                            <div key={`${item.entity_type}-${item.entity_id || item.entity_label}`} className="list-item">
                              <div style={{ fontWeight: 600 }}>{item.entity_label}</div>
                              <div className="muted" style={{ fontSize: 12 }}>{item.health_label}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {['BANK', 'BRANCH'].includes(selectedEntity.entity_type) ? (
                      <div>
                        <div className="kicker" style={{ marginBottom: 6 }}>Relationship Log</div>
                        {relationshipLogs.length === 0 ? (
                          <div className="muted">No follow-up history yet.</div>
                        ) : (
                          <div className="list">
                            {relationshipLogs.map((log) => (
                              <div key={log.id} className="list-item">
                                <div style={{ fontWeight: 600 }}>{log.note}</div>
                                <div className="muted" style={{ fontSize: 12 }}>{formatDate(log.created_at)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        <form className="grid" style={{ marginTop: 8 }} onSubmit={handleAddLog}>
                          <textarea
                            rows={3}
                            placeholder="Add follow-up note"
                            value={logForm.note}
                            onChange={(e) => setLogForm((prev) => ({ ...prev, note: e.target.value }))}
                          />
                          <input
                            type="date"
                            value={logForm.next_follow_up_date}
                            onChange={(e) => setLogForm((prev) => ({ ...prev, next_follow_up_date: e.target.value }))}
                          />
                          <button type="submit">Add Note</button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                )}
              </Card>
            </div>
          </div>

          <div className="split" style={{ marginTop: '1rem', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)' }}>
            <Card>
              <CardHeader
                title="Partner Insights"
                subtitle="Partner-sourced commissions and outstanding exposure."
                action={<Badge tone="info">{partnerSummary.length} partners</Badge>}
              />
              {partnerSummaryError ? <div className="muted">{partnerSummaryError}</div> : null}
              {partnerLoading ? (
                <div className="muted">Loading partner insights…</div>
              ) : partnerSummary.length === 0 ? (
                <EmptyState>No partner activity yet.</EmptyState>
              ) : (
                <div className="grid cols-2">
                  <div>
                    <div className="kicker" style={{ marginBottom: 6 }}>Top Partners by Volume</div>
                    <div className="list">
                      {topPartnersByVolume.map((row) => (
                        <div key={row.id} className="list-item" style={{ justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontWeight: 600 }}>{row.display_name}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{row.commission_count} commissions</div>
                          </div>
                          <Badge tone="info">{row.converted_count} converted</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="kicker" style={{ marginBottom: 6 }}>Top Partners by Outstanding</div>
                    <div className="list">
                      {topPartnersByOutstanding.map((row) => (
                        <div key={row.id} className="list-item" style={{ justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontWeight: 600 }}>{row.display_name}</div>
                            <div className="muted" style={{ fontSize: 12 }}>Last active {formatDateTime(row.last_activity_at)}</div>
                          </div>
                          <Badge tone="warn">{formatMoney(row.unpaid_total || 0)}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Partner Bank/Branch Breakdown"
                subtitle={selectedPartner ? `Activity for ${selectedPartner.display_name}` : 'Select a partner to drill down'}
                action={(
                  <select value={selectedPartnerId} onChange={(e) => setSelectedPartnerId(e.target.value)}>
                    <option value="">Select partner</option>
                    {partnerSummary.map((partner) => (
                      <option key={partner.id} value={partner.id}>{partner.display_name}</option>
                    ))}
                  </select>
                )}
              />
              {partnerBreakdownError ? <div className="muted">{partnerBreakdownError}</div> : null}
              {!selectedPartnerId ? (
                <EmptyState>Select a partner to view bank/branch breakdown.</EmptyState>
              ) : partnerBreakdown.length === 0 ? (
                <EmptyState>No partner-linked assignments yet.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Bank</th>
                        <th>Branch</th>
                        <th>Assignments</th>
                        <th>Invoice Total</th>
                        <th>Paid</th>
                        <th>Unpaid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnerBreakdown.map((row) => (
                        <tr key={`${row.bank_id}-${row.branch_id || 'na'}`}>
                          <td>{row.bank_name || '—'}</td>
                          <td>{row.branch_name || '—'}</td>
                          <td>{row.assignment_count}</td>
                          <td>{formatMoney(row.invoice_total || 0)}</td>
                          <td>{formatMoney(row.invoice_paid || 0)}</td>
                          <td>{formatMoney(row.invoice_unpaid || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function OverviewCard({ label, value, tone, help }) {
  const style = tone ? { color: `var(--${tone})` } : undefined
  return (
    <div className="card tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <InfoTip text={help} /> : null}
      </div>
      <div className="stat-value" style={style}>{value}</div>
    </div>
  )
}
