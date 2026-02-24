import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import { Card, CardHeader } from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import InfoTip from '../components/ui/InfoTip'
import { createAssignment } from '../api/assignments'
import { fetchUserDirectory } from '../api/users'
import { fetchBanks, fetchBranches, fetchClients, fetchPropertyTypes, fetchPropertySubtypes } from '../api/master'
import { titleCase } from '../utils/format'
import { toUserMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { hasCapability } from '../utils/rbac'

const CASE_TYPES = ['BANK', 'EXTERNAL_VALUER', 'DIRECT_CLIENT']
const SERVICE_LINES = ['VALUATION', 'INDUSTRIAL', 'DPR', 'CMA']
const STATUSES = ['PENDING', 'SITE_VISIT', 'UNDER_PROCESS', 'SUBMITTED', 'COMPLETED', 'CANCELLED']

function toIso(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export default function NewAssignment() {
  const navigate = useNavigate()
  const { user, capabilities } = useAuth()
  const canModifyMoney = hasCapability(capabilities, 'modify_money')
  const canCreateAssignment = hasCapability(capabilities, 'create_assignment')

  const [users, setUsers] = useState([])
  const [banks, setBanks] = useState([])
  const [branches, setBranches] = useState([])
  const [clients, setClients] = useState([])
  const [propertyTypes, setPropertyTypes] = useState([])
  const [propertySubtypes, setPropertySubtypes] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    case_type: 'BANK',
    service_line: 'VALUATION',
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
    status: 'PENDING',
    assigned_to_user_id: user?.id ? String(user.id) : '',
    assignee_user_ids: [],
    site_visit_date: '',
    report_due_date: '',
    fees: '',
    is_paid: false,
    notes: '',
  })

  const [multiFloorEnabled, setMultiFloorEnabled] = useState(false)
  const [floors, setFloors] = useState([{ floor_name: 'Ground Floor', area: '' }])

  if (!canCreateAssignment) {
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
    const range = detail.leave_start && detail.leave_end ? `${detail.leave_start} → ${detail.leave_end}` : 'current leave'
    return window.confirm(`Assignee is on approved leave (${range}). Assign anyway?`)
  }

  useEffect(() => {
    let cancelled = false

    async function loadReferenceData() {
      setLoading(true)
      setError(null)
      try {
        const [bankData, branchData, clientData, propertyData, subtypeData] = await Promise.all([
          fetchBanks(),
          fetchBranches(),
          fetchClients(),
          fetchPropertyTypes(),
          fetchPropertySubtypes().catch(() => []),
        ])

        let userData = []
        try {
          userData = await fetchUserDirectory()
        } catch (err) {
          console.warn('Unable to load full user list; falling back to current user')
          userData = user ? [user] : []
        }

        if (cancelled) return
        setBanks(bankData)
        setBranches(branchData)
        setClients(clientData)
        setPropertyTypes(propertyData)
        setPropertySubtypes(subtypeData)
        setUsers(userData)

        if (!form.assigned_to_user_id && user?.id) {
          setForm((prev) => ({ ...prev, assigned_to_user_id: String(user.id) }))
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

  function validateForm() {
    if (!form.case_type) return 'Case type is required.'
    if (!form.borrower_name.trim()) return 'Borrower name is required.'

    if (isBankCase) {
      if (!form.bank_id) return 'Bank is required for BANK cases.'
      if (!form.branch_id) return 'Branch is required for BANK cases.'
    } else if (!form.client_id && !form.valuer_client_name.trim()) {
      return 'Client is required for non-bank cases (select one or type a name).'
    }

    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setSubmitting(true)
    let payload = null
    try {
      const floorsPayload = multiFloorEnabled
        ? floors
            .map((row, order_index) => ({
              floor_name: row.floor_name.trim(),
              area: Number(row.area),
              order_index,
            }))
            .filter((row) => row.floor_name && Number.isFinite(row.area) && row.area > 0)
        : []

      const builtupArea = multiFloorEnabled
        ? floorsPayload.length > 0
          ? floorTotal
          : null
        : form.builtup_area
          ? Number(form.builtup_area)
          : null

      const assigneeIds = new Set()
      if (form.assigned_to_user_id) assigneeIds.add(Number(form.assigned_to_user_id))
      form.assignee_user_ids.forEach((uid) => {
        const parsed = Number(uid)
        if (Number.isFinite(parsed)) assigneeIds.add(parsed)
      })

      payload = {
        case_type: form.case_type,
        service_line: form.service_line,
        bank_id: isBankCase && form.bank_id ? Number(form.bank_id) : null,
        branch_id: isBankCase && form.branch_id ? Number(form.branch_id) : null,
        client_id: !isBankCase && form.client_id ? Number(form.client_id) : null,
        valuer_client_name: !isBankCase && !form.client_id ? form.valuer_client_name.trim() : null,
        property_type_id: form.property_type_id ? Number(form.property_type_id) : null,
        property_subtype_id: form.property_subtype_id ? Number(form.property_subtype_id) : null,
        borrower_name: form.borrower_name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        land_area: form.land_area ? Number(form.land_area) : null,
        builtup_area: builtupArea,
        status: form.status,
        assigned_to_user_id: form.assigned_to_user_id ? Number(form.assigned_to_user_id) : null,
        assignee_user_ids: assigneeIds.size > 0 ? Array.from(assigneeIds) : [],
        site_visit_date: toIso(form.site_visit_date),
        report_due_date: toIso(form.report_due_date),
        notes: form.notes.trim() || null,
      }

      if (canModifyMoney) {
        payload.fees = form.fees ? Number(form.fees) : null
        payload.is_paid = Boolean(form.is_paid)
      }

      if (multiFloorEnabled) {
        payload.floors = floorsPayload
      }

      const created = await createAssignment(payload)
      navigate(`/assignments/${created.id}`)
    } catch (err) {
      console.error(err)
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 409 && payload && confirmLeaveOverride(detail)) {
        try {
          const created = await createAssignment({ ...payload, override_on_leave: true })
          navigate(`/assignments/${created.id}`)
          return
        } catch (innerErr) {
          console.error(innerErr)
          setError(toUserMessage(innerErr, 'Failed to create assignment'))
          return
        }
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
        subtitle="Capture the essentials quickly, then drive the workflow from the command center."
        actions={selectedBank ? <Badge tone="info">{selectedBank.name}</Badge> : selectedClient ? <Badge tone="info">{selectedClient.name}</Badge> : null}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      {loading ? (
        <div className="muted">Loading reference data…</div>
      ) : (
        <form className="grid" onSubmit={handleSubmit}>
          <div className="grid cols-4">
            <Stat label="Banks" value={banks.length} help="Active bank records available for assignment." />
            <Stat label="Branches" value={branches.length} help="Branch records linked to banks." />
            <Stat label="Clients" value={clients.length} help="Non-bank clients in master data." />
            <Stat label="Property Types" value={propertyTypes.length} help="Top-level property categories." />
            <Stat label="Property Subtypes" value={propertySubtypes.length} help="Subtypes used for fine-grain classification." />
          </div>

          <Card>
            <CardHeader title="Case Setup" subtitle="Case type drives required master data and document rules." />
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
                <select value={form.service_line} onChange={(e) => updateForm('service_line', e.target.value)}>
                  {SERVICE_LINES.map((line) => (
                    <option key={line} value={line}>{titleCase(line)}</option>
                  ))}
                </select>
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Status</span>
                <select value={form.status} onChange={(e) => updateForm('status', e.target.value)}>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>{titleCase(status)}</option>
                  ))}
                </select>
              </label>

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
                    Bank + branch drives document checklist templates and invoice bank-ready packs.
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
            <CardHeader title="Borrower & Property" subtitle="High-signal metadata for field and report teams." />
            <div className="grid cols-3">
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Borrower Name</span>
                <input value={form.borrower_name} onChange={(e) => updateForm('borrower_name', e.target.value)} required />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Phone</span>
                <input value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} placeholder="Optional" />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Land Area</span>
                <input type="number" step="0.01" value={form.land_area} onChange={(e) => updateForm('land_area', e.target.value)} placeholder="sq ft / sq m" />
              </label>
            </div>

            <div className="grid cols-3" style={{ marginTop: '0.8rem' }}>
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
                    placeholder="sq ft / sq m"
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
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Site Visit</span>
                <input type="datetime-local" value={form.site_visit_date} onChange={(e) => updateForm('site_visit_date', e.target.value)} />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Report Due</span>
                <input type="datetime-local" value={form.report_due_date} onChange={(e) => updateForm('report_due_date', e.target.value)} />
              </label>
            </div>

            {multiFloorEnabled ? (
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

            <label className="grid" style={{ gap: 6, marginTop: '0.8rem' }}>
              <span className="kicker">Address</span>
              <textarea rows={3} value={form.address} onChange={(e) => updateForm('address', e.target.value)} placeholder="Property address, route hints, or parcel notes" />
            </label>
          </Card>

          <Card>
            <CardHeader title="Commercials & Notes" subtitle="Fees feed invoices. Notes feed the timeline." />
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
                  Assignment codes automatically flow into invoice numbers for tight financial tracking.
                </div>
              </div>
            </div>

            <label className="grid" style={{ gap: 6, marginTop: '0.8rem' }}>
              <span className="kicker">Notes</span>
              <textarea rows={4} value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} placeholder="Initial context, doc expectations, or internal instructions" />
            </label>
          </Card>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create Assignment'}</button>
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
