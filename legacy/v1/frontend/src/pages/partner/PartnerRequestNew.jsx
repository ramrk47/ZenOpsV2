import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import InfoTip from '../../components/ui/InfoTip'
import {
  createPartnerCommission,
  fetchPartnerCommission,
  fetchPartnerProfile,
  submitPartnerCommission,
  updatePartnerCommission,
  uploadPartnerCommissionDocument,
} from '../../api/partner'
import { toUserMessage } from '../../api/client'

const SERVICE_LINES = ['VALUATION', 'INDUSTRIAL', 'DPR', 'CMA']

export default function PartnerRequestNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const draftIdParam = searchParams.get('draft')
  const parsedDraftId = draftIdParam ? Number(draftIdParam) : null
  const draftId = Number.isFinite(parsedDraftId) ? parsedDraftId : null
  const [commissionId, setCommissionId] = useState(draftId)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({
    bank_id: '',
    branch_id: '',
    bank_name: '',
    branch_name: '',
    borrower_name: '',
    phone: '',
    address: '',
    property_type_id: '',
    property_type: '',
    land_area: '',
    builtup_area: '',
    service_line: '',
    site_visit_date: '',
    report_due_date: '',
    notes: '',
  })

  const [multiFloorEnabled, setMultiFloorEnabled] = useState(false)
  const [floors, setFloors] = useState([{ floor_name: 'Ground Floor', area: '' }])

  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [formErrors, setFormErrors] = useState([])

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      try {
        const data = await fetchPartnerProfile()
        if (!cancelled) setProfile(data)
      } catch (err) {
        console.error(err)
      }
    }
    loadProfile()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    async function loadDraft() {
      setLoadingDraft(true)
      try {
        const data = await fetchPartnerCommission(draftId)
        if (cancelled) return
        setCommissionId(data.id)
        setForm((prev) => ({
          ...prev,
          bank_id: data.bank_id ? String(data.bank_id) : '',
          branch_id: data.branch_id ? String(data.branch_id) : '',
          bank_name: data.bank_name || '',
          branch_name: data.branch_name || '',
          borrower_name: data.borrower_name || '',
          phone: data.phone || '',
          address: data.address || '',
          property_type_id: data.property_type_id ? String(data.property_type_id) : '',
          property_type: data.property_type || '',
          land_area: data.land_area || '',
          builtup_area: data.builtup_area || '',
          service_line: data.service_line || '',
          site_visit_date: data.site_visit_date ? data.site_visit_date.slice(0, 10) : '',
          report_due_date: data.report_due_date ? data.report_due_date.slice(0, 10) : '',
          notes: data.notes || '',
        }))
        const floorRows = (data.floors || []).map((floor, index) => ({
          id: floor.id || `floor-${index}`,
          floor_name: floor.floor_name || '',
          area: floor.area != null ? String(floor.area) : '',
          order_index: floor.order_index ?? index,
        }))
        if (floorRows.length > 0) {
          setFloors(floorRows)
          setMultiFloorEnabled(true)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load draft'))
      } finally {
        if (!cancelled) setLoadingDraft(false)
      }
    }
    loadDraft()
    return () => {
      cancelled = true
    }
  }, [draftId])

  useEffect(() => {
    if (!profile) return
    if (!form.service_line && profile.service_lines && profile.service_lines.length > 0) {
      setForm((prev) => ({ ...prev, service_line: profile.service_lines[0] }))
    }
  }, [profile, form.service_line])

  const allowedServiceLines = useMemo(() => {
    if (profile?.service_lines && profile.service_lines.length > 0) return profile.service_lines
    return SERVICE_LINES
  }, [profile])

  const totalFloorArea = useMemo(() => (
    floors.reduce((sum, floor) => sum + (Number(floor.area) || 0), 0)
  ), [floors])

  function validateForm({ submit } = { submit: false }) {
    if (!submit) return []

    const issues = []
    const validFloors = floors.filter((floor) => floor.floor_name?.trim() && Number(floor.area) > 0)
    const hasBank = Boolean(form.bank_id) || Boolean(form.bank_name?.trim())
    const hasBranch = Boolean(form.branch_id) || Boolean(form.branch_name?.trim())
    const hasArea = Number(form.land_area) > 0 || Number(form.builtup_area) > 0 || validFloors.length > 0

    if (!form.service_line) issues.push('Service line is required before submitting.')
    if (!hasBank) issues.push('Bank name is required before submitting.')
    if (!hasBranch) issues.push('Branch name is required before submitting.')
    if (!form.borrower_name?.trim()) issues.push('Borrower name is required before submitting.')
    if (!form.phone?.trim()) issues.push('Phone number is required before submitting.')
    if (!(form.property_type?.trim() || form.property_type_id)) {
      issues.push('Property type is required before submitting.')
    }
    if (!hasArea) issues.push('Add land area, built-up area, or floor-wise area before submitting.')
    if (!form.address?.trim()) issues.push('Property address is required before submitting.')
    if (multiFloorEnabled && validFloors.length === 0) {
      issues.push('Add at least one valid floor row before submitting.')
    }

    return issues
  }

  function buildPayload() {
    const payload = {
      bank_id: form.bank_id ? Number(form.bank_id) : null,
      branch_id: form.branch_id ? Number(form.branch_id) : null,
      bank_name: form.bank_name?.trim() || null,
      branch_name: form.branch_name?.trim() || null,
      borrower_name: form.borrower_name?.trim() || null,
      phone: form.phone?.trim() || null,
      address: form.address?.trim() || null,
      property_type_id: form.property_type_id ? Number(form.property_type_id) : null,
      property_type: form.property_type?.trim() || null,
      land_area: form.land_area ? Number(form.land_area) : null,
      builtup_area: multiFloorEnabled ? null : form.builtup_area ? Number(form.builtup_area) : null,
      service_line: form.service_line || null,
      site_visit_date: form.site_visit_date ? new Date(form.site_visit_date).toISOString() : null,
      report_due_date: form.report_due_date ? new Date(form.report_due_date).toISOString() : null,
      notes: form.notes?.trim() || null,
    }
    const floorPayload = floors
      .map((floor, index) => ({
        floor_name: floor.floor_name?.trim() || '',
        area: floor.area ? Number(floor.area) : null,
        order_index: Number.isFinite(floor.order_index) ? floor.order_index : index,
      }))
      .filter((floor) => floor.floor_name && floor.area != null)
    if (multiFloorEnabled) {
      payload.floors = floorPayload
    } else if (commissionId) {
      payload.floors = []
    }
    return payload
  }

  async function uploadFiles(commissionId) {
    if (!files.length) return
    for (const file of files) {
      await uploadPartnerCommissionDocument(commissionId, { file })
    }
    setFiles([])
  }

  async function handleSave({ submit } = { submit: false }) {
    setError(null)
    setNotice(null)
    setFormErrors([])
    const validationErrors = validateForm({ submit })
    if (validationErrors.length > 0) {
      setError('Fill the required request details before submitting for approval.')
      setFormErrors(validationErrors)
      return
    }

    setSaving(true)
    try {
      const payload = buildPayload()
      const commission = commissionId
        ? await updatePartnerCommission(commissionId, payload)
        : await createPartnerCommission(payload)
      if (!commissionId) setCommissionId(commission.id)
      await uploadFiles(commission.id)
      if (submit) {
        const submitted = await submitPartnerCommission(commission.id)
        setNotice('Request submitted for approval.')
        navigate(`/partner/requests/${submitted.id}`)
        return
      }
      setNotice('Draft saved.')
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to save commission request'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={commissionId ? 'Edit Commission Request' : 'New Commission Request'}
        subtitle="Share only associate-required details. Internal workflow stays private."
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}
      {notice ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{notice}</div> : null}
      {formErrors.length > 0 ? (
        <div className="empty" style={{ marginBottom: '0.9rem' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Required before submit</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {formErrors.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {loadingDraft ? <div className="muted">Loading draft…</div> : null}

      <div className="grid" style={{ gap: '1rem' }}>
        <Card>
          <CardHeader title="Case Details" subtitle="Tell us about the borrower and property." />
          <div
            className="grid"
            style={{ gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
          >
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Service line</span>
              <select
                value={form.service_line}
                onChange={(e) => setForm((prev) => ({ ...prev, service_line: e.target.value }))}
              >
                <option value="">Select service line</option>
                {allowedServiceLines.map((line) => (
                  <option key={line} value={line}>{line}</option>
                ))}
              </select>
            </label>
            <input
              placeholder="Bank name"
              value={form.bank_name}
              onChange={(e) => setForm((prev) => ({ ...prev, bank_name: e.target.value }))}
            />
            <input
              placeholder="Branch name"
              value={form.branch_name}
              onChange={(e) => setForm((prev) => ({ ...prev, branch_name: e.target.value }))}
            />
            <input
              placeholder="Borrower name"
              value={form.borrower_name}
              onChange={(e) => setForm((prev) => ({ ...prev, borrower_name: e.target.value }))}
            />
            <input
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            />
            <input
              placeholder="Property type"
              value={form.property_type}
              onChange={(e) => setForm((prev) => ({ ...prev, property_type: e.target.value }))}
            />
            <input
              placeholder="Land area (sqft)"
              value={form.land_area}
              onChange={(e) => setForm((prev) => ({ ...prev, land_area: e.target.value }))}
            />
            <input
              placeholder="Built-up area (sqft)"
              value={multiFloorEnabled ? totalFloorArea || '' : form.builtup_area}
              onChange={(e) => setForm((prev) => ({ ...prev, builtup_area: e.target.value }))}
              disabled={multiFloorEnabled}
            />
            <textarea
              className="grow"
              placeholder="Property address"
              value={form.address}
              onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
              rows={3}
            />
          </div>
        </Card>

        {profile?.multi_floor_enabled ? (
          <Card>
            <CardHeader title="Floor Areas" subtitle="Optional multi-floor breakdown when applicable." />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={multiFloorEnabled}
                onChange={(e) => setMultiFloorEnabled(e.target.checked)}
              />
              <span>Use multi-floor breakdown</span>
            </label>
            {multiFloorEnabled ? (
              <div className="grid" style={{ gap: 12 }}>
                {floors.map((floor, index) => (
                  <div
                    key={floor.id || `floor-${index}`}
                    className="grid"
                    style={{ gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
                  >
                    <input
                      placeholder="Floor name"
                      value={floor.floor_name}
                      onChange={(e) => setFloors((prev) => prev.map((row, idx) => (
                        idx === index ? { ...row, floor_name: e.target.value } : row
                      )))}
                    />
                    <input
                      placeholder="Area (sqft)"
                      value={floor.area}
                      onChange={(e) => setFloors((prev) => prev.map((row, idx) => (
                        idx === index ? { ...row, area: e.target.value } : row
                      )))}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setFloors((prev) => prev.filter((_, idx) => idx !== index))}
                        disabled={floors.length === 1}
                      >
                        Remove
                      </button>
                      {index === floors.length - 1 ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setFloors((prev) => ([...prev, { floor_name: '', area: '' }]))}
                        >
                          Add Floor
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
                <div className="muted" style={{ fontSize: 12 }}>
                  Total built-up area: {totalFloorArea || 0} sqft
                </div>
              </div>
            ) : (
              <EmptyState>Enable multi-floor to capture per-floor areas.</EmptyState>
            )}
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Dates" subtitle="Optional scheduling references." />
          <div
            className="grid"
            style={{ gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
          >
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Site visit date</span>
              <input
                type="date"
                value={form.site_visit_date}
                onChange={(e) => setForm((prev) => ({ ...prev, site_visit_date: e.target.value }))}
              />
            </label>
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Expected report due date</span>
              <input
                type="date"
                value={form.report_due_date}
                onChange={(e) => setForm((prev) => ({ ...prev, report_due_date: e.target.value }))}
              />
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Notes to Zen Ops"
            subtitle="Add any context or constraints."
            action={<InfoTip text="Internal teams will review these notes with your submission." />}
          />
          <textarea
            rows={4}
            placeholder="Add notes or special instructions"
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </Card>

        <Card>
          <CardHeader title="Document Upload" subtitle="Attach any supporting files." />
          <div className="upload-zone">
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            {files.length === 0 ? (
              <EmptyState>Drag and drop or choose files to upload.</EmptyState>
            ) : (
              <div className="list">
                {files.map((file) => (
                  <div key={file.name} className="list-item">
                    <div style={{ fontWeight: 600 }}>{file.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{Math.round(file.size / 1024)} KB</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="secondary" onClick={() => handleSave({ submit: false })} disabled={saving || loadingDraft}>
            Save Draft
          </button>
          <button type="button" onClick={() => handleSave({ submit: true })} disabled={saving || loadingDraft}>
            Submit for Approval
          </button>
        </div>
      </div>
    </div>
  )
}
