import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, MobileEmptyState, MobileListSkeleton, Section, StickyFooter } from '../components/Primitives'
import { fetchAssignment, fetchAssignmentChecklist, fetchAssignments } from '../../api/assignments'
import { uploadDocumentWithMeta } from '../../api/documents'
import { fetchMobileAssignmentDetail, fetchMobileSummary, uploadMobileDocument } from '../../api/mobile'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { isPartner } from '../../utils/rbac'
import DemoInlineHelp from '../../demo/tutorial/DemoInlineHelp.jsx'

function slotState(category, checklist, documents) {
  const required = (checklist?.required_categories || []).includes(category)
  const uploaded = (documents || []).filter((doc) => doc.category === category)
  return { required, uploaded }
}

function normalizePartnerDetail(data) {
  if (!data) return null
  return {
    assignment: {
      id: data.overview?.id,
      assignment_code: data.overview?.assignment_code,
      valuer_client_name: data.overview?.bank_or_client,
      borrower_name: data.overview?.borrower_name,
      updated_at: data.overview?.updated_at,
      status: data.overview?.status,
      address: null,
      branch_name: null,
    },
    documents: data.documents || [],
    comments: data.comments || [],
    timeline: data.timeline || [],
  }
}

export default function UploadsScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const assignmentId = id ? Number(id) : null
  const partnerMode = isPartner(user)

  const [assignmentRows, setAssignmentRows] = useState([])
  const [detail, setDetail] = useState(null)
  const [checklist, setChecklist] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        if (!assignmentId) {
          if (partnerMode) {
            const summary = await fetchMobileSummary()
            if (!cancelled) setAssignmentRows(summary?.my_queue || [])
          } else {
            const rows = await fetchAssignments({ completion: 'OPEN', mine: true, limit: 80, sort_by: 'updated_at', sort_dir: 'desc' })
            if (!cancelled) setAssignmentRows(rows || [])
          }
          return
        }

        if (partnerMode) {
          const assignmentDetail = await fetchMobileAssignmentDetail(assignmentId)
          if (cancelled) return
          setDetail(normalizePartnerDetail(assignmentDetail))
          setChecklist(null)
          return
        }

        const [assignmentDetail, checklistData] = await Promise.all([fetchAssignment(assignmentId), fetchAssignmentChecklist(assignmentId)])

        if (cancelled) return
        setDetail(assignmentDetail)
        setChecklist(checklistData)

        const firstCategory = checklistData?.missing_required_categories?.[0]
          || checklistData?.required_categories?.[0]
          || checklistData?.optional_categories?.[0]
          || ''
        setSelectedCategory(firstCategory)
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Unable to load uploads view.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [assignmentId, partnerMode])

  const documents = detail?.documents || []
  const categories = useMemo(() => {
    const set = new Set([
      ...(checklist?.required_categories || []),
      ...(checklist?.optional_categories || []),
      ...(checklist?.present_categories || []),
    ])
    return Array.from(set)
  }, [checklist])

  const requiredCount = checklist?.required_categories?.length || 0
  const missingRequired = checklist?.missing_required_count || 0
  const completionPct = requiredCount > 0 ? Math.round(((requiredCount - missingRequired) / requiredCount) * 100) : 100

  async function refreshAssignment() {
    if (!assignmentId) return
    if (partnerMode) {
      const assignmentDetail = await fetchMobileAssignmentDetail(assignmentId)
      setDetail(normalizePartnerDetail(assignmentDetail))
      return
    }
    const [assignmentDetail, checklistData] = await Promise.all([fetchAssignment(assignmentId), fetchAssignmentChecklist(assignmentId)])
    setDetail(assignmentDetail)
    setChecklist(checklistData)
  }

  async function handleUpload(event) {
    event.preventDefault()
    if (!assignmentId || !selectedFile) return

    setUploading(true)
    setError('')
    setNotice('')
    try {
      if (partnerMode) {
        await uploadMobileDocument(assignmentId, {
          file: selectedFile,
          category: selectedCategory || undefined,
        })
      } else {
        await uploadDocumentWithMeta(assignmentId, {
          file: selectedFile,
          category: selectedCategory || undefined,
          isFinal: false,
        })
      }
      setSelectedFile(null)
      setNotice('Document uploaded.')
      await refreshAssignment()
    } catch (err) {
      setError(toUserMessage(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  if (!assignmentId) {
    const rowsWithMissing = partnerMode
      ? assignmentRows
      : assignmentRows.filter((row) => Number(row.missing_documents_count || 0) > 0)

    return (
      <MobileLayout
        title="Uploads"
        subtitle={partnerMode ? 'Files and evidence for your requests' : 'Checklist queue'}
        secondaryAction={{ label: 'Assignments', to: '/m/assignments' }}
      >
        {error ? <div className="m-alert m-alert-error">{error}</div> : null}
        {loading ? <MobileListSkeleton rows={6} /> : null}

        {!loading ? (
          <Section title={partnerMode ? 'Request Files' : 'Upload Pressure'} subtitle={partnerMode ? 'Requests waiting for documents, photos, or payment proof.' : 'Assignments still missing required evidence.'}>
            <div className="m-stat-grid">
              <Card className="m-stat-card">
                <p>{partnerMode ? 'Assignments' : 'Need Uploads'}</p>
                <strong>{rowsWithMissing.length}</strong>
                <small>{partnerMode ? 'Assignments available for document exchange.' : 'Open assignments still missing required docs.'}</small>
              </Card>
              <Card className="m-stat-card">
                <p>{partnerMode ? 'Visible Requests' : 'Open Queue'}</p>
                <strong>{assignmentRows.length}</strong>
                <small>{partnerMode ? 'Requests currently visible in your mobile workspace.' : 'Total open assignments checked in this pull.'}</small>
              </Card>
            </div>
          </Section>
        ) : null}

        {!loading && rowsWithMissing.length === 0 ? (
          <MobileEmptyState
            title={partnerMode ? 'No pending file requests' : 'No pending uploads'}
            body={partnerMode ? 'No requests currently need documents or images from you.' : 'All open assignments are currently complete.'}
            action={<Link className="m-card-link" to="/m/assignments">{partnerMode ? 'View all requests' : 'Open assignment queue'}</Link>}
          />
        ) : null}

        <div className="m-list">
          {rowsWithMissing.map((row) => (
            <button
              key={row.id}
              className="m-list-card"
              type="button"
              data-tour-route={`/m/assignments/${row.id}/uploads`}
              onClick={() => navigate(`/m/assignments/${row.id}/uploads`)}
            >
              <div className="m-list-top">
                <strong>{row.assignment_code || `#${row.id}`}</strong>
                <span className={`m-status ${partnerMode ? String(row.due_state || row.status || '').toLowerCase() : 'warn'}`}>
                  {partnerMode ? titleCase(row.status || row.due_state || 'Pending') : `${row.missing_documents_count} missing`}
                </span>
              </div>
              <p>{row.bank_or_client || row.bank_name || row.valuer_client_name || row.borrower_name || 'Unknown customer'}</p>
              <div className="m-list-keyline">
                <span>Updated {formatDateTime(row.updated_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </MobileLayout>
    )
  }

  return (
    <MobileLayout
      title={detail?.assignment?.assignment_code || `Assignment #${assignmentId}`}
      subtitle="Checklist & uploads"
      secondaryAction={{ label: 'Back', to: `/m/assignments/${assignmentId}` }}
      primaryAction={{ label: 'Assignments', to: '/m/assignments' }}
    >
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}
      {notice ? <div className="m-alert m-alert-ok">{notice}</div> : null}
      {loading ? <MobileListSkeleton rows={5} /> : null}

      {!loading && !detail ? (
        <MobileEmptyState title="Assignment unavailable" body="Unable to load upload slots." />
      ) : null}

      {detail ? (
        <>
          {partnerMode ? (
            <Section title="Request Files" subtitle="Recent uploads, comments, and request activity.">
            
              <div className="m-stat-grid">
                <Card className="m-stat-card">
                  <p>Documents</p>
                  <strong>{documents.length}</strong>
                  <small>Files already shared for this request.</small>
                </Card>
                <Card className="m-stat-card">
                  <p>Comments</p>
                  <strong>{detail.comments?.length || 0}</strong>
                  <small>Notes and clarifications already attached.</small>
                </Card>
                <Card className="m-stat-card">
                  <p>Timeline</p>
                  <strong>{detail.timeline?.length || 0}</strong>
                  <small>Recent request activity visible on mobile.</small>
                </Card>
              </div>
            </Section>
          ) : (
            <>
              <Section title="Checklist Progress" subtitle={`${completionPct}% complete`}>
                <DemoInlineHelp
                  title="Checklist progress drives readiness"
                  body="This section shows whether the request is still missing evidence or ready to move further in review."
                  whyItMatters="Uploads should be completed before downstream teams waste time chasing missing files."
                />
                <div className="m-stat-grid">
                  <Card className="m-stat-card" data-tour-id="mobile-uploads-progress">
                    <p>Completion</p>
                    <strong>{completionPct}%</strong>
                    <small>Required slot completion ratio.</small>
                  </Card>
                  <Card className="m-stat-card">
                    <p>Missing</p>
                    <strong>{missingRequired}</strong>
                    <small>Required uploads still outstanding.</small>
                  </Card>
                </div>
                <Card>
                  <div className="m-progress">
                    <div className="m-progress-bar" style={{ width: `${completionPct}%` }} />
                  </div>
                  <p className="m-muted-note">
                    Missing required: {missingRequired} / {requiredCount}
                  </p>
                </Card>
              </Section>

              <Section title="Upload Slots" subtitle="Camera-first upload actions">
                <div className="m-list">
                  {categories.map((category) => {
                    const state = slotState(category, checklist, documents)
                    const label = checklist?.category_labels?.[category] || category
                    return (
                      <div key={category} className="m-list-card m-upload-slot">
                        <div className="m-list-top">
                          <strong>{label}</strong>
                          <span className={`m-status ${state.required && !state.uploaded.length ? 'overdue' : 'ok'}`}>
                            {state.uploaded.length ? `${state.uploaded.length} uploaded` : state.required ? 'Required' : 'Optional'}
                          </span>
                        </div>
                        {state.uploaded.length ? (
                          <div className="m-upload-doc-list">
                            {state.uploaded.slice(0, 2).map((doc) => (
                              <div key={doc.id} className="m-upload-doc">
                                <div>
                                  <strong>{doc.original_name}</strong>
                                  <small>{formatDateTime(doc.created_at)}</small>
                                </div>
                                <span className={`m-status ${String(doc.review_status || '').toLowerCase()}`}>{titleCase(doc.review_status)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="m-muted-note">
                            {state.required ? 'Required evidence has not been uploaded yet.' : 'Optional slot available for supporting files.'}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Section>
            </>
          )}

          <Section title="Upload Document" subtitle={partnerMode ? 'Share evidence or supporting files from the field.' : 'Capture from camera or choose file'}>
            <form className="m-form-grid" data-tour-id="mobile-uploads-form" onSubmit={handleUpload}>
              {partnerMode ? (
                <label>
                  <span>Category</span>
                  <input
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    placeholder="Example: SITE_PHOTOS"
                  />
                </label>
              ) : (
                <label>
                  <span>Category Slot</span>
                  <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                    <option value="">Select category</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {checklist?.category_labels?.[category] || category}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span>File</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
              </label>
              <button type="submit" className="m-primary-btn" data-tour-id="mobile-uploads-submit" disabled={!selectedFile || uploading}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </form>
          </Section>

          <Section title="Recent Documents" subtitle={`${documents.length} files`}>
            <div className="m-list">
              {documents.slice(0, 12).map((doc) => (
                <Card key={doc.id} className="m-sheet-card">
                  <strong>{doc.original_name}</strong>
                  <p>{doc.category || 'Uncategorized'} · {titleCase(doc.review_status)}</p>
                  <small>{formatDateTime(doc.created_at)}</small>
                </Card>
              ))}
            </div>
          </Section>

          <StickyFooter>
            <div className="m-footer-actions">
              <Link className="m-secondary-btn m-link-as-btn" to={`/m/assignments/${assignmentId}`}>
                Back to Assignment
              </Link>
              <Link className="m-primary-btn m-link-as-btn" to="/m/assignments">
                {partnerMode ? 'All Requests' : 'Open Queue'}
              </Link>
            </div>
          </StickyFooter>
        </>
      ) : null}
    </MobileLayout>
  )
}
