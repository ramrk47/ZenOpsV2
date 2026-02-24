import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext.jsx'
import {
  createMobileComment,
  fetchMobileAssignmentDetail,
  raiseMobileRequest,
  uploadMobileDocument,
} from '../../api/mobile'
import { formatDateTime, titleCase } from '../../utils/format'
import { isPartner } from '../../utils/rbac'
import { readAssignmentSnapshot, writeAssignmentSnapshot } from '../../utils/mobileSnapshots'

function OfflineBanner({ usingCache, offline }) {
  if (!usingCache && !offline) return null
  return (
    <div className="mobile-banner" role="status">
      {offline
        ? 'Offline mode: showing last cached assignment snapshot.'
        : 'Using cached assignment snapshot due to network issue.'}
    </div>
  )
}

function formatFileSize(size) {
  const bytes = Number(size || 0)
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function MobileAssignmentDetail() {
  const { id } = useParams()
  const assignmentId = Number(id)
  const navigate = useNavigate()
  const { user } = useAuth()
  const partnerMode = isPartner(user)

  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [usingCache, setUsingCache] = useState(false)
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false)

  const [selectedFile, setSelectedFile] = useState(null)
  const [uploadCategory, setUploadCategory] = useState('')
  const [uploading, setUploading] = useState(false)

  const [commentText, setCommentText] = useState('')
  const [commentLane, setCommentLane] = useState(partnerMode ? 'EXTERNAL' : 'INTERNAL')
  const [visibleToClient, setVisibleToClient] = useState(false)
  const [selectedDocumentId, setSelectedDocumentId] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)

  const [requestSubject, setRequestSubject] = useState('')
  const [requestPriority, setRequestPriority] = useState('MEDIUM')
  const [requestMessage, setRequestMessage] = useState('')
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [requestResult, setRequestResult] = useState('')

  const loadDetail = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    setError('')

    try {
      const data = await fetchMobileAssignmentDetail(assignmentId)
      setDetail(data)
      setUsingCache(false)
      writeAssignmentSnapshot(assignmentId, data)
    } catch (err) {
      const cached = readAssignmentSnapshot(assignmentId)
      if (cached) {
        setDetail(cached)
        setUsingCache(true)
      } else {
        setError(err?.response?.data?.detail || 'Unable to load assignment details right now.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [assignmentId])

  useEffect(() => {
    if (!Number.isFinite(assignmentId)) {
      setError('Invalid assignment id')
      setLoading(false)
      return
    }
    loadDetail()
  }, [assignmentId, loadDetail])

  useEffect(() => {
    function onOnline() {
      setOffline(false)
      loadDetail({ silent: true })
    }
    function onOffline() {
      setOffline(true)
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [loadDetail])

  const documents = detail?.documents || []
  const comments = detail?.comments || []
  const timeline = detail?.timeline || []

  useEffect(() => {
    if (!selectedDocumentId && documents.length) {
      setSelectedDocumentId(String(documents[0].id))
    }
  }, [documents, selectedDocumentId])

  const canUpload = detail?.can_upload !== false
  const canComment = detail?.can_comment !== false
  const canRaiseRequest = detail?.can_raise_request !== false

  const timelinePreview = useMemo(() => timeline.slice(0, 10), [timeline])
  const commentsPreview = useMemo(() => comments.slice(0, 10), [comments])

  async function handleUpload(event) {
    event.preventDefault()
    if (!selectedFile || !canUpload) return

    setUploading(true)
    try {
      await uploadMobileDocument(assignmentId, {
        file: selectedFile,
        category: uploadCategory.trim(),
      })
      setSelectedFile(null)
      setUploadCategory('')
      await loadDetail({ silent: true })
    } catch (err) {
      setError(err?.response?.data?.detail || 'Document upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault()
    if (!commentText.trim() || !canComment) return

    setSubmittingComment(true)
    setError('')
    try {
      await createMobileComment(assignmentId, {
        document_id: selectedDocumentId ? Number(selectedDocumentId) : null,
        content: commentText.trim(),
        lane: partnerMode ? 'EXTERNAL' : commentLane,
        is_visible_to_client: partnerMode ? true : visibleToClient,
      })
      setCommentText('')
      await loadDetail({ silent: true })
    } catch (err) {
      setError(err?.response?.data?.detail || 'Unable to add comment')
    } finally {
      setSubmittingComment(false)
    }
  }

  async function handleRaiseRequest(event) {
    event.preventDefault()
    if (!requestMessage.trim() || !canRaiseRequest) return

    setSubmittingRequest(true)
    setRequestResult('')
    setError('')
    try {
      const result = await raiseMobileRequest(assignmentId, {
        subject: requestSubject.trim() || undefined,
        message: requestMessage.trim(),
        priority: requestPriority,
      })
      setRequestResult(`Created ${titleCase(result.kind)} #${result.id} (${titleCase(result.status)})`)
      setRequestSubject('')
      setRequestMessage('')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Unable to raise request')
    } finally {
      setSubmittingRequest(false)
    }
  }

  return (
    <div className="mobile-shell">
      <header className="mobile-header mobile-header-compact">
        <div>
          <p className="mobile-kicker">Assignment</p>
          <h1>{detail?.overview?.assignment_code || `#${assignmentId}`}</h1>
        </div>
        <button type="button" className="mobile-ghost-btn" onClick={() => navigate('/m')}>Back</button>
      </header>

      <OfflineBanner usingCache={usingCache} offline={offline} />
      {error ? <div className="mobile-error">{error}</div> : null}

      {loading && !detail ? <p className="mobile-muted">Loading assignment…</p> : null}

      {detail ? (
        <>
          <section className="mobile-panel">
            <div className="mobile-panel-head">
              <h2>Overview</h2>
              <span>{titleCase(detail.overview.status)}</span>
            </div>
            <div className="mobile-overview-grid">
              <div>
                <small>Client/Bank</small>
                <p>{detail.overview.bank_or_client || detail.overview.borrower_name || '—'}</p>
              </div>
              <div>
                <small>Due</small>
                <p>{formatDateTime(detail.overview.due_time)}</p>
              </div>
              <div>
                <small>Updated</small>
                <p>{formatDateTime(detail.overview.updated_at)}</p>
              </div>
              <div>
                <small>Next Action</small>
                <p>{detail.overview.next_action}</p>
              </div>
            </div>
            <div className="mobile-badge-row">
              {(detail.overview.badges || []).map((badge) => (
                <span key={badge} className={`mobile-badge mobile-badge-${badge.toLowerCase()}`}>{badge}</span>
              ))}
            </div>
          </section>

          <section className="mobile-panel">
            <div className="mobile-panel-head">
              <h2>Latest Timeline</h2>
              <span>{timelinePreview.length}</span>
            </div>
            {!timelinePreview.length ? <p className="mobile-muted">No timeline entries.</p> : null}
            <div className="mobile-list">
              {timelinePreview.map((entry) => (
                <article className="mobile-list-item" key={entry.id}>
                  <strong>{titleCase(entry.event_type)}</strong>
                  <p>{entry.message}</p>
                  <small>{entry.actor_label || 'System'} · {formatDateTime(entry.created_at)}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="mobile-panel">
            <div className="mobile-panel-head">
              <h2>Documents</h2>
              <span>{documents.length}</span>
            </div>
            {!documents.length ? <p className="mobile-muted">No documents uploaded yet.</p> : null}
            <div className="mobile-list">
              {documents.map((doc) => (
                <article className="mobile-list-item" key={doc.id}>
                  <strong>{doc.original_name}</strong>
                  <p>{doc.category || 'Uncategorized'} · {titleCase(doc.review_status)}</p>
                  <small>
                    {formatFileSize(doc.size)} · {formatDateTime(doc.created_at)} · {doc.comments_count} comments
                  </small>
                </article>
              ))}
            </div>

            <form className="mobile-form" onSubmit={handleUpload}>
              <h3>Upload Document</h3>
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                disabled={!canUpload || uploading}
              />
              <input
                type="text"
                placeholder="Category (optional)"
                value={uploadCategory}
                onChange={(event) => setUploadCategory(event.target.value)}
                disabled={!canUpload || uploading}
              />
              <button type="submit" disabled={!selectedFile || !canUpload || uploading}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </form>
          </section>

          <section className="mobile-panel">
            <div className="mobile-panel-head">
              <h2>Comments</h2>
              <span>{comments.length}</span>
            </div>
            {!commentsPreview.length ? <p className="mobile-muted">No comments yet.</p> : null}
            <div className="mobile-list">
              {commentsPreview.map((comment) => (
                <article className="mobile-list-item" key={comment.id}>
                  <strong>{comment.author_label}</strong>
                  <p>{comment.content}</p>
                  <small>{titleCase(comment.lane)} · {formatDateTime(comment.created_at)}</small>
                </article>
              ))}
            </div>

            <form className="mobile-form" onSubmit={handleCommentSubmit}>
              <h3>Add Comment</h3>
              <select
                value={selectedDocumentId}
                onChange={(event) => setSelectedDocumentId(event.target.value)}
                disabled={!documents.length || !canComment || submittingComment}
              >
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>{doc.original_name}</option>
                ))}
              </select>

              {!partnerMode ? (
                <select
                  value={commentLane}
                  onChange={(event) => setCommentLane(event.target.value)}
                  disabled={!canComment || submittingComment}
                >
                  <option value="INTERNAL">Internal</option>
                  <option value="EXTERNAL">External</option>
                </select>
              ) : null}

              {!partnerMode && commentLane === 'EXTERNAL' ? (
                <label className="mobile-checkbox">
                  <input
                    type="checkbox"
                    checked={visibleToClient}
                    onChange={(event) => setVisibleToClient(event.target.checked)}
                    disabled={!canComment || submittingComment}
                  />
                  Visible to client/partner
                </label>
              ) : null}

              <textarea
                rows={3}
                placeholder="Type your comment"
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                disabled={!canComment || submittingComment}
              />
              <button type="submit" disabled={!commentText.trim() || !canComment || submittingComment}>
                {submittingComment ? 'Posting…' : 'Post Comment'}
              </button>
            </form>
          </section>

          <section className="mobile-panel">
            <div className="mobile-panel-head">
              <h2>Raise Request</h2>
              <span>{canRaiseRequest ? 'Enabled' : 'Disabled'}</span>
            </div>
            <form className="mobile-form" onSubmit={handleRaiseRequest}>
              {!partnerMode ? (
                <input
                  type="text"
                  placeholder="Subject (optional)"
                  value={requestSubject}
                  onChange={(event) => setRequestSubject(event.target.value)}
                  disabled={!canRaiseRequest || submittingRequest}
                />
              ) : null}

              <select
                value={requestPriority}
                onChange={(event) => setRequestPriority(event.target.value)}
                disabled={!canRaiseRequest || submittingRequest}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>

              <textarea
                rows={3}
                placeholder="Describe what you need"
                value={requestMessage}
                onChange={(event) => setRequestMessage(event.target.value)}
                disabled={!canRaiseRequest || submittingRequest}
              />

              <button type="submit" disabled={!requestMessage.trim() || !canRaiseRequest || submittingRequest}>
                {submittingRequest ? 'Submitting…' : 'Raise Request'}
              </button>
              {requestResult ? <p className="mobile-success">{requestResult}</p> : null}
            </form>
          </section>
        </>
      ) : (
        !loading && (
          <section className="mobile-panel">
            <h2>Assignment unavailable</h2>
            <p className="mobile-muted">Try again when your connection is restored.</p>
            <Link className="mobile-link" to="/m">Back to Mobile Cockpit</Link>
          </section>
        )
      )}
    </div>
  )
}
