import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, MobileEmptyState, MobileListSkeleton, Section, StickyFooter } from '../components/Primitives'
import { fetchAssignment, fetchAssignmentChecklist, fetchAssignments } from '../../api/assignments'
import { uploadDocumentWithMeta } from '../../api/documents'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

function slotState(category, checklist, documents) {
  const required = (checklist?.required_categories || []).includes(category)
  const uploaded = (documents || []).filter((doc) => doc.category === category)
  return { required, uploaded }
}

export default function UploadsScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const assignmentId = id ? Number(id) : null

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
          const rows = await fetchAssignments({ completion: 'OPEN', mine: true, limit: 80, sort_by: 'updated_at', sort_dir: 'desc' })
          if (!cancelled) setAssignmentRows(rows || [])
          return
        }

        const [assignmentDetail, checklistData] = await Promise.all([
          fetchAssignment(assignmentId),
          fetchAssignmentChecklist(assignmentId),
        ])

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
  }, [assignmentId])

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
    const [assignmentDetail, checklistData] = await Promise.all([
      fetchAssignment(assignmentId),
      fetchAssignmentChecklist(assignmentId),
    ])
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
      await uploadDocumentWithMeta(assignmentId, {
        file: selectedFile,
        category: selectedCategory || undefined,
        isFinal: false,
      })
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
    const rowsWithMissing = assignmentRows.filter((row) => Number(row.missing_documents_count || 0) > 0)

    return (
      <MobileLayout
        title="Uploads"
        subtitle="Checklist queue"
        secondaryAction={{ label: 'Assignments', to: '/m/assignments' }}
      >
        {error ? <div className="m-alert m-alert-error">{error}</div> : null}
        {loading ? <MobileListSkeleton rows={6} /> : null}

        {!loading && rowsWithMissing.length === 0 ? (
          <MobileEmptyState title="No pending uploads" body="All open assignments are currently complete." />
        ) : null}

        <div className="m-list">
          {rowsWithMissing.map((row) => (
            <button
              key={row.id}
              className="m-list-card"
              type="button"
              onClick={() => navigate(`/m/assignments/${row.id}/uploads`)}
            >
              <div className="m-list-top">
                <strong>{row.assignment_code || `#${row.id}`}</strong>
                <span className="m-status warn">{row.missing_documents_count} missing</span>
              </div>
              <p>{row.bank_name || row.valuer_client_name || row.borrower_name || 'Unknown customer'}</p>
              <small>Updated {formatDateTime(row.updated_at)}</small>
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
          <Section title="Checklist Progress" subtitle={`${completionPct}% complete`}>
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
                  <div key={category} className="m-list-card">
                    <div className="m-list-top">
                      <strong>{label}</strong>
                      <span className={`m-status ${state.required && !state.uploaded.length ? 'overdue' : 'ok'}`}>
                        {state.uploaded.length ? `${state.uploaded.length} uploaded` : state.required ? 'Required' : 'Optional'}
                      </span>
                    </div>
                    {state.uploaded.length ? (
                      <ul className="m-simple-list">
                        {state.uploaded.slice(0, 2).map((doc) => (
                          <li key={doc.id}>{doc.original_name} · {titleCase(doc.review_status)}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Section>

          <Section title="Upload Document" subtitle="Capture from camera or choose file">
            <form className="m-form-grid" onSubmit={handleUpload}>
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
              <label>
                <span>File</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
              </label>
              <button type="submit" className="m-primary-btn" disabled={!selectedFile || uploading}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </form>
          </Section>

          <Section title="Recent Documents" subtitle={`${documents.length} files`}>
            <div className="m-list">
              {documents.slice(0, 12).map((doc) => (
                <Card key={doc.id}>
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
                Open Queue
              </Link>
            </div>
          </StickyFooter>
        </>
      ) : null}
    </MobileLayout>
  )
}
