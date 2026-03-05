import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, KVRow, MobileEmptyState, MobileListSkeleton, Section, StickyFooter } from '../components/Primitives'
import { fetchAssignment, assignBestCandidate } from '../../api/assignments'
import { requestApproval } from '../../api/approvals'
import { formatDateTime, titleCase } from '../../utils/format'
import { useAuth } from '../../auth/AuthContext'
import { hasCapability } from '../../utils/rbac'
import { toUserMessage } from '../../api/client'

function StatusChip({ status }) {
  return <span className={`m-status ${String(status || '').toLowerCase()}`}>{titleCase(status)}</span>
}

export default function AssignmentDetailScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { capabilities } = useAuth()

  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const canAllocate = hasCapability(capabilities, 'assignment_allocate')
  const canCreateDraft = hasCapability(capabilities, 'create_assignment_draft')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await fetchAssignment(id)
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
  }, [id])

  const assignment = detail?.assignment
  const overview = useMemo(() => {
    if (!assignment) return []
    return [
      ['Code', assignment.assignment_code || `#${assignment.id}`],
      ['Case', titleCase(assignment.case_type)],
      ['Service', assignment.service_line_name || titleCase(assignment.service_line)],
      ['Customer', assignment.bank_name || assignment.valuer_client_name || assignment.borrower_name || '—'],
      ['Location', assignment.branch_name || assignment.address || '—'],
      ['Due', formatDateTime(assignment.report_due_date)],
      ['Updated', formatDateTime(assignment.updated_at)],
    ]
  }, [assignment])

  async function refresh() {
    const data = await fetchAssignment(id)
    setDetail(data)
  }

  async function handleAssignBest() {
    if (!canAllocate) return
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
    if (!assignment) return
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

  const showSubmitApproval = assignment && assignment.status !== 'DRAFT_PENDING_APPROVAL'

  return (
    <MobileLayout
      title={assignment?.assignment_code || `Assignment #${id}`}
      subtitle="Assignment Detail"
      secondaryAction={{ label: 'Back', to: '/m/assignments' }}
      primaryAction={{ label: 'Uploads', to: `/m/assignments/${id}/uploads` }}
    >
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}
      {notice ? <div className="m-alert m-alert-ok">{notice}</div> : null}

      {loading ? <MobileListSkeleton rows={4} /> : null}

      {!loading && !assignment ? (
        <MobileEmptyState title="Assignment unavailable" body="The record was not found or you do not have access." />
      ) : null}

      {assignment ? (
        <>
          <Section title="Summary" action={<StatusChip status={assignment.status} />}>
            <Card>
              {overview.map(([label, value]) => <KVRow key={label} label={label} value={value} />)}
            </Card>
          </Section>

          <Section title="Checklist" subtitle={`${detail?.missing_documents?.length || 0} missing required docs`}>
            {detail?.missing_documents?.length ? (
              <Card>
                <ul className="m-simple-list">
                  {detail.missing_documents.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </Card>
            ) : (
              <Card>
                <p>Checklist is complete for required items.</p>
              </Card>
            )}
          </Section>

          <Section title="Quick Links">
            <div className="m-inline-actions">
              <Link className="m-link-btn" to={`/m/assignments/${id}/uploads`}>Upload Documents</Link>
              <Link className="m-link-btn" to={`/m/create?assignmentId=${id}`}>Edit Draft</Link>
            </div>
          </Section>

          <StickyFooter>
            <div className="m-footer-actions">
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
            </div>
          </StickyFooter>
        </>
      ) : null}
    </MobileLayout>
  )
}
