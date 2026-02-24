import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import Tabs from '../../components/ui/Tabs'
import InfoTip from '../../components/ui/InfoTip'
import {
  fetchPartnerAssignment,
  fetchPartnerCommission,
  fetchPartnerDeliverables,
  downloadPartnerDeliverable,
  fetchPartnerRequestAttachments,
  fetchPartnerRequests,
  respondPartnerRequest,
  uploadPartnerCommissionDocument,
  uploadPartnerRequestAttachment,
} from '../../api/partner'
import { formatDate, formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'documents', label: 'Documents' },
  { key: 'requests', label: 'Requests' },
  { key: 'payment', label: 'Payment' },
]

function statusTone(status) {
  if (status === 'NEEDS_INFO') return 'warn'
  if (status === 'SUBMITTED') return 'info'
  if (status === 'APPROVED' || status === 'CONVERTED') return 'ok'
  if (status === 'REJECTED') return 'danger'
  return 'muted'
}

function paymentTone(status) {
  if (status === 'VERIFIED') return 'ok'
  if (status === 'PROOF_SUBMITTED') return 'info'
  if (status === 'REQUESTED') return 'warn'
  return 'muted'
}

function nextStepText(commission, assignment) {
  if (!commission) return ''
  if (commission.status === 'DRAFT') return 'Complete the request details and submit for approval.'
  if (commission.status === 'SUBMITTED') return 'Your request is under review by the admin team.'
  if (commission.status === 'NEEDS_INFO') return 'Please respond to the requested documents or clarifications.'
  if (commission.status === 'REJECTED') return 'This request was closed. Contact the admin team if you need assistance.'
  if (commission.status === 'APPROVED' || commission.status === 'CONVERTED') {
    if (!assignment) return 'Your request is approved and has been queued for internal processing.'
    if (assignment.payment_status === 'REQUESTED') return 'Payment is required to unlock the final report.'
    if (assignment.payment_status === 'PROOF_SUBMITTED') return 'Payment proof submitted. Awaiting verification.'
    if (assignment.payment_status === 'VERIFIED') return 'Payment verified. Final deliverables are available.'
    return 'Internal team is working on the report.'
  }
  return 'Your request is being processed.'
}

export default function PartnerRequestDetail() {
  const { id } = useParams()
  const commissionId = Number(id)
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState('overview')
  const [commission, setCommission] = useState(null)
  const [assignment, setAssignment] = useState(null)
  const [requests, setRequests] = useState([])
  const [attachments, setAttachments] = useState(new Map())
  const [deliverables, setDeliverables] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [responseDrafts, setResponseDrafts] = useState({})
  const [uploadFiles, setUploadFiles] = useState([])
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const commissionData = await fetchPartnerCommission(commissionId)
        if (cancelled) return
        setCommission(commissionData)

        const assignmentData = commissionData.converted_assignment_id
          ? await fetchPartnerAssignment(commissionData.converted_assignment_id).catch(() => null)
          : null
        if (cancelled) return
        setAssignment(assignmentData)

        const requestList = await fetchPartnerRequests({
          entity_type: 'COMMISSION_REQUEST',
          entity_id: commissionId,
        }).catch(() => [])

        const assignmentRequests = assignmentData
          ? await fetchPartnerRequests({
            entity_type: 'ASSIGNMENT',
            entity_id: assignmentData.id,
          }).catch(() => [])
          : []

        if (cancelled) return
        const combined = [...requestList, ...assignmentRequests]
        setRequests(combined)

        const responseRequests = combined.filter((req) => req.direction === 'PARTNER_TO_INTERNAL')
        const attachmentEntries = await Promise.all(
          responseRequests.map(async (req) => {
            try {
              const items = await fetchPartnerRequestAttachments(req.id)
              return [req.id, items]
            } catch (err) {
              return [req.id, []]
            }
          }),
        )
        if (cancelled) return
        setAttachments(new Map(attachmentEntries))

        if (assignmentData) {
          const deliverablesData = await fetchPartnerDeliverables(assignmentData.id).catch(() => [])
          if (!cancelled) setDeliverables(deliverablesData)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load request details'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [commissionId])

  const pendingRequests = useMemo(() => (
    requests.filter((req) => req.direction === 'INTERNAL_TO_PARTNER' && req.status === 'OPEN')
  ), [requests])

  const responseUploads = useMemo(() => {
    const rows = []
    attachments.forEach((items, requestId) => {
      items.forEach((item) => rows.push({ ...item, requestId }))
    })
    return rows
  }, [attachments])

  async function handleRespond(requestId) {
    const draft = responseDrafts[requestId] || {}
    if (!draft.message && !draft.file) {
      setNotice('Please add a message or upload a file before responding.')
      return
    }
    setNotice(null)
    try {
      if (draft.file) {
        await uploadPartnerRequestAttachment(requestId, { file: draft.file, message: draft.message })
      } else {
        await respondPartnerRequest(requestId, { message: draft.message })
      }
      setResponseDrafts((prev) => ({ ...prev, [requestId]: { message: '', file: null } }))
      setNotice('Response sent.')
      const refreshed = await fetchPartnerRequests({
        entity_type: 'COMMISSION_REQUEST',
        entity_id: commissionId,
      }).catch(() => [])
      const assignmentRequests = assignment
        ? await fetchPartnerRequests({ entity_type: 'ASSIGNMENT', entity_id: assignment.id }).catch(() => [])
        : []
      setRequests([...refreshed, ...assignmentRequests])
    } catch (err) {
      console.error(err)
      setNotice(toUserMessage(err, 'Failed to respond'))
    }
  }

  async function handleUploadAdditionalDocs() {
    if (!uploadFiles.length || !commission) return
    try {
      for (const file of uploadFiles) {
        await uploadPartnerCommissionDocument(commission.id, { file })
      }
      setUploadFiles([])
      const refreshed = await fetchPartnerCommission(commission.id)
      setCommission(refreshed)
      setNotice('Documents uploaded.')
    } catch (err) {
      console.error(err)
      setNotice(toUserMessage(err, 'Failed to upload documents'))
    }
  }

  async function handleDownload(deliverable) {
    try {
      const blob = await downloadPartnerDeliverable(deliverable.id)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = deliverable.original_name || `deliverable-${deliverable.id}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      setNotice(toUserMessage(err, 'Failed to download deliverable'))
    }
  }

  const timelineItems = useMemo(() => {
    if (!commission) return []
    const items = []
    items.push({ label: 'Request created', date: commission.created_at })
    if (commission.submitted_at) items.push({ label: 'Submitted for review', date: commission.submitted_at })
    if (commission.status === 'NEEDS_INFO') items.push({ label: 'Info requested', date: commission.decided_at })
    if (commission.status === 'REJECTED') items.push({ label: 'Rejected', date: commission.decided_at })
    if (commission.status === 'APPROVED' || commission.status === 'CONVERTED') {
      items.push({ label: 'Approved & in progress', date: commission.decided_at })
    }
    if (assignment?.payment_status === 'REQUESTED') items.push({ label: 'Payment requested', date: assignment.updated_at })
    if (assignment?.payment_status === 'PROOF_SUBMITTED') items.push({ label: 'Payment proof submitted', date: assignment.updated_at })
    if (assignment?.payment_status === 'VERIFIED') items.push({ label: 'Payment verified', date: assignment.updated_at })
    return items
  }, [commission, assignment])

  const floorTotal = useMemo(() => (
    (commission?.floors || []).reduce((sum, floor) => sum + (Number(floor.area) || 0), 0)
  ), [commission])

  if (loading) return <div className="muted">Loading request…</div>
  if (error) return <div className="empty">{error}</div>
  if (!commission) return <EmptyState>Request not found.</EmptyState>

  const canEditDraft = commission.status === 'DRAFT' || commission.status === 'NEEDS_INFO'

  return (
    <div>
      <PageHeader
        title={`Request ${commission.request_code}`}
        subtitle={commission.borrower_name || commission.bank_name || 'Commission request'}
        actions={(
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {canEditDraft ? (
              <button
                type="button"
                className="secondary"
                onClick={() => navigate(`/partner/requests/new?draft=${commission.id}`)}
              >
                Edit Draft
              </button>
            ) : null}
            <Badge tone={statusTone(commission.status)}>{titleCase(commission.status)}</Badge>
          </div>
        )}
      />

      {notice ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{notice}</div> : null}

      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'overview' ? (
        <div className="grid" style={{ gap: '1rem' }}>
          <Card>
            <CardHeader title="Status" subtitle="Partner-safe timeline" />
            {timelineItems.length === 0 ? (
              <EmptyState>No timeline events yet.</EmptyState>
            ) : (
              <div className="list">
                {timelineItems.map((item, idx) => (
                  <div key={`${item.label}-${idx}`} className="list-item" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.label}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(item.date)}</div>
                    </div>
                    <Badge tone={statusTone(commission.status)}>{titleCase(commission.status)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Request Details" subtitle="Summary of what you submitted." />
            <div className="grid cols-2">
              <div>
                <div className="kicker">Borrower</div>
                <div>{commission.borrower_name || '—'}</div>
              </div>
              <div>
                <div className="kicker">Property Type</div>
                <div>{commission.property_type || '—'}</div>
              </div>
              <div>
                <div className="kicker">Service Line</div>
                <div>{commission.service_line || '—'}</div>
              </div>
              <div>
                <div className="kicker">Bank / Branch</div>
                <div>{[commission.bank_name, commission.branch_name].filter(Boolean).join(' / ') || '—'}</div>
              </div>
              <div>
                <div className="kicker">Address</div>
                <div>{commission.address || '—'}</div>
              </div>
              <div>
                <div className="kicker">Site Visit Date</div>
                <div>{formatDate(commission.site_visit_date)}</div>
              </div>
              <div>
                <div className="kicker">Report Due Date</div>
                <div>{formatDate(commission.report_due_date)}</div>
              </div>
            </div>
            {commission.floors?.length ? (
              <div style={{ marginTop: 12 }}>
                <div className="kicker">Floor Areas</div>
                <div className="list">
                  {commission.floors.map((floor) => (
                    <div key={floor.id} className="list-item" style={{ justifyContent: 'space-between' }}>
                      <div>{floor.floor_name}</div>
                      <div className="muted">{floor.area} sqft</div>
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Total built-up area: {floorTotal} sqft
                </div>
              </div>
            ) : null}
            {commission.notes ? (
              <div style={{ marginTop: 12 }}>
                <div className="kicker">Notes</div>
                <div className="muted">{commission.notes}</div>
              </div>
            ) : null}
            {commission.decision_reason ? (
              <div style={{ marginTop: 12 }}>
                <div className="kicker">Admin Note</div>
                <div className="muted">{commission.decision_reason}</div>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="What happens next" subtitle="Your next action" action={<InfoTip text="Only partner-visible steps are shown here." />} />
            <div className="muted">{nextStepText(commission, assignment)}</div>
          </Card>
        </div>
      ) : null}

      {activeTab === 'documents' ? (
        <div className="grid" style={{ gap: '1rem' }}>
          <Card>
            <CardHeader title="Documents You Uploaded" subtitle="Files attached to this request." />
            {commission.documents?.length ? (
              <div className="list">
                {commission.documents.map((doc) => (
                  <div key={doc.id} className="list-item" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{doc.original_name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{doc.category || 'General'} • {formatDateTime(doc.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>No documents uploaded yet.</EmptyState>
            )}

            <div style={{ marginTop: 12 }}>
              <input type="file" multiple onChange={(e) => setUploadFiles(Array.from(e.target.files || []))} />
              <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={handleUploadAdditionalDocs}>
                Upload Additional Docs
              </button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Requested Documents" subtitle="Respond to internal requests." />
            {pendingRequests.length === 0 ? (
              <EmptyState>No outstanding document requests.</EmptyState>
            ) : (
              <div className="list">
                {pendingRequests.map((req) => (
                  <div key={req.id} className="list-item" style={{ flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{titleCase(req.request_type)}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{req.message}</div>
                      </div>
                      <Badge tone="warn">Open</Badge>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="Add a response message"
                      value={responseDrafts[req.id]?.message || ''}
                      onChange={(e) => setResponseDrafts((prev) => ({ ...prev, [req.id]: { ...prev[req.id], message: e.target.value } }))}
                    />
                    <input
                      type="file"
                      onChange={(e) => setResponseDrafts((prev) => ({ ...prev, [req.id]: { ...prev[req.id], file: e.target.files?.[0] || null } }))}
                    />
                    <button type="button" onClick={() => handleRespond(req.id)}>Submit Response</button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Response Uploads" subtitle="Files you sent back to the team." />
            {responseUploads.length === 0 ? (
              <EmptyState>No response uploads yet.</EmptyState>
            ) : (
              <div className="list">
                {responseUploads.map((item) => (
                  <div key={item.id} className="list-item" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.original_name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(item.created_at)}</div>
                    </div>
                    <Badge tone="info">Sent</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {activeTab === 'requests' ? (
        <Card>
          <CardHeader title="Requests from Team" subtitle="Clarifications and document requests." />
          {requests.length === 0 ? (
            <EmptyState>No requests yet.</EmptyState>
          ) : (
            <div className="list">
              {requests.map((req) => (
                <div key={req.id} className="list-item" style={{ flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{titleCase(req.request_type)}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{req.message}</div>
                    </div>
                    <Badge tone={req.direction === 'INTERNAL_TO_PARTNER' ? 'warn' : 'info'}>{titleCase(req.status)}</Badge>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(req.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === 'payment' ? (
        <div className="grid" style={{ gap: '1rem' }}>
          <Card>
            <CardHeader title="Payment Status" subtitle="Invoices and verification" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="kicker">Current status</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                  {titleCase(assignment?.payment_status || 'NOT_REQUESTED')}
                </div>
              </div>
              <Badge tone={paymentTone(assignment?.payment_status || 'NOT_REQUESTED')}>
                {titleCase(assignment?.payment_status || 'NOT_REQUESTED')}
              </Badge>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {assignment?.payment_status === 'REQUESTED'
                ? 'Payment proof is required to unlock deliverables.'
                : assignment?.payment_status === 'PROOF_SUBMITTED'
                  ? 'Payment proof submitted. Awaiting verification.'
                  : assignment?.payment_status === 'VERIFIED'
                    ? 'Payment verified. You can download the final report.'
                    : 'Payment has not been requested yet.'}
            </div>
          </Card>

          <Card>
            <CardHeader title="Payment Requests" subtitle="Upload proof for open requests." />
            {pendingRequests.filter((req) => req.request_type === 'PAYMENT_REQUESTED').length === 0 ? (
              <EmptyState>No payment requests yet.</EmptyState>
            ) : (
              <div className="list">
                {pendingRequests.filter((req) => req.request_type === 'PAYMENT_REQUESTED').map((req) => (
                  <div key={req.id} className="list-item" style={{ flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>Payment Requested</div>
                        <div className="muted" style={{ fontSize: 12 }}>{req.message}</div>
                      </div>
                      <Badge tone="warn">Open</Badge>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="Add payment reference or notes"
                      value={responseDrafts[req.id]?.message || ''}
                      onChange={(e) => setResponseDrafts((prev) => ({ ...prev, [req.id]: { ...prev[req.id], message: e.target.value } }))}
                    />
                    <input
                      type="file"
                      onChange={(e) => setResponseDrafts((prev) => ({ ...prev, [req.id]: { ...prev[req.id], file: e.target.files?.[0] || null } }))}
                    />
                    <button type="button" onClick={() => handleRespond(req.id)}>Upload Payment Proof</button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Deliverables" subtitle="Unlocks after payment verification." />
            {assignment?.payment_status !== 'VERIFIED' ? (
              <div className="empty">Final deliverables unlock after payment verification.</div>
            ) : deliverables.length === 0 ? (
              <EmptyState>No deliverables released yet.</EmptyState>
            ) : (
              <div className="list">
                {deliverables.map((item) => (
                  <div key={item.id} className="list-item" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.original_name || 'Final Report'}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(item.released_at)}</div>
                    </div>
                    <button type="button" className="secondary" onClick={() => handleDownload(item)}>
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  )
}
