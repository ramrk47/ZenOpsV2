import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, MobileEmptyState, Section, StickyFooter } from '../components/Primitives'
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

export default function AssociateRequestComposerScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const draftIdParam = searchParams.get('draft')
  const draftId = Number.isFinite(Number(draftIdParam)) ? Number(draftIdParam) : null

  const [profile, setProfile] = useState(null)
  const [commissionId, setCommissionId] = useState(draftId)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [formErrors, setFormErrors] = useState([])
  const [files, setFiles] = useState([])
  const [form, setForm] = useState({
    service_line: '',
    bank_name: '',
    branch_name: '',
    borrower_name: '',
    phone: '',
    property_type: '',
    land_area: '',
    builtup_area: '',
    address: '',
    site_visit_date: '',
    report_due_date: '',
    notes: '',
  })

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      try {
        const data = await fetchPartnerProfile()
        if (!cancelled) setProfile(data)
      } catch {}
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
        setForm({
          service_line: data.service_line || '',
          bank_name: data.bank_name || '',
          branch_name: data.branch_name || '',
          borrower_name: data.borrower_name || '',
          phone: data.phone || '',
          property_type: data.property_type || '',
          land_area: data.land_area != null ? String(data.land_area) : '',
          builtup_area: data.builtup_area != null ? String(data.builtup_area) : '',
          address: data.address || '',
          site_visit_date: data.site_visit_date ? data.site_visit_date.slice(0, 10) : '',
          report_due_date: data.report_due_date ? data.report_due_date.slice(0, 10) : '',
          notes: data.notes || '',
        })
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Failed to load draft.'))
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
    if (!profile?.service_lines?.length || form.service_line) return
    setForm((prev) => ({ ...prev, service_line: profile.service_lines[0] }))
  }, [form.service_line, profile])

  const allowedServiceLines = useMemo(() => {
    if (profile?.service_lines?.length) return profile.service_lines
    return SERVICE_LINES
  }, [profile])

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function validate({ submit } = { submit: false }) {
    if (!submit) return []
    const issues = []
    const hasArea = Number(form.land_area) > 0 || Number(form.builtup_area) > 0
    if (!form.service_line) issues.push('Service line is required.')
    if (!form.bank_name.trim()) issues.push('Bank name is required.')
    if (!form.branch_name.trim()) issues.push('Branch name is required.')
    if (!form.borrower_name.trim()) issues.push('Borrower name is required.')
    if (!form.phone.trim()) issues.push('Phone number is required.')
    if (!form.property_type.trim()) issues.push('Property type is required.')
    if (!hasArea) issues.push('Add land area or built-up area before submitting.')
    if (!form.address.trim()) issues.push('Property address is required.')
    return issues
  }

  function buildPayload() {
    return {
      service_line: form.service_line || null,
      bank_name: form.bank_name.trim() || null,
      branch_name: form.branch_name.trim() || null,
      borrower_name: form.borrower_name.trim() || null,
      phone: form.phone.trim() || null,
      property_type: form.property_type.trim() || null,
      land_area: form.land_area ? Number(form.land_area) : null,
      builtup_area: form.builtup_area ? Number(form.builtup_area) : null,
      address: form.address.trim() || null,
      site_visit_date: form.site_visit_date ? new Date(form.site_visit_date).toISOString() : null,
      report_due_date: form.report_due_date ? new Date(form.report_due_date).toISOString() : null,
      notes: form.notes.trim() || null,
    }
  }

  async function uploadFiles(id) {
    if (!files.length) return
    for (const file of files) {
      // Category stays optional in the desktop API too.
      await uploadPartnerCommissionDocument(id, { file, category: '' })
    }
    setFiles([])
  }

  async function handleSave({ submit } = { submit: false }) {
    setError('')
    setNotice('')
    setFormErrors([])

    const issues = validate({ submit })
    if (issues.length) {
      setFormErrors(issues)
      setError('Fill the required request details before submitting.')
      return
    }

    setSaving(true)
    try {
      const payload = buildPayload()
      const draft = commissionId
        ? await updatePartnerCommission(commissionId, payload)
        : await createPartnerCommission(payload)
      if (!commissionId) setCommissionId(draft.id)
      await uploadFiles(draft.id)

      if (submit) {
        const submitted = await submitPartnerCommission(draft.id)
        setNotice('Associate request submitted for approval.')
        navigate(`/partner/requests/${submitted.id}`)
        return
      }

      setNotice('Draft saved.')
    } catch (err) {
      setError(toUserMessage(err, 'Failed to save associate request.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <MobileLayout
      title={commissionId ? 'Edit Associate Request' : 'New Associate Request'}
      subtitle="Capture request details from the field"
      secondaryAction={{ label: 'Back', to: '/m/assignments' }}
    >
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}
      {notice ? <div className="m-alert m-alert-ok">{notice}</div> : null}
      {loadingDraft ? <div className="m-alert">Loading draft…</div> : null}
      {formErrors.length ? (
        <Card className="m-note-card" style={{ marginBottom: '0.9rem' }}>
          <strong>Required before submit</strong>
          <ul className="m-simple-list">
            {formErrors.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </Card>
      ) : null}

      <Section title="Request Essentials" subtitle="Core details that operations needs to start the case.">
        <Card className="m-sheet-card">
          <div className="m-form-grid">
            <label>
              <span>Service Line</span>
              <select value={form.service_line} onChange={(e) => updateField('service_line', e.target.value)}>
                <option value="">Select service line</option>
                {allowedServiceLines.map((line) => <option key={line} value={line}>{line}</option>)}
              </select>
            </label>
            <label>
              <span>Bank Name</span>
              <input value={form.bank_name} onChange={(e) => updateField('bank_name', e.target.value)} />
            </label>
            <label>
              <span>Branch Name</span>
              <input value={form.branch_name} onChange={(e) => updateField('branch_name', e.target.value)} />
            </label>
            <label>
              <span>Borrower Name</span>
              <input value={form.borrower_name} onChange={(e) => updateField('borrower_name', e.target.value)} />
            </label>
            <label>
              <span>Phone</span>
              <input value={form.phone} onChange={(e) => updateField('phone', e.target.value)} inputMode="tel" />
            </label>
            <label>
              <span>Property Type</span>
              <input value={form.property_type} onChange={(e) => updateField('property_type', e.target.value)} />
            </label>
          </div>
        </Card>
      </Section>

      <Section title="Property" subtitle="Area, address, and scheduling context.">
        <Card className="m-sheet-card">
          <div className="m-form-grid">
            <label>
              <span>Land Area</span>
              <input value={form.land_area} onChange={(e) => updateField('land_area', e.target.value)} inputMode="decimal" />
            </label>
            <label>
              <span>Built-up Area</span>
              <input value={form.builtup_area} onChange={(e) => updateField('builtup_area', e.target.value)} inputMode="decimal" />
            </label>
            <label>
              <span>Site Visit Date</span>
              <input type="date" value={form.site_visit_date} onChange={(e) => updateField('site_visit_date', e.target.value)} />
            </label>
            <label>
              <span>Report Due Date</span>
              <input type="date" value={form.report_due_date} onChange={(e) => updateField('report_due_date', e.target.value)} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>Property Address</span>
              <textarea rows={3} value={form.address} onChange={(e) => updateField('address', e.target.value)} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>Notes</span>
              <textarea rows={4} value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
            </label>
          </div>
        </Card>
      </Section>

      <Section title="Attachments" subtitle="Attach site photos or supporting documents before you submit.">
        <Card className="m-sheet-card">
          <div className="m-form-grid">
            <label>
              <span>Files</span>
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
            </label>
          </div>
          {files.length ? (
            <div style={{ marginTop: '0.75rem' }}>
              <strong style={{ display: 'block', marginBottom: '0.4rem' }}>Queued uploads</strong>
              <ul className="m-simple-list">
                {files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}
              </ul>
            </div>
          ) : (
            <p className="m-muted-note">You can save a draft without attachments and upload later.</p>
          )}
        </Card>
      </Section>

      {!profile ? (
        <MobileEmptyState title="Profile still loading" body="Service-line restrictions will appear as soon as the associate profile finishes loading." />
      ) : null}

      <StickyFooter>
        <div className="m-footer-actions">
          <button type="button" className="m-secondary-btn" onClick={() => handleSave({ submit: false })} disabled={saving}>
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button type="button" className="m-primary-btn" onClick={() => handleSave({ submit: true })} disabled={saving}>
            {saving ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </StickyFooter>
    </MobileLayout>
  )
}
