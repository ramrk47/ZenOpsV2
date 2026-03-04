import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import { Card, CardHeader } from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import InfoTip from '../components/ui/InfoTip'
import { createAssignment, createDraftAssignment } from '../api/assignments'
import { uploadDocumentWithMeta } from '../api/documents'
import { fetchUserDirectory } from '../api/users'
import {
  fetchBanks,
  fetchBranches,
  fetchClients,
  fetchPropertyTypes,
  fetchPropertySubtypes,
  fetchDocumentTemplateSlots,
  fetchServiceLinePolicies,
  fetchServiceLines,
} from '../api/master'
import { titleCase } from '../utils/format'
import { toUserMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { hasCapability, userHasRole } from '../utils/rbac'

const CASE_TYPES = ['BANK', 'EXTERNAL_VALUER', 'DIRECT_CLIENT']
const STATUSES = ['PENDING', 'SITE_VISIT', 'UNDER_PROCESS', 'SUBMITTED', 'COMPLETED', 'CANCELLED']
const UOM_OPTIONS = [
  { value: 'SQFT', label: 'Square Feet (sqft)' },
  { value: 'SQM', label: 'Square Meter (sqm)' },
  { value: 'ACRE_GUNTA_AANA', label: 'Acre-Gunta-Aana' },
  { value: 'ACRE_GUNTA', label: 'Acre-Gunta' },
]
const LAND_BLOCKS = ['NORMAL_LAND', 'SURVEY_ROWS', 'BUILT_UP']
const PAYMENT_TIMING_OPTIONS = ['PRE', 'POST']
const PAYMENT_COMPLETENESS_OPTIONS = ['FULL', 'PARTIAL']
const PREFERRED_PAYMENT_MODE_OPTIONS = ['CASH', 'UPI', 'BANK_TRANSFER']

function toIso(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function normalizePolicy(policy) {
  const requires = Array.isArray(policy?.requires)
    ? policy.requires.map((v) => String(v || '').trim().toUpperCase()).filter((v) => LAND_BLOCKS.includes(v))
    : []
  const optional = Array.isArray(policy?.optional)
    ? policy.optional
      .map((v) => String(v || '').trim().toUpperCase())
      .filter((v) => LAND_BLOCKS.includes(v) && !requires.includes(v))
    : []
  return {
    requires,
    optional,
    uom_required: policy?.uom_required !== false,
    allow_assignment_override: policy?.allow_assignment_override !== false,
    notes: policy?.notes || null,
  }
}

function policyBlockEnabled(policy, block) {
  return (policy?.requires || []).includes(block) || (policy?.optional || []).includes(block)
}

function mapServiceLineKeyToLegacy(serviceLineKey) {
  const key = String(serviceLineKey || '').trim().toUpperCase()
  if (['PROJECT_REPORT', 'DCC'].includes(key)) return 'DPR'
  return 'VALUATION'
}

function parseDecimal(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sumSurveyRows(rows) {
  return rows.reduce(
    (acc, row) => ({
      acre: acc.acre + parseDecimal(row.acre),
      gunta: acc.gunta + parseDecimal(row.gunta),
      aana: acc.aana + parseDecimal(row.aana),
      kharab_acre: acc.kharab_acre + parseDecimal(row.kharab_acre),
      kharab_gunta: acc.kharab_gunta + parseDecimal(row.kharab_gunta),
      kharab_aana: acc.kharab_aana + parseDecimal(row.kharab_aana),
    }),
    { acre: 0, gunta: 0, aana: 0, kharab_acre: 0, kharab_gunta: 0, kharab_aana: 0 },
  )
}

export default function NewAssignment() {
  const navigate = useNavigate()
  const { user, capabilities } = useAuth()
  const canModifyMoney = hasCapability(capabilities, 'modify_money')
  const canCreateAssignment = hasCapability(capabilities, 'create_assignment')
  const canCreateDraftAssignment = hasCapability(capabilities, 'create_assignment_draft')
  const canManageAdminPrefs = userHasRole(user, 'ADMIN') || userHasRole(user, 'OPS_MANAGER')
  const draftMode = userHasRole(user, 'FIELD_VALUER') && canCreateDraftAssignment

  const [users, setUsers] = useState([])
  const [banks, setBanks] = useState([])
  const [branches, setBranches] = useState([])
  const [clients, setClients] = useState([])
  const [propertyTypes, setPropertyTypes] = useState([])
  const [propertySubtypes, setPropertySubtypes] = useState([])
  const [serviceLines, setServiceLines] = useState([])
  const [serviceLinePolicies, setServiceLinePolicies] = useState([])
  const [templateSlots, setTemplateSlots] = useState([])
  const [slotFiles, setSlotFiles] = useState({})

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    case_type: 'BANK',
    service_line_id: '',
    service_line_other_text: '',
    bank_id: '',
    branch_id: '',
    client_id: '',
    valuer_client_name: '',
    property_type_id: '',
    property_subtype_id: '',
    borrower_name: '',
    phone: '',
    address: '',
    land_area: '',
    builtup_area: '',
    uom: '',
    status: 'PENDING',
    assigned_to_user_id: user?.id ? String(user.id) : '',
    assignee_user_ids: [],
    site_visit_date: '',
    report_due_date: '',
    fees: '',
    is_paid: false,
    notes: '',
    payment_timing: '',
    payment_completeness: '',
    preferred_payment_mode: '',
  })

  const [multiFloorEnabled, setMultiFloorEnabled] = useState(false)
  const [floors, setFloors] = useState([{ floor_name: 'Ground Floor', area: '' }])
  const [surveyRows, setSurveyRows] = useState([
    { survey_no: '', acre: '', gunta: '', aana: '', kharab_acre: '', kharab_gunta: '', kharab_aana: '' },
  ])
  const [initialDocs, setInitialDocs] = useState([{ file: null, category: '', isFinal: false }])

  const [overrideEnabled, setOverrideEnabled] = useState(false)
  const [overridePolicy, setOverridePolicy] = useState(normalizePolicy(null))

  if (!canCreateAssignment && !canCreateDraftAssignment) {
    return (
      <div>
        <PageHeader
          title="New Assignment"
          subtitle="Your account does not have access to create assignments."
        />
        <EmptyState>Ask an admin to enable assignment creation for your role.</EmptyState>
      </div>
    )
  }

  function confirmLeaveOverride(detail) {
    if (!detail) return false
    const range = detail.leave_start && detail.leave_end ? `${detail.leave_start} -> ${detail.leave_end}` : 'current leave'
    return window.confirm(`Assignee is on approved leave (${range}). Assign anyway?`)
  }

  useEffect(() => {
    let cancelled = false

    async function loadReferenceData() {
      setLoading(true)
      setError(null)
      try {
        const [
          bankData,
          branchData,
          clientData,
          propertyData,
          subtypeData,
          serviceLineData,
          policyData,
        ] = await Promise.all([
          fetchBanks(),
          fetchBranches(),
          fetchClients(),
          fetchPropertyTypes(),
          fetchPropertySubtypes().catch(() => []),
          fetchServiceLines().catch(() => []),
          fetchServiceLinePolicies().catch(() => []),
        ])

        let userData = []
        try {
          userData = await fetchUserDirectory()
        } catch (_err) {
          userData = user ? [user] : []
        }

        if (cancelled) return
        setBanks(bankData)
        setBranches(branchData)
        setClients(clientData)
        setPropertyTypes(propertyData)
        setPropertySubtypes(subtypeData)
        setServiceLines(serviceLineData)
        setServiceLinePolicies(policyData)
        setUsers(userData)

        if (!form.assigned_to_user_id && user?.id) {
          setForm((prev) => ({ ...prev, assigned_to_user_id: String(user.id) }))
        }
        if (!form.service_line_id && serviceLineData.length > 0) {
          setForm((prev) => ({ ...prev, service_line_id: String(serviceLineData[0].id) }))
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load reference data'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadReferenceData()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedServiceLine = useMemo(
    () => serviceLines.find((line) => String(line.id) === String(form.service_line_id)) || null,
    [form.service_line_id, serviceLines],
  )

  const basePolicy = useMemo(() => {
    const fromServiceLine = selectedServiceLine?.policy_json
    if (fromServiceLine) return normalizePolicy(fromServiceLine)
    const fromEndpoint = serviceLinePolicies.find((policy) => String(policy.service_line_id) === String(form.service_line_id))
    return normalizePolicy(fromEndpoint?.policy_json)
  }, [selectedServiceLine, serviceLinePolicies, form.service_line_id])

  useEffect(() => {
    setOverridePolicy(basePolicy)
  }, [basePolicy])

  const effectivePolicy = overrideEnabled && canManageAdminPrefs ? normalizePolicy(overridePolicy) : basePolicy

  useEffect(() => {
    let cancelled = false

    async function loadTemplateSlots() {
      if (!selectedServiceLine?.key) {
        setTemplateSlots([])
        setSlotFiles({})
        return
      }
      try {
        const blocks = [...(effectivePolicy?.requires || []), ...(effectivePolicy?.optional || [])].join(',')
        const response = await fetchDocumentTemplateSlots({
          serviceLineKey: selectedServiceLine.key,
          blocks: blocks || undefined,
        })
        if (cancelled) return
        const slots = response?.slots || []
        setTemplateSlots(slots)
        setSlotFiles((prev) => {
          const next = {}
          slots.forEach((slot) => {
            next[slot.category] = prev[slot.category] || []
          })
          return next
        })
      } catch (_err) {
        if (!cancelled) {
          setTemplateSlots([])
          setSlotFiles({})
        }
      }
    }

    loadTemplateSlots()
    return () => {
      cancelled = true
    }
  }, [selectedServiceLine?.key, effectivePolicy])

  const filteredBranches = useMemo(() => {
    if (!form.bank_id) return branches
    return branches.filter((branch) => String(branch.bank_id) === String(form.bank_id))
  }, [branches, form.bank_id])

  const selectedBank = banks.find((bank) => String(bank.id) === String(form.bank_id)) || null
  const selectedClient = clients.find((client) => String(client.id) === String(form.client_id)) || null

  const isBankCase = form.case_type === 'BANK'

  const propertySubtypesForType = useMemo(() => {
    if (!form.property_type_id) return []
    return propertySubtypes.filter((subtype) => String(subtype.property_type_id) === String(form.property_type_id))
  }, [propertySubtypes, form.property_type_id])

  const floorTotal = useMemo(
    () =>
      floors.reduce((sum, row) => {
        const area = Number(row.area)
        return Number.isFinite(area) ? sum + area : sum
      }, 0),
    [floors],
  )

  const surveyTotals = useMemo(() => sumSurveyRows(surveyRows), [surveyRows])

  const showNormalLand = policyBlockEnabled(effectivePolicy, 'NORMAL_LAND')
  const showSurveyRows = policyBlockEnabled(effectivePolicy, 'SURVEY_ROWS')
  const showBuiltUp = policyBlockEnabled(effectivePolicy, 'BUILT_UP')
  const requiredSlots = useMemo(() => templateSlots.filter((slot) => slot.required), [templateSlots])
  const optionalSlots = useMemo(() => templateSlots.filter((slot) => !slot.required), [templateSlots])

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handlePropertyTypeChange(value) {
    setForm((prev) => ({
      ...prev,
      property_type_id: value,
      property_subtype_id: '',
    }))
  }

  function toggleAssignee(userId) {
    const id = String(userId)
    setForm((prev) => {
      const current = new Set(prev.assignee_user_ids.map(String))
      if (current.has(id)) {
        current.delete(id)
      } else {
        current.add(id)
      }
      return {
        ...prev,
        assignee_user_ids: Array.from(current),
      }
    })
  }

  function updateFloor(index, key, value) {
    setFloors((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  function addFloor() {
    setFloors((prev) => [...prev, { floor_name: '', area: '' }])
  }

  function removeFloor(index) {
    setFloors((prev) => prev.filter((_, i) => i !== index))
  }

  function addSurveyRow() {
    setSurveyRows((prev) => [...prev, { survey_no: '', acre: '', gunta: '', aana: '', kharab_acre: '', kharab_gunta: '', kharab_aana: '' }])
  }

  function updateSurveyRow(index, key, value) {
    setSurveyRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  function removeSurveyRow(index) {
    setSurveyRows((prev) => prev.filter((_, i) => i !== index))
  }

  function togglePolicyBlock(block, bucket) {
    setOverridePolicy((prev) => {
      const next = normalizePolicy(prev)
      if (bucket === 'requires') {
        if (next.requires.includes(block)) {
          next.requires = next.requires.filter((v) => v !== block)
        } else {
          next.requires = [...next.requires, block]
          next.optional = next.optional.filter((v) => v !== block)
        }
      } else {
        if (next.optional.includes(block)) {
          next.optional = next.optional.filter((v) => v !== block)
        } else {
          next.optional = [...next.optional, block]
          next.requires = next.requires.filter((v) => v !== block)
        }
      }
      return next
    })
  }

  function updateInitialDoc(index, key, value) {
    setInitialDocs((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  function addInitialDoc() {
    setInitialDocs((prev) => [...prev, { file: null, category: '', isFinal: false }])
  }

  function removeInitialDoc(index) {
    setInitialDocs((prev) => prev.filter((_, i) => i !== index))
  }

  function updateSlotFiles(category, fileList) {
    const files = Array.from(fileList || [])
    setSlotFiles((prev) => ({ ...prev, [category]: files }))
  }

  function validateForm() {
    if (!form.case_type) return 'Case type is required.'
    if (!form.service_line_id) return 'Service line is required.'
    if (!form.borrower_name.trim()) return 'Borrower name is required.'
    if (!form.uom) return 'Unit of measurement is required.'

    if (selectedServiceLine?.key === 'OTHERS' && !form.service_line_other_text.trim()) {
      return 'Please add Other service description.'
    }

    if (isBankCase) {
      if (!form.bank_id) return 'Bank is required for BANK cases.'
      if (!form.branch_id) return 'Branch is required for BANK cases.'
    } else if (!form.client_id && !form.valuer_client_name.trim()) {
      return 'Client is required for non-bank cases (select one or type a name).'
    }

    if ((effectivePolicy?.uom_required ?? true) && !form.uom) {
      return 'UOM is required for selected service line policy.'
    }

    if ((effectivePolicy?.requires || []).includes('SURVEY_ROWS')) {
      const validRows = surveyRows.filter((row) => row.survey_no.trim())
      if (validRows.length === 0) {
        return 'At least one survey row is required for this service line policy.'
      }
    }

    return null
  }

  async function uploadInitialDocuments(assignmentId) {
    const slotUploads = Object.entries(slotFiles).flatMap(([category, files]) =>
      (files || []).map((file) => ({ file, category, isFinal: false })),
    )
    for (const doc of slotUploads) {
      // Slot uploads are deterministic and category-bound by checklist templates.
      // eslint-disable-next-line no-await-in-loop
      await uploadDocumentWithMeta(assignmentId, {
        file: doc.file,
        category: doc.category,
        isFinal: false,
      })
    }

    const uploads = initialDocs.filter((doc) => doc.file)
    for (const doc of uploads) {
      // Sequential upload keeps user-facing failures deterministic.
      // eslint-disable-next-line no-await-in-loop
      await uploadDocumentWithMeta(assignmentId, {
        file: doc.file,
        category: doc.category.trim() || undefined,
        isFinal: Boolean(doc.isFinal),
      })
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setSubmitting(true)
    let payload = null
    let createdAssignment = null
    try {
      const floorsPayload = multiFloorEnabled && showBuiltUp
        ? floors
          .map((row, order_index) => ({
            floor_name: row.floor_name.trim(),
            area: Number(row.area),
            order_index,
          }))
          .filter((row) => row.floor_name && Number.isFinite(row.area) && row.area > 0)
        : []

      const builtupArea = showBuiltUp
        ? (multiFloorEnabled
          ? (floorsPayload.length > 0 ? floorTotal : null)
          : (form.builtup_area ? Number(form.builtup_area) : null))
        : null

      const assigneeIds = new Set()
      if (form.assigned_to_user_id) assigneeIds.add(Number(form.assigned_to_user_id))
      form.assignee_user_ids.forEach((uid) => {
        const parsed = Number(uid)
        if (Number.isFinite(parsed)) assigneeIds.add(parsed)
      })

      const surveyPayload = showSurveyRows
        ? surveyRows
          .map((row, index) => ({
            serial_no: index + 1,
            survey_no: row.survey_no.trim(),
            acre: row.acre ? Number(row.acre) : 0,
            gunta: row.gunta ? Number(row.gunta) : 0,
            aana: row.aana ? Number(row.aana) : 0,
            kharab_acre: row.kharab_acre ? Number(row.kharab_acre) : 0,
            kharab_gunta: row.kharab_gunta ? Number(row.kharab_gunta) : 0,
            kharab_aana: row.kharab_aana ? Number(row.kharab_aana) : 0,
          }))
          .filter((row) => row.survey_no)
        : []

      payload = {
        case_type: form.case_type,
        service_line_id: Number(form.service_line_id),
        service_line: mapServiceLineKeyToLegacy(selectedServiceLine?.key),
        service_line_other_text: selectedServiceLine?.key === 'OTHERS' ? form.service_line_other_text.trim() : null,
        uom: form.uom,
        bank_id: isBankCase && form.bank_id ? Number(form.bank_id) : null,
        branch_id: isBankCase && form.branch_id ? Number(form.branch_id) : null,
        client_id: !isBankCase && form.client_id ? Number(form.client_id) : null,
        valuer_client_name: !isBankCase && !form.client_id ? form.valuer_client_name.trim() : null,
        property_type_id: form.property_type_id ? Number(form.property_type_id) : null,
        property_subtype_id: form.property_subtype_id ? Number(form.property_subtype_id) : null,
        borrower_name: form.borrower_name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        land_area: showNormalLand && form.land_area ? Number(form.land_area) : null,
        builtup_area: builtupArea,
        status: form.status,
        assigned_to_user_id: form.assigned_to_user_id ? Number(form.assigned_to_user_id) : null,
        assignee_user_ids: assigneeIds.size > 0 ? Array.from(assigneeIds) : [],
        site_visit_date: toIso(form.site_visit_date),
        report_due_date: toIso(form.report_due_date),
        notes: form.notes.trim() || null,
        floors: multiFloorEnabled && showBuiltUp ? floorsPayload : [],
        land_surveys: surveyPayload,
      }

      if (canModifyMoney) {
        payload.fees = form.fees ? Number(form.fees) : null
        payload.is_paid = Boolean(form.is_paid)
      }

      if (canManageAdminPrefs) {
        payload.payment_timing = form.payment_timing || null
        payload.payment_completeness = form.payment_completeness || null
        payload.preferred_payment_mode = form.preferred_payment_mode || null
        payload.land_policy_override_json = overrideEnabled ? normalizePolicy(overridePolicy) : null
      }

      createdAssignment = draftMode
        ? await createDraftAssignment(payload)
        : await createAssignment(payload)

      await uploadInitialDocuments(createdAssignment.id)

      if (draftMode) {
        setNotice(`Draft submitted for approval. Temporary code: ${createdAssignment.assignment_code}`)
      } else {
        navigate(`/assignments/${createdAssignment.id}`)
      }
    } catch (err) {
      console.error(err)
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 409 && payload && confirmLeaveOverride(detail)) {
        try {
          const created = draftMode
            ? await createDraftAssignment({ ...payload, override_on_leave: true })
            : await createAssignment({ ...payload, override_on_leave: true })
          createdAssignment = created
          await uploadInitialDocuments(created.id)
          if (draftMode) {
            setNotice(`Draft submitted for approval. Temporary code: ${created.assignment_code}`)
          } else {
            navigate(`/assignments/${created.id}`)
          }
          return
        } catch (innerErr) {
          console.error(innerErr)
          if (createdAssignment?.id) {
            setNotice(`Assignment ${createdAssignment.assignment_code} was created, but initial document uploads failed.`)
          }
          setError(toUserMessage(innerErr, 'Failed to create assignment'))
          return
        }
      }
      if (createdAssignment?.id) {
        setNotice(`Assignment ${createdAssignment.assignment_code} was created, but initial document uploads failed.`)
      }
      setError(toUserMessage(err, 'Failed to create assignment'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="New Assignment"
        subtitle={draftMode ? 'Submit assignment drafts for OPS/Admin approval.' : 'Capture assignment details with policy-driven land inputs.'}
        actions={selectedBank ? <Badge tone="info">{selectedBank.name}</Badge> : selectedClient ? <Badge tone="info">{selectedClient.name}</Badge> : null}
      />

      {notice ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{notice}</div> : null}
      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      {loading ? (
        <div className="muted">Loading reference data...</div>
      ) : (
        <form className="grid" onSubmit={handleSubmit}>
          <div className="grid cols-4">
            <Stat label="Banks" value={banks.length} help="Active bank records available for assignment." />
            <Stat label="Branches" value={branches.length} help="Branch records linked to banks." />
            <Stat label="Clients" value={clients.length} help="Non-bank clients in master data." />
            <Stat label="Property Types" value={propertyTypes.length} help="Top-level property categories." />
            <Stat label="Service Lines" value={serviceLines.length} help="Master-data driven service lines and land policies." />
          </div>

          <Card>
            <CardHeader title="Case Setup" subtitle="Case type and service line policy drive required data blocks." />
            <div className="grid cols-4">
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Case Type</span>
                <select value={form.case_type} onChange={(e) => updateForm('case_type', e.target.value)}>
                  {CASE_TYPES.map((type) => (
                    <option key={type} value={type}>{titleCase(type)}</option>
                  ))}
                </select>
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Service Line</span>
                <select value={form.service_line_id} onChange={(e) => updateForm('service_line_id', e.target.value)}>
                  <option value="">Select service line</option>
                  {serviceLines.map((line) => (
                    <option key={line.id} value={line.id}>{line.name}</option>
                  ))}
                </select>
              </label>

              {selectedServiceLine?.key === 'OTHERS' ? (
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Other Service Description</span>
                  <input
                    value={form.service_line_other_text}
                    onChange={(e) => updateForm('service_line_other_text', e.target.value)}
                    placeholder="Describe the service"
                    required
                  />
                </label>
              ) : (
                <div className="list-item">
                  <div className="kicker">Policy Notes</div>
                  <div style={{ marginTop: 6 }}>{effectivePolicy?.notes || 'No policy notes configured for this service line.'}</div>
                </div>
              )}

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Unit of Measurement</span>
                <select value={form.uom} onChange={(e) => updateForm('uom', e.target.value)} required>
                  <option value="">Select UOM</option>
                  {UOM_OPTIONS.map((uom) => (
                    <option key={uom.value} value={uom.value}>{uom.label}</option>
                  ))}
                </select>
              </label>

              {draftMode ? (
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Status</span>
                  <input value="Draft Pending Approval" disabled />
                </label>
              ) : (
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Status</span>
                  <select value={form.status} onChange={(e) => updateForm('status', e.target.value)}>
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>{titleCase(status)}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Property Type</span>
                <select value={form.property_type_id} onChange={(e) => handlePropertyTypeChange(e.target.value)}>
                  <option value="">Select property type</option>
                  {propertyTypes.map((property) => (
                    <option key={property.id} value={property.id}>{property.name}</option>
                  ))}
                </select>
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Property Subtype</span>
                <select
                  value={form.property_subtype_id}
                  onChange={(e) => updateForm('property_subtype_id', e.target.value)}
                  disabled={!form.property_type_id}
                >
                  <option value="">{form.property_type_id ? 'Select subtype' : 'Select type first'}</option>
                  {propertySubtypesForType.map((subtype) => (
                    <option key={subtype.id} value={subtype.id}>
                      {subtype.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Assigned To</span>
                <select value={form.assigned_to_user_id} onChange={(e) => updateForm('assigned_to_user_id', e.target.value)}>
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                  ))}
                </select>
              </label>
            </div>

            {canManageAdminPrefs ? (
              <div className="grid cols-4" style={{ marginTop: '0.9rem' }}>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Payment Timing (Admin/OPS)</span>
                  <select value={form.payment_timing} onChange={(e) => updateForm('payment_timing', e.target.value)}>
                    <option value="">Blank</option>
                    {PAYMENT_TIMING_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Payment Completeness (Admin/OPS)</span>
                  <select value={form.payment_completeness} onChange={(e) => updateForm('payment_completeness', e.target.value)}>
                    <option value="">Blank</option>
                    {PAYMENT_COMPLETENESS_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Preferred Payment Mode (Admin/OPS)</span>
                  <select value={form.preferred_payment_mode} onChange={(e) => updateForm('preferred_payment_mode', e.target.value)}>
                    <option value="">Blank</option>
                    {PREFERRED_PAYMENT_MODE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{titleCase(option)}</option>
                    ))}
                  </select>
                </label>
                <div className="list-item">
                  <div className="kicker">Land Policy Override</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <input type="checkbox" checked={overrideEnabled} onChange={(e) => setOverrideEnabled(e.target.checked)} />
                    Enable per-assignment override
                  </label>
                </div>
              </div>
            ) : null}

            {canManageAdminPrefs && overrideEnabled ? (
              <div className="grid cols-3" style={{ marginTop: '0.8rem' }}>
                {LAND_BLOCKS.map((block) => (
                  <div key={block} className="list-item">
                    <div className="kicker">{titleCase(block.replaceAll('_', ' '))}</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={(overridePolicy.requires || []).includes(block)}
                        onChange={() => togglePolicyBlock(block, 'requires')}
                      />
                      Required
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={(overridePolicy.optional || []).includes(block)}
                        onChange={() => togglePolicyBlock(block, 'optional')}
                      />
                      Optional
                    </label>
                  </div>
                ))}
              </div>
            ) : null}

            {users.length > 0 ? (
              <div style={{ marginTop: '0.9rem' }}>
                <div className="kicker" style={{ marginBottom: 6 }}>Additional Assignees</div>
                <div className="grid cols-4" style={{ gap: 8 }}>
                  {users.map((u) => {
                    const isPrimary = String(u.id) === String(form.assigned_to_user_id)
                    const checked = form.assignee_user_ids.includes(String(u.id))
                    return (
                      <label key={u.id} className="list-item" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <input
                          type="checkbox"
                          checked={isPrimary || checked}
                          disabled={isPrimary}
                          onChange={() => toggleAssignee(u.id)}
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
            ) : null}

            {isBankCase ? (
              <div className="grid cols-3" style={{ marginTop: '0.8rem' }}>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Bank</span>
                  <select value={form.bank_id} onChange={(e) => updateForm('bank_id', e.target.value)}>
                    <option value="">Select bank</option>
                    {banks.map((bank) => (
                      <option key={bank.id} value={bank.id}>{bank.name}</option>
                    ))}
                  </select>
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Branch</span>
                  <select value={form.branch_id} onChange={(e) => updateForm('branch_id', e.target.value)}>
                    <option value="">Select branch</option>
                    {filteredBranches.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </label>

                <div className="list-item">
                  <div className="kicker">Bank Notes</div>
                  <div style={{ marginTop: 6 }}>
                    Bank + branch drives checklist templates and downstream billing/export scopes.
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid cols-3" style={{ marginTop: '0.8rem' }}>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Client</span>
                  <select value={form.client_id} onChange={(e) => updateForm('client_id', e.target.value)}>
                    <option value="">Select client</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>{client.name}</option>
                    ))}
                  </select>
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Or Type Client Name</span>
                  <input value={form.valuer_client_name} onChange={(e) => updateForm('valuer_client_name', e.target.value)} placeholder="Client / valuer name" />
                </label>

                <div className="list-item">
                  <div className="kicker">Client Notes</div>
                  <div style={{ marginTop: 6 }}>
                    Use a client record when possible to keep reporting and billing consistent.
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Borrower & Property" subtitle="Policy-driven land details for plot, agri, and land/building workflows." />
            <div className="grid cols-3">
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Borrower Name</span>
                <input value={form.borrower_name} onChange={(e) => updateForm('borrower_name', e.target.value)} required />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Phone</span>
                <input value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} placeholder="Optional" />
              </label>
              {showNormalLand ? (
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Land Area</span>
                  <input type="number" step="0.01" value={form.land_area} onChange={(e) => updateForm('land_area', e.target.value)} placeholder="Land area" />
                </label>
              ) : (
                <div className="list-item">
                  <div className="kicker">Normal Land Block</div>
                  <div style={{ marginTop: 6 }}>Not required by current land policy.</div>
                </div>
              )}
            </div>

            <div className="grid cols-3" style={{ marginTop: '0.8rem' }}>
              {showBuiltUp ? (
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Built-up Area</span>
                  {multiFloorEnabled ? (
                    <input value={floorTotal ? floorTotal.toFixed(2) : ''} readOnly />
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      value={form.builtup_area}
                      onChange={(e) => updateForm('builtup_area', e.target.value)}
                      placeholder="Built-up area"
                    />
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={multiFloorEnabled}
                      onChange={(e) => setMultiFloorEnabled(e.target.checked)}
                    />
                    Multiple floors
                  </label>
                </label>
              ) : (
                <div className="list-item">
                  <div className="kicker">Built-up Block</div>
                  <div style={{ marginTop: 6 }}>Not required by current land policy.</div>
                </div>
              )}

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Site Visit</span>
                <input type="datetime-local" value={form.site_visit_date} onChange={(e) => updateForm('site_visit_date', e.target.value)} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Report Due</span>
                <input type="datetime-local" value={form.report_due_date} onChange={(e) => updateForm('report_due_date', e.target.value)} />
              </label>
            </div>

            {showBuiltUp && multiFloorEnabled ? (
              <div style={{ marginTop: '0.9rem' }}>
                <div className="kicker" style={{ marginBottom: 6 }}>Floor-wise Built-up Area</div>
                <div className="grid" style={{ gap: 8 }}>
                  {floors.map((row, index) => (
                    <div key={`floor-${index}`} className="grid cols-3" style={{ gap: 8 }}>
                      <input
                        value={row.floor_name}
                        onChange={(e) => updateFloor(index, 'floor_name', e.target.value)}
                        placeholder="Floor name (e.g., Ground, First)"
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={row.area}
                        onChange={(e) => updateFloor(index, 'area', e.target.value)}
                        placeholder="Area"
                      />
                      <button type="button" className="ghost" onClick={() => removeFloor(index)} disabled={floors.length === 1}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <button type="button" className="secondary" onClick={addFloor}>Add Floor</button>
                  <Badge tone="info">Total: {floorTotal ? floorTotal.toFixed(2) : '0.00'}</Badge>
                </div>
              </div>
            ) : null}

            {showSurveyRows ? (
              <div style={{ marginTop: '0.9rem' }}>
                <div className="kicker" style={{ marginBottom: 6 }}>Survey Rows (Agri/Land Survey Block)</div>
                <div className="grid" style={{ gap: 8 }}>
                  {surveyRows.map((row, index) => (
                    <div key={`survey-${index}`} className="list-item">
                      <div className="grid cols-4" style={{ gap: 8 }}>
                        <label className="grid" style={{ gap: 4 }}>
                          <span className="kicker">Survey No</span>
                          <input value={row.survey_no} onChange={(e) => updateSurveyRow(index, 'survey_no', e.target.value)} placeholder="Survey no" />
                        </label>
                        <label className="grid" style={{ gap: 4 }}>
                          <span className="kicker">Acre</span>
                          <input type="number" step="0.001" value={row.acre} onChange={(e) => updateSurveyRow(index, 'acre', e.target.value)} />
                        </label>
                        <label className="grid" style={{ gap: 4 }}>
                          <span className="kicker">Gunta</span>
                          <input type="number" step="0.001" value={row.gunta} onChange={(e) => updateSurveyRow(index, 'gunta', e.target.value)} />
                        </label>
                        <label className="grid" style={{ gap: 4 }}>
                          <span className="kicker">Aana</span>
                          <input type="number" step="0.001" value={row.aana} onChange={(e) => updateSurveyRow(index, 'aana', e.target.value)} />
                        </label>
                      </div>
                      <div className="grid cols-4" style={{ gap: 8, marginTop: 6 }}>
                        <label className="grid" style={{ gap: 4 }}>
                          <span className="kicker">Kharab Acre</span>
                          <input type="number" step="0.001" value={row.kharab_acre} onChange={(e) => updateSurveyRow(index, 'kharab_acre', e.target.value)} />
                        </label>
                        <label className="grid" style={{ gap: 4 }}>
                          <span className="kicker">Kharab Gunta</span>
                          <input type="number" step="0.001" value={row.kharab_gunta} onChange={(e) => updateSurveyRow(index, 'kharab_gunta', e.target.value)} />
                        </label>
                        <label className="grid" style={{ gap: 4 }}>
                          <span className="kicker">Kharab Aana</span>
                          <input type="number" step="0.001" value={row.kharab_aana} onChange={(e) => updateSurveyRow(index, 'kharab_aana', e.target.value)} />
                        </label>
                        <div style={{ display: 'flex', alignItems: 'end' }}>
                          <button type="button" className="ghost" onClick={() => removeSurveyRow(index)} disabled={surveyRows.length === 1}>Remove Row</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="secondary" onClick={addSurveyRow}>Add Row</button>
                  <Badge tone="info">Total: {surveyTotals.acre.toFixed(3)}A / {surveyTotals.gunta.toFixed(3)}G / {surveyTotals.aana.toFixed(3)}Aa</Badge>
                  <Badge tone="warn">Kharab: {surveyTotals.kharab_acre.toFixed(3)}A / {surveyTotals.kharab_gunta.toFixed(3)}G / {surveyTotals.kharab_aana.toFixed(3)}Aa</Badge>
                  <Badge tone="success">
                    Net: {(surveyTotals.acre - surveyTotals.kharab_acre).toFixed(3)}A / {(surveyTotals.gunta - surveyTotals.kharab_gunta).toFixed(3)}G / {(surveyTotals.aana - surveyTotals.kharab_aana).toFixed(3)}Aa
                  </Badge>
                </div>
              </div>
            ) : null}

            <label className="grid" style={{ gap: 6, marginTop: '0.8rem' }}>
              <span className="kicker">Address</span>
              <textarea rows={3} value={form.address} onChange={(e) => updateForm('address', e.target.value)} placeholder="Property address, route hints, or parcel notes" />
            </label>
          </Card>

          <Card>
            <CardHeader title="Initial Documents" subtitle="Guided upload slots from service line + land policy blocks." />
            {templateSlots.length === 0 ? (
              <EmptyState>No configured upload slots for this service line yet.</EmptyState>
            ) : (
              <div className="grid" style={{ gap: 10 }}>
                <div>
                  <div className="kicker" style={{ marginBottom: 6 }}>Required Slots</div>
                  {requiredSlots.length === 0 ? (
                    <div className="muted">No required slots.</div>
                  ) : (
                    <div className="list">
                      {requiredSlots.map((slot) => (
                        <div key={`required-slot-${slot.category}`} className="list-item">
                          <div className="grid cols-3" style={{ gap: 8, alignItems: 'center' }}>
                            <div>
                              <strong>{slot.label || slot.category}</strong>
                              <div className="muted" style={{ fontSize: 12 }}>{slot.category}</div>
                            </div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              Max files: {slot.max_files} · Selected: {(slotFiles[slot.category] || []).length}
                            </div>
                            <input
                              type="file"
                              multiple={Number(slot.max_files) > 1}
                              onChange={(e) => updateSlotFiles(slot.category, e.target.files)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="kicker" style={{ marginBottom: 6 }}>Optional Slots</div>
                  {optionalSlots.length === 0 ? (
                    <div className="muted">No optional slots.</div>
                  ) : (
                    <div className="list">
                      {optionalSlots.map((slot) => (
                        <div key={`optional-slot-${slot.category}`} className="list-item">
                          <div className="grid cols-3" style={{ gap: 8, alignItems: 'center' }}>
                            <div>
                              <strong>{slot.label || slot.category}</strong>
                              <div className="muted" style={{ fontSize: 12 }}>{slot.category}</div>
                            </div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              Max files: {slot.max_files} · Selected: {(slotFiles[slot.category] || []).length}
                            </div>
                            <input
                              type="file"
                              multiple={Number(slot.max_files) > 1}
                              onChange={(e) => updateSlotFiles(slot.category, e.target.files)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <div className="kicker" style={{ marginBottom: 6 }}>Additional Uploads</div>
              <div className="grid" style={{ gap: 8 }}>
                {initialDocs.map((doc, index) => (
                  <div key={`initial-doc-${index}`} className="grid cols-4" style={{ gap: 8 }}>
                    <input
                      type="file"
                      onChange={(e) => updateInitialDoc(index, 'file', e.target.files?.[0] || null)}
                    />
                    <input
                      placeholder="Category (optional)"
                      value={doc.category}
                      onChange={(e) => updateInitialDoc(index, 'category', e.target.value)}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(doc.isFinal)}
                        onChange={(e) => updateInitialDoc(index, 'isFinal', e.target.checked)}
                      />
                      Mark as final submission
                    </label>
                    <button type="button" className="ghost" onClick={() => removeInitialDoc(index)} disabled={initialDocs.length === 1}>Remove</button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                <button type="button" className="secondary" onClick={addInitialDoc}>Add Document Row</button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Commercials & Notes" subtitle="Fees feed invoices. Notes feed timeline and handoff context." />
            <div className="grid cols-3">
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Fees</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.fees}
                  onChange={(e) => updateForm('fees', e.target.value)}
                  placeholder="0.00"
                  disabled={!canModifyMoney}
                />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                <input
                  type="checkbox"
                  checked={form.is_paid}
                  onChange={(e) => updateForm('is_paid', e.target.checked)}
                  disabled={!canModifyMoney}
                />
                Mark paid
              </label>

              <div className="list-item">
                <div className="kicker">Billing</div>
                <div style={{ marginTop: 6 }}>
                  Payment approvals and invoice totals are still governed server-side.
                </div>
              </div>
            </div>

            <label className="grid" style={{ gap: 6, marginTop: '0.8rem' }}>
              <span className="kicker">Notes</span>
              <textarea rows={4} value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} placeholder="Initial context, document expectations, or internal instructions" />
            </label>
          </Card>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" disabled={submitting}>{submitting ? 'Creating...' : draftMode ? 'Submit Draft' : 'Create Assignment'}</button>
            <button type="button" className="secondary" onClick={() => navigate('/assignments')}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

function Stat({ label, value, help }) {
  return (
    <div className="card tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <InfoTip text={help} /> : null}
      </div>
      <div className="stat-value">{value}</div>
    </div>
  )
}
