import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import {
  Card,
  KVRow,
  MobileEmptyState,
  MobileListSkeleton,
  Section,
  StickyFooter,
} from '../components/Primitives'
import MobileDocumentPreviewSheet from '../components/MobileDocumentPreviewSheet'
import { assignBestCandidate, fetchAssignment } from '../../api/assignments'
import { requestApproval } from '../../api/approvals'
import { documentDownloadUrl, documentPreviewUrl } from '../../api/documents'
import { createMessage } from '../../api/messages'
import {
  createMobileComment,
  fetchMobileAssignmentDetail,
  mobileDocumentDownloadUrl,
  mobileDocumentPreviewUrl,
  raiseMobileRequest,
} from '../../api/mobile'
import { formatDateTime, titleCase } from '../../utils/format'
import { useAuth } from '../../auth/AuthContext'
import { hasCapability, isPartner } from '../../utils/rbac'
import { toUserMessage } from '../../api/client'
import DemoInlineHelp from '../../demo/tutorial/DemoInlineHelp.jsx'

function StatusChip({ status }) {
  return <span className={`m-status ${String(status || '').toLowerCase()}`}>{titleCase(status)}</span>
}

function normalizePartnerNextAction(raw) {
  const value = String(raw || '').trim()
  if (!value) return 'Continue request'

  const normalized = value.toLowerCase()
  if (normalized.includes('workflow') || normalized.includes('queue')) return 'Continue request'
  if (normalized.includes('approval') || normalized.includes('review')) return 'Awaiting review'
  if (normalized.includes('upload') || normalized.includes('document') || normalized.includes('docs')) return 'Share requested files'
  if (normalized.includes('payment')) return 'Follow up on payment'
  if (normalized.includes('due-soon') || normalized.includes('due soon')) return 'Review upcoming deadlines'
  if (normalized.includes('overdue')) return 'Review overdue items'
  return value
}

function PreviewableDocCard({ document, onPreview }) {
  return (
    <Card className="m-sheet-card">
      <div className="m-list-top">
        <strong>{document.original_name}</strong>
        <span className={`m-status ${String(document.review_status || '').toLowerCase()}`}>
          {titleCase(document.review_status || 'received')}
        </span>
      </div>
      <p>{document.category || 'Uncategorized'}</p>
      <div className="m-list-keyline">
        <span>{formatDateTime(document.created_at)}</span>
        <span>{Number(document.comments_count || 0)} comments</span>
      </div>
      <div className="m-inline-actions">
        <button type="button" className="m-link-btn" onClick={() => onPreview(document)}>
          Preview
        </button>
      </div>
    </Card>
  )
}

export default function AssignmentDetailScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, capabilities } = useAuth()

  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [selectedDocumentId, setSelectedDocumentId] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [requestSubject, setRequestSubject] = useState('')
  const [requestPriority, setRequestPriority] = useState('MEDIUM')
  const [requestMessage, setRequestMessage] = useState('')
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [previewDocument, setPreviewDocument] = useState(null)

  const partnerMode = isPartner(user)
  const canAllocate = hasCapability(capabilities, 'assignment_allocate')
  const canCreateDraft = hasCapability(capabilities, 'create_assignment_draft')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = partnerMode
          ? await fetchMobileAssignmentDetail(id)
          : await fetchAssignment(id)
        if (!cancelled) setDetail(data)
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Unable to load assignment details.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id, partnerMode])

  const assignment = partnerMode ? detail?.overview : detail?.assignment
  const documents = detail?.documents || []
  const timeline = detail?.timeline || []
  const messages = partnerMode ? [] : (detail?.messages || [])
  const comments = partnerMode ? (detail?.comments || []) : []
  const partnerNextAction = partnerMode ? normalizePartnerNextAction(assignment?.next_action) : ''

  useEffect(() => {
    if (!selectedDocumentId && documents.length) {
      setSelectedDocumentId(String(documents[0].id))
    }
  }, [documents, selectedDocumentId])

  const overview = useMemo(() => {
    if (!assignment) return []
    if (partnerMode) {
      return [
        ['Code', assignment.assignment_code || `#${assignment.id}`],
        ['Status', titleCase(assignment.status)],
        ['Customer', assignment.bank_or_client || assignment.borrower_name || '—'],
        ['Due', formatDateTime(assignment.due_time)],
        ['Updated', formatDateTime(assignment.updated_at)],
        ['Next Action', partnerNextAction || 'Continue request'],
      ]
    }

    return [
      ['Code', assignment.assignment_code || `#${assignment.id}`],
      ['Case', titleCase(assignment.case_type)],
      ['Service', assignment.service_line_name || titleCase(assignment.service_line)],
      ['Customer', assignment.bank_name || assignment.valuer_client_name || assignment.borrower_name || '—'],
      ['Location', assignment.branch_name || assignment.address || '—'],
      ['Due', formatDateTime(assignment.report_due_date)],
      ['Updated', formatDateTime(assignment.updated_at)],
    ]
  }, [assignment, partnerMode, partnerNextAction])

  async function refresh() {
    const data = partnerMode
      ? await fetchMobileAssignmentDetail(id)
      : await fetchAssignment(id)
    setDetail(data)
  }

  async function handleAssignBest() {
    if (!canAllocate || partnerMode) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await assignBestCandidate(id)
      setNotice(`Assigned to ${response?.assigned_to_user_name || 'best candidate'}.`)
      await refresh()
    } catch (err) {
      setError(toUserMessage(err, 'Failed to assign best candidate.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmitForApproval() {
    if (!assignment || partnerMode) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await requestApproval({
        approval_type: 'DRAFT_ASSIGNMENT',
        entity_type: 'ASSIGNMENT',
        entity_id: assignment.id,
        action_type: 'FINAL_REVIEW',
        reason: 'Draft submitted from mobile workflow',
        assignment_id: assignment.id,
      })
      setNotice('Draft submitted for approval.')
      await refresh()
    } catch (err) {
      setError(toUserMessage(err, 'Unable to submit draft for approval.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleSendMessage(event) {
    event.preventDefault()
    if (!assignment || partnerMode) return
    const trimmed = messageText.trim()
    if (!trimmed) return

    setSendingMessage(true)
    setError('')
    setNotice('')
    try {
      await createMessage(assignment.id, { message: trimmed, mentions: [] })
      setMessageText('')
      setNotice('Message sent.')
      await refresh()
    } catch (err) {
      setError(toUserMessage(err, 'Failed to send message.'))
    } finally {
      setSendingMessage(false)
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault()
    if (!partnerMode || !assignment) return
    const trimmed = commentText.trim()
    if (!trimmed) return

    setSubmittingComment(true)
    setError('')
    setNotice('')
    try {
      await createMobileComment(assignment.id, {
        document_id: selectedDocumentId ? Number(selectedDocumentId) : null,
        content: trimmed,
        lane: 'EXTERNAL',
        is_visible_to_client: true,
      })
      setCommentText('')
      setNotice('Comment posted.')
      await refresh()
    } catch (err) {
      setError(toUserMessage(err, 'Unable to post comment.'))
    } finally {
      setSubmittingComment(false)
    }
  }

  async function handleRaiseRequest(event) {
    event.preventDefault()
    if (!partnerMode || !assignment) return
    const trimmed = requestMessage.trim()
    if (!trimmed) return

    setSubmittingRequest(true)
    setError('')
    setNotice('')
    try {
      const result = await raiseMobileRequest(assignment.id, {
        subject: requestSubject.trim() || undefined,
        message: trimmed,
        priority: requestPriority,
      })
      setNotice(`Created ${titleCase(result.kind)} #${result.id}.`)
      setRequestSubject('')
      setRequestMessage('')
      await refresh()
    } catch (err) {
      setError(toUserMessage(err, 'Unable to raise request.'))
    } finally {
      setSubmittingRequest(false)
    }
  }

  function resolvePreviewUrl(document) {
    if (!document || !assignment) return ''
    return partnerMode
      ? mobileDocumentPreviewUrl(assignment.id, document.id)
      : documentPreviewUrl(assignment.id, document.id)
  }

  function resolveDownloadUrl(document) {
    if (!document || !assignment) return ''
    return partnerMode
      ? mobileDocumentDownloadUrl(assignment.id, document.id)
      : documentDownloadUrl(assignment.id, document.id)
  }

  const showSubmitApproval = !partnerMode && assignment && assignment.status !== 'DRAFT_PENDING_APPROVAL'

  return (
    <MobileLayout
      title={assignment?.assignment_code || `Assignment #${id}`}
      subtitle={partnerMode ? 'Request details, files, and communication' : 'Operational detail'}
      secondaryAction={{ label: 'Back', to: '/m/assignments' }}
      primaryAction={{ label: 'Uploads', to: `/m/assignments/${id}/uploads` }}
    >
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}
      {notice ? <div className="m-alert m-alert-ok">{notice}</div> : null}

      {loading ? <MobileListSkeleton rows={5} /> : null}

      {!loading && !assignment ? (
        <MobileEmptyState title="Assignment unavailable" body="The record was not found or you do not have access." />
      ) : null}

      {assignment ? (
        <>
          <Section title="Summary" subtitle={partnerMode ? 'Request status, due date, and next step.' : 'Current operational state and routing context.'}>
            <Card className="m-detail-hero" data-tour-id="mobile-assignment-summary">
              <div className="m-detail-hero-head">
                <div className="m-detail-hero-copy">
                  <p>{partnerMode ? (assignment.bank_or_client || assignment.borrower_name || 'Assignment') : (assignment.service_line_name || titleCase(assignment.service_line))}</p>
                  <h3>{assignment.assignment_code || `Assignment #${assignment.id}`}</h3>
                </div>
                <div data-tour-id="mobile-assignment-status">
                  <StatusChip status={assignment.status} />
                </div>
              </div>
              <div className="m-detail-hero-meta">
                <span>{partnerMode ? (partnerNextAction || 'Continue request') : (assignment.bank_name || assignment.valuer_client_name || assignment.borrower_name || 'Unknown customer')}</span>
                <span>{partnerMode ? `Due ${formatDateTime(assignment.due_time)}` : (assignment.branch_name || assignment.address || 'Location not yet specified')}</span>
              </div>
            </Card>
            <Card style={{ marginTop: '0.7rem' }}>
              {overview.map(([label, value]) => <KVRow key={label} label={label} value={value} />)}
            </Card>
          </Section>

          <Section title="Documents" subtitle={`${documents.length} files ready for mobile inspection.`}>
            <DemoInlineHelp
              title="Status only matters when the evidence is visible"
              body="Use the request detail to inspect the current state, the uploaded files, and the communication history in one place."
              whyItMatters="This is where users stop guessing and start understanding what is actually blocking or moving the case."
            />
            {!documents.length ? (
              <Card className="m-note-card">
                <p>No documents uploaded yet.</p>
              </Card>
            ) : (
              <div className="m-list" data-tour-id="mobile-assignment-documents">
                {documents.map((document) => (
                  <PreviewableDocCard key={document.id} document={document} onPreview={setPreviewDocument} />
                ))}
              </div>
            )}
          </Section>

          {partnerMode ? (
            <>
              <Section title="Communication" subtitle={`${comments.length} comments and clarifications visible on mobile.`}>
                {!comments.length ? (
                  <Card className="m-note-card">
                    <p>No comments yet.</p>
                  </Card>
                ) : (
                  <div className="m-list">
                    {comments.map((comment) => (
                      <Card key={comment.id} className="m-sheet-card">
                        <div className="m-list-top">
                          <strong>{comment.author_label}</strong>
                          <span className={`m-status ${String(comment.lane || '').toLowerCase()}`}>{titleCase(comment.lane)}</span>
                        </div>
                        <p>{comment.content}</p>
                        <div className="m-list-keyline">
                          <span>{formatDateTime(comment.created_at)}</span>
                          <span>{comment.is_resolved ? 'Resolved' : 'Open'}</span>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                <Card className="m-sheet-card">
                  <form className="m-form-grid" onSubmit={handleCommentSubmit}>
                    <label>
                      <span>Document</span>
                      <select
                        value={selectedDocumentId}
                        onChange={(e) => setSelectedDocumentId(e.target.value)}
                        disabled={!documents.length || submittingComment}
                      >
                        {documents.length ? null : <option value="">Upload a document first</option>}
                        {documents.map((document) => (
                          <option key={document.id} value={document.id}>{document.original_name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Comment</span>
                      <textarea
                        rows={4}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Share context, ask for clarification, or confirm delivery."
                        disabled={!documents.length || submittingComment}
                      />
                    </label>
                    <button type="submit" className="m-primary-btn" disabled={!documents.length || !commentText.trim() || submittingComment}>
                      {submittingComment ? 'Posting…' : 'Post Comment'}
                    </button>
                  </form>
                </Card>
              </Section>

              <Section title="Need Help?" subtitle="Send a clarification or support request without leaving mobile.">
                <Card className="m-sheet-card">
                  <form className="m-form-grid" onSubmit={handleRaiseRequest}>
                    <label>
                      <span>Subject</span>
                      <input
                        value={requestSubject}
                        onChange={(e) => setRequestSubject(e.target.value)}
                        placeholder="Optional subject"
                        disabled={submittingRequest}
                      />
                    </label>
                    <label>
                      <span>Priority</span>
                      <select value={requestPriority} onChange={(e) => setRequestPriority(e.target.value)} disabled={submittingRequest}>
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="URGENT">Urgent</option>
                      </select>
                    </label>
                    <label>
                      <span>Request</span>
                      <textarea
                        rows={4}
                        value={requestMessage}
                        onChange={(e) => setRequestMessage(e.target.value)}
                        placeholder="Describe the document, clarification, or support you need."
                        disabled={submittingRequest}
                      />
                    </label>
                    <button type="submit" className="m-primary-btn" disabled={!requestMessage.trim() || submittingRequest}>
                      {submittingRequest ? 'Submitting…' : 'Raise Request'}
                    </button>
                  </form>
                </Card>
              </Section>
            </>
          ) : (
            <>
              <Section title="Checklist" subtitle={`${detail?.missing_documents?.length || 0} missing required docs`}>
                {detail?.missing_documents?.length ? (
                  <Card className="m-note-card">
                    <ul className="m-simple-list">
                      {detail.missing_documents.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </Card>
                ) : (
                  <Card className="m-note-card">
                    <p>Checklist is complete for required items.</p>
                  </Card>
                )}
              </Section>

              <Section title="Chat" subtitle={`${messages.length} messages attached to this assignment.`}>
                {!messages.length ? (
                  <Card className="m-note-card">
                    <p>No messages yet.</p>
                  </Card>
                ) : (
                  <div className="m-list">
                    {messages.map((message) => (
                      <Card key={message.id} className="m-sheet-card">
                        <div className="m-list-top">
                          <strong>{message.sender_user_id === user?.id ? 'You' : `User #${message.sender_user_id || 'System'}`}</strong>
                          {message.pinned ? <span className="m-status info">Pinned</span> : null}
                        </div>
                        <p>{message.message}</p>
                        <div className="m-list-keyline">
                          <span>{formatDateTime(message.created_at)}</span>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                <Card className="m-sheet-card" data-tour-id="mobile-assignment-messages">
                  <form className="m-form-grid" onSubmit={handleSendMessage}>
                    <label>
                      <span>Message</span>
                      <textarea
                        rows={4}
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder="Share a workflow update, blocker, or handoff."
                        disabled={sendingMessage}
                      />
                    </label>
                    <div className="m-inline-actions">
                      <button type="button" className="m-link-btn" onClick={() => setMessageText('Please upload the missing documents so the workflow can proceed.')}>
                        Missing Docs
                      </button>
                      <button type="button" className="m-link-btn" onClick={() => setMessageText('Site visit completed. Uploading photos and notes shortly.')}>
                        Site Visit Done
                      </button>
                      <button type="button" className="m-link-btn" onClick={() => setMessageText('Draft report is ready for review.')}>
                        Draft Ready
                      </button>
                    </div>
                    <button type="submit" className="m-primary-btn" disabled={!messageText.trim() || sendingMessage}>
                      {sendingMessage ? 'Sending…' : 'Send Message'}
                    </button>
                  </form>
                </Card>
              </Section>
            </>
          )}

          <Section title="Timeline" subtitle={`${timeline.length} recent events`}>
            {!timeline.length ? (
              <Card className="m-note-card">
                <p>No timeline events yet.</p>
              </Card>
            ) : (
              <div className="m-list">
                {timeline.map((entry) => (
                  <Card key={entry.id} className="m-sheet-card">
                    <div className="m-list-top">
                      <strong>{titleCase(entry.event_type)}</strong>
                      <span className="m-status info">{entry.actor_label || 'System'}</span>
                    </div>
                    <p>{entry.message}</p>
                    <div className="m-list-keyline">
                      <span>{formatDateTime(entry.created_at)}</span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <Section title="Quick Links" subtitle={partnerMode ? 'Common next steps for this request.' : 'Fast next moves for the assignment owner.'}>
            <div className="m-inline-actions">
              <Link className="m-link-btn" to={`/m/assignments/${id}/uploads`}>Upload Documents</Link>
              {!partnerMode ? <Link className="m-link-btn" to={`/m/create?assignmentId=${id}`}>Edit Draft</Link> : null}
            </div>
          </Section>

          <StickyFooter>
            <div className="m-footer-actions">
              {partnerMode ? (
                <>
                  <Link className="m-secondary-btn m-link-as-btn" to={`/m/assignments/${id}/uploads`}>
                    Open Uploads
                  </Link>
                  <Link className="m-primary-btn m-link-as-btn" to="/m/assignments">
                    All Requests
                  </Link>
                </>
              ) : (
                <>
                  {canCreateDraft ? (
                    <button type="button" className="m-primary-btn" onClick={() => navigate(`/m/create?assignmentId=${id}`)}>
                      Continue Draft
                    </button>
                  ) : null}
                  {showSubmitApproval ? (
                    <button type="button" className="m-secondary-btn" onClick={handleSubmitForApproval} disabled={busy}>
                      Submit for Approval
                    </button>
                  ) : null}
                  {canAllocate ? (
                    <button type="button" className="m-secondary-btn" onClick={handleAssignBest} disabled={busy}>
                      Assign to Best
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </StickyFooter>
        </>
      ) : null}

      <MobileDocumentPreviewSheet
        open={Boolean(previewDocument)}
        document={previewDocument}
        previewUrl={resolvePreviewUrl(previewDocument)}
        downloadUrl={resolveDownloadUrl(previewDocument)}
        onClose={() => setPreviewDocument(null)}
      />
    </MobileLayout>
  )
}
