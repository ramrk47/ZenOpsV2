import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, Chip, MobileListSkeleton, Section, StickyFooter } from '../components/Primitives'
import { createDraftAssignment, fetchAssignment, updateAssignment } from '../../api/assignments'
import { requestApproval } from '../../api/approvals'
import { fetchBanks, fetchBranches, fetchClients, fetchServiceLines } from '../../api/master'
import { toUserMessage } from '../../api/client'

const CASE_TYPES = ['BANK', 'EXTERNAL_VALUER', 'DIRECT_CLIENT']
const UOM_OPTIONS = [
  { value: 'SQFT', label: 'Square Feet (sqft)' },
  { value: 'SQM', label: 'Square Meter (sqm)' },
  { value: 'ACRE_GUNTA_AANA', label: 'Acre-Gunta-Aana' },
  { value: 'ACRE_GUNTA', label: 'Acre-Gunta' },
]

function mapServiceLineKeyToLegacy(serviceLineKey) {
  const key = String(serviceLineKey || '').trim().toUpperCase()
  if (['PROJECT_REPORT', 'DCC'].includes(key)) return 'DPR'
  return 'VALUATION'
}

function toIso(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function toLocalInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setSeconds(0, 0)
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16)
}

function parseNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const STEP_COPY = {
  1: {
    title: 'Service + Customer',
    body: 'Define case type, service line, customer identity, and the originating bank or client.',
  },
  2: {
    title: 'Land Inputs',
    body: 'Capture land mode and the core land or survey values required to open the draft cleanly.',
  },
  3: {
    title: 'Final Details',
    body: 'Set deadline, contact context, and the notes that operations will rely on downstream.',
  },
}

function StepButton({ value, active, onClick }) {
  return (
    <button type="button" className={`m-step ${active ? 'active' : ''}`.trim()} onClick={() => onClick(value)}>
      <span className="m-step-index">{value}</span>
      <span className="m-step-copy">
        <strong>{STEP_COPY[value].title}</strong>
        <small>{STEP_COPY[value].body}</small>
      </span>
    </button>
  )
}

export default function CreateAssignmentScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const assignmentId = searchParams.get('assignmentId')

  const [step, setStep] = useState(1)
  const [banks, setBanks] = useState([])
  const [branches, setBranches] = useState([])
  const [clients, setClients] = useState([])
  const [serviceLines, setServiceLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [form, setForm] = useState({
    case_type: 'BANK',
    service_line_id: '',
    uom: 'SQFT',
    bank_id: '',
    branch_id: '',
    client_id: '',
    valuer_client_name: '',
    borrower_name: '',
    phone: '',
    address: '',
    report_due_date: '',
    land_mode: 'normal',
    land_area: '',
    builtup_area: '',
    survey_no: '',
    survey_acre: '',
    survey_gunta: '',
    notes: '',
    submit_after_save: true,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const [bankData, branchData, clientData, serviceLineData] = await Promise.all([
          fetchBanks(),
          fetchBranches(),
          fetchClients(),
          fetchServiceLines({ include_inactive: false }),
        ])

        if (cancelled) return
        setBanks(bankData || [])
        setBranches(branchData || [])
        setClients(clientData || [])
        setServiceLines((serviceLineData || []).filter((line) => line.is_active !== false))

        if (assignmentId) {
          const detail = await fetchAssignment(assignmentId)
          const assignment = detail?.assignment
          if (!assignment || cancelled) return
          setForm((prev) => ({
            ...prev,
            case_type: assignment.case_type || 'BANK',
            service_line_id: assignment.service_line_id ? String(assignment.service_line_id) : '',
            uom: assignment.uom || 'SQFT',
            bank_id: assignment.bank_id ? String(assignment.bank_id) : '',
            branch_id: assignment.branch_id ? String(assignment.branch_id) : '',
            client_id: assignment.client_id ? String(assignment.client_id) : '',
            valuer_client_name: assignment.valuer_client_name || '',
            borrower_name: assignment.borrower_name || '',
            phone: assignment.phone || '',
            address: assignment.address || '',
            report_due_date: toLocalInput(assignment.report_due_date),
            land_area: assignment.land_area ? String(assignment.land_area) : '',
            builtup_area: assignment.builtup_area ? String(assignment.builtup_area) : '',
            notes: assignment.notes || '',
            submit_after_save: assignment.status !== 'DRAFT_PENDING_APPROVAL',
          }))
        }
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Unable to load create-assignment data.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [assignmentId])

  const selectedServiceLine = useMemo(
    () => serviceLines.find((line) => String(line.id) === String(form.service_line_id)),
    [form.service_line_id, serviceLines],
  )

  const filteredBranches = useMemo(() => {
    if (!form.bank_id) return branches
    return branches.filter((branch) => String(branch.bank_id) === String(form.bank_id))
  }, [branches, form.bank_id])

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function validateCurrentStep() {
    if (step === 1) {
      if (!form.service_line_id) return 'Service line is required.'
      if (!form.uom) return 'Unit of measurement is required.'
      if (!form.borrower_name.trim()) return 'Customer/borrower name is required.'
      if (form.case_type === 'BANK' && (!form.bank_id || !form.branch_id)) {
        return 'Bank and branch are required for bank cases.'
      }
      if (form.case_type !== 'BANK' && !form.client_id && !form.valuer_client_name.trim()) {
        return 'Client name is required for non-bank cases.'
      }
      return ''
    }

    if (step === 2 && form.land_mode === 'survey' && !form.survey_no.trim()) {
      return 'Survey number is required in survey mode.'
    }

    return ''
  }

  async function handleSave() {
    const validationError = validateCurrentStep()
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    try {
      const payload = {
        case_type: form.case_type,
        service_line_id: Number(form.service_line_id),
        service_line: mapServiceLineKeyToLegacy(selectedServiceLine?.key),
        uom: form.uom,
        bank_id: form.case_type === 'BANK' ? Number(form.bank_id) : null,
        branch_id: form.case_type === 'BANK' ? Number(form.branch_id) : null,
        client_id: form.case_type !== 'BANK' && form.client_id ? Number(form.client_id) : null,
        valuer_client_name: form.case_type !== 'BANK' && !form.client_id ? form.valuer_client_name.trim() || null : null,
        borrower_name: form.borrower_name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        report_due_date: toIso(form.report_due_date),
        land_area: parseNumber(form.land_area),
        builtup_area: parseNumber(form.builtup_area),
        land_surveys: form.land_mode === 'survey'
          ? [{
              serial_no: 1,
              survey_no: form.survey_no.trim(),
              acre: Number(form.survey_acre || 0),
              gunta: Number(form.survey_gunta || 0),
              aana: 0,
              kharab_acre: 0,
              kharab_gunta: 0,
              kharab_aana: 0,
            }]
          : [],
        status: 'DRAFT_PENDING_APPROVAL',
        notes: form.notes.trim() || null,
      }

      let saved
      if (assignmentId) {
        saved = await updateAssignment(assignmentId, payload)
      } else {
        saved = await createDraftAssignment(payload)
      }

      if (assignmentId && form.submit_after_save && saved?.status !== 'DRAFT_PENDING_APPROVAL') {
        await requestApproval({
          approval_type: 'DRAFT_ASSIGNMENT',
          entity_type: 'ASSIGNMENT',
          entity_id: saved.id,
          action_type: 'FINAL_REVIEW',
          reason: 'Draft submitted from mobile wizard',
          assignment_id: saved.id,
        })
      }

      const submittedMsg = assignmentId
        ? (form.submit_after_save ? 'Draft saved and submitted for approval.' : 'Draft saved.')
        : 'Draft created and submitted for approval.'
      setNotice(submittedMsg)

      navigate(`/m/assignments/${saved.id}`)
    } catch (err) {
      setError(toUserMessage(err, 'Unable to save draft assignment.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <MobileLayout title="Create Assignment" subtitle="Mobile wizard">
        <MobileListSkeleton rows={6} />
      </MobileLayout>
    )
  }

  return (
    <MobileLayout
      title={assignmentId ? 'Continue Draft' : 'Create Assignment'}
      subtitle={assignmentId ? 'Resume mobile draft' : 'Draft-first mobile workflow'}
      secondaryAction={{ label: 'Assignments', to: '/m/assignments' }}
    >
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}
      {notice ? <div className="m-alert m-alert-ok">{notice}</div> : null}

      <Card className="m-note-card" style={{ marginBottom: '0.9rem' }}>
        <strong>{assignmentId ? 'Continuing a saved draft' : 'Create fast, refine later'}</strong>
        <p>
          This workflow is optimized for phone use. The draft is created first, then routed through approval
          so nothing operational is committed prematurely.
        </p>
      </Card>

      <div className="m-stepper">
        {[1, 2, 3].map((value) => (
          <StepButton key={value} value={value} active={step === value} onClick={setStep} />
        ))}
      </div>

      {step === 1 ? (
        <Section title="Service + Customer" subtitle="Open the draft with the correct source and customer context.">
          <Card>
            <div className="m-form-grid">
              <label>
                <span>Case Type</span>
                <select value={form.case_type} onChange={(e) => setField('case_type', e.target.value)}>
                  {CASE_TYPES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}
                </select>
              </label>

              <label>
                <span>Service Line</span>
                <select value={form.service_line_id} onChange={(e) => setField('service_line_id', e.target.value)}>
                  <option value="">Select</option>
                  {serviceLines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
                </select>
              </label>

              <label>
                <span>Unit of Measurement</span>
                <select value={form.uom} onChange={(e) => setField('uom', e.target.value)}>
                  {UOM_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>

              <label>
                <span>Borrower / Customer Name</span>
                <input value={form.borrower_name} onChange={(e) => setField('borrower_name', e.target.value)} />
              </label>

              {form.case_type === 'BANK' ? (
                <>
                  <label>
                    <span>Bank</span>
                    <select value={form.bank_id} onChange={(e) => {
                      setField('bank_id', e.target.value)
                      setField('branch_id', '')
                    }}>
                      <option value="">Select</option>
                      {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
                    </select>
                  </label>

                  <label>
                    <span>Branch</span>
                    <select value={form.branch_id} onChange={(e) => setField('branch_id', e.target.value)}>
                      <option value="">Select</option>
                      {filteredBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>Client</span>
                    <select value={form.client_id} onChange={(e) => setField('client_id', e.target.value)}>
                      <option value="">Select client</option>
                      {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                    </select>
                  </label>

                  <label>
                    <span>Client Name (if not in list)</span>
                    <input value={form.valuer_client_name} onChange={(e) => setField('valuer_client_name', e.target.value)} />
                  </label>
                </>
              )}
            </div>
          </Card>
        </Section>
      ) : null}

      {step === 2 ? (
        <Section title="Land Inputs" subtitle="Switch mode only when survey records are required for the case.">
          <Card className="m-note-card" style={{ marginBottom: '0.7rem' }}>
            <strong>{form.land_mode === 'survey' ? 'Survey mode enabled' : 'Normal land mode enabled'}</strong>
            <p>
              {form.land_mode === 'survey'
                ? 'Capture survey number and its acreage split so the ops team has the right legal land references.'
                : 'Use normal mode when the draft only needs total land and built-up values to move forward.'}
            </p>
          </Card>

          <div className="m-chip-row">
            <Chip active={form.land_mode === 'normal'} onClick={() => setField('land_mode', 'normal')}>Normal Land</Chip>
            <Chip active={form.land_mode === 'survey'} onClick={() => setField('land_mode', 'survey')}>Survey Mode</Chip>
          </div>

          <Card>
            <div className="m-form-grid">
              <label>
                <span>Land Area</span>
                <input value={form.land_area} onChange={(e) => setField('land_area', e.target.value)} inputMode="decimal" />
              </label>

              <label>
                <span>Built-up Area</span>
                <input value={form.builtup_area} onChange={(e) => setField('builtup_area', e.target.value)} inputMode="decimal" />
              </label>

              {form.land_mode === 'survey' ? (
                <>
                  <label>
                    <span>Survey Number</span>
                    <input value={form.survey_no} onChange={(e) => setField('survey_no', e.target.value)} />
                  </label>
                  <label>
                    <span>Survey Acre</span>
                    <input value={form.survey_acre} onChange={(e) => setField('survey_acre', e.target.value)} inputMode="decimal" />
                  </label>
                  <label>
                    <span>Survey Gunta</span>
                    <input value={form.survey_gunta} onChange={(e) => setField('survey_gunta', e.target.value)} inputMode="decimal" />
                  </label>
                </>
              ) : null}
            </div>
          </Card>
        </Section>
      ) : null}

      {step === 3 ? (
        <Section title="Final Details" subtitle="Set the operational context ops will see when the draft lands.">
          <div className="m-stat-grid">
            <Card className="m-stat-card">
              <p>Save Mode</p>
              <strong>{assignmentId ? 'Update' : 'Create'}</strong>
              <small>{assignmentId ? 'This draft already exists and will be updated in place.' : 'A new draft will be opened and routed from mobile.'}</small>
            </Card>
            <Card className="m-stat-card">
              <p>Approval Path</p>
              <strong>{assignmentId && !form.submit_after_save ? 'Hold' : 'Submit'}</strong>
              <small>{assignmentId && !form.submit_after_save ? 'Keep the draft in progress after save.' : 'Move the draft into approval after this save.'}</small>
            </Card>
          </div>

          <Card>
            <div className="m-form-grid">
              <label>
                <span>Phone</span>
                <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} inputMode="tel" />
              </label>
              <label>
                <span>Report Due</span>
                <input
                  type="datetime-local"
                  value={form.report_due_date}
                  onChange={(e) => setField('report_due_date', e.target.value)}
                />
              </label>
              <label>
                <span>Address</span>
                <textarea value={form.address} onChange={(e) => setField('address', e.target.value)} rows={3} />
              </label>
              <label>
                <span>Notes</span>
                <textarea value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={4} />
              </label>

              {assignmentId ? (
                <label className="m-checkbox-row">
                  <input
                    type="checkbox"
                    checked={Boolean(form.submit_after_save)}
                    onChange={(e) => setField('submit_after_save', e.target.checked)}
                  />
                  <span>Submit for approval after save</span>
                </label>
              ) : (
                <p className="m-muted-note">New drafts are auto-submitted for approval by policy.</p>
              )}
            </div>
          </Card>
        </Section>
      ) : null}

      <StickyFooter>
        <div className="m-footer-actions">
          <button
            type="button"
            className="m-secondary-btn"
            onClick={() => setStep((value) => Math.max(1, value - 1))}
            disabled={step === 1}
          >
            Previous
          </button>
          <button
            type="button"
            className="m-secondary-btn"
            onClick={() => setStep((value) => Math.min(3, value + 1))}
            disabled={step === 3}
          >
            Next
          </button>
          <button type="button" className="m-primary-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : assignmentId ? 'Save Draft' : 'Create Draft'}
          </button>
        </div>
      </StickyFooter>
    </MobileLayout>
  )
}
