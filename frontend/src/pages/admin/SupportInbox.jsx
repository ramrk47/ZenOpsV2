import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import Drawer from '../../components/ui/Drawer'
import { fetchSupportThreads, fetchSupportThread, createSupportMessage, resolveSupportThread, closeSupportThread, updateSupportThread } from '../../api/support'
import { formatDateTime } from '../../utils/format'
import { toUserMessage } from '../../api/client'

function statusTone(status) {
  if (status === 'OPEN') return 'info'
  if (status === 'PENDING') return 'warn'
  if (status === 'RESOLVED') return 'ok'
  if (status === 'CLOSED') return 'muted'
  return 'muted'
}

function priorityTone(priority) {
  if (priority === 'HIGH') return 'danger'
  if (priority === 'MEDIUM') return 'warn'
  return 'muted'
}

export default function SupportInbox() {
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterStatus, setFilterStatus] = useState('OPEN')
  const [selectedThread, setSelectedThread] = useState(null)
  const [threadDetail, setThreadDetail] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadThreads()
  }, [filterStatus])

  async function loadThreads() {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (filterStatus !== 'ALL') {
        params.status = filterStatus
      }
      const data = await fetchSupportThreads(params)
      setThreads(data)
    } catch (err) {
      console.error('Failed to load support threads:', err)
      setError(toUserMessage(err, 'Failed to load support threads'))
    } finally {
      setLoading(false)
    }
  }

  async function openThread(thread) {
    setSelectedThread(thread)
    try {
      const detail = await fetchSupportThread(thread.id)
      setThreadDetail(detail)
    } catch (err) {
      console.error('Failed to load thread detail:', err)
      setError(toUserMessage(err, 'Failed to load thread details'))
    }
  }

  function closeThreadDetail() {
    setSelectedThread(null)
    setThreadDetail(null)
    setReplyText('')
  }

  async function handleReply(e) {
    e.preventDefault()
    if (!replyText.trim()) return

    setSubmitting(true)
    try {
      await createSupportMessage(selectedThread.id, {
        message_text: replyText,
      })
      setReplyText('')
      // Reload thread detail
      const detail = await fetchSupportThread(selectedThread.id)
      setThreadDetail(detail)
      // Reload thread list
      loadThreads()
    } catch (err) {
      console.error('Failed to send reply:', err)
      setError(toUserMessage(err, 'Failed to send reply'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResolve() {
    if (!selectedThread) return
    try {
      await resolveSupportThread(selectedThread.id)
      closeThreadDetail()
      loadThreads()
    } catch (err) {
      console.error('Failed to resolve thread:', err)
      setError(toUserMessage(err, 'Failed to resolve thread'))
    }
  }

  async function handleClose() {
    if (!selectedThread) return
    try {
      await closeSupportThread(selectedThread.id)
      closeThreadDetail()
      loadThreads()
    } catch (err) {
      console.error('Failed to close thread:', err)
      setError(toUserMessage(err, 'Failed to close thread'))
    }
  }

  async function handleReopen() {
    if (!selectedThread) return
    try {
      await updateSupportThread(selectedThread.id, { status: 'OPEN' })
      closeThreadDetail()
      loadThreads()
    } catch (err) {
      console.error('Failed to reopen thread:', err)
      setError(toUserMessage(err, 'Failed to reopen thread'))
    }
  }

  const columns = [
    {
      header: 'ID',
      accessor: 'id',
      cell: (row) => `#${row.id}`,
    },
    {
      header: 'Subject',
      accessor: 'subject',
      cell: (row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.subject}</div>
          {row.assignment_ref && (
            <small style={{ color: 'var(--text-muted)' }}>
              Assignment: <Link to={`/admin/assignments/${row.assignment_id}`}>{row.assignment_ref}</Link>
            </small>
          )}
        </div>
      ),
    },
    {
      header: 'Status',
      accessor: 'status',
      cell: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
    },
    {
      header: 'Priority',
      accessor: 'priority',
      cell: (row) => <Badge tone={priorityTone(row.priority)}>{row.priority}</Badge>,
    },
    {
      header: 'Created By',
      accessor: 'created_by_name',
    },
    {
      header: 'Last Activity',
      accessor: 'last_message_at',
      cell: (row) => formatDateTime(row.last_message_at || row.created_at),
    },
    {
      header: 'Actions',
      accessor: 'id',
      cell: (row) => (
        <button
          onClick={() => openThread(row)}
          className="btn-secondary btn-sm"
        >
          View
        </button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Support Inbox"
        description="Manage customer support queries and threads"
      />

      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {['ALL', 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED'].map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={filterStatus === status ? 'btn-primary' : 'btn-secondary'}
          >
            {status}
          </button>
        ))}
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
          {error}
        </div>
      )}

      {loading ? (
        <Card>
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading support threads...</div>
        </Card>
      ) : threads.length === 0 ? (
        <EmptyState
          title="No support threads found"
          description="There are no support threads matching your filter."
        />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            data={threads}
            keyField="id"
          />
        </Card>
      )}

      {/* Thread Detail Drawer */}
      <Drawer
        open={!!selectedThread}
        onClose={closeThreadDetail}
        ariaLabel="Support Thread Detail"
      >
        {threadDetail && (
          <div>
            <div className="drawer-header">
              <div>
                <h2>{threadDetail.subject}</h2>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <Badge tone={statusTone(threadDetail.status)}>{threadDetail.status}</Badge>
                  <Badge tone={priorityTone(threadDetail.priority)}>{threadDetail.priority}</Badge>
                </div>
              </div>
              <button
                onClick={closeThreadDetail}
                className="drawer-close"
                aria-label="Close"
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="drawer-body">
              {/* Thread Info */}
              <div className="support-thread-info">
                <div><strong>Created:</strong> {formatDateTime(threadDetail.created_at)}</div>
                <div><strong>Created By:</strong> {threadDetail.created_by_name} ({threadDetail.created_via})</div>
                {threadDetail.assignment_ref && (
                  <div>
                    <strong>Assignment:</strong>{' '}
                    <Link to={`/admin/assignments/${threadDetail.assignment_id}`}>
                      {threadDetail.assignment_ref}
                    </Link>
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="support-messages">
                {threadDetail.messages?.map((msg) => (
                  <div
                    key={msg.id}
                    className={`support-message ${msg.author_type === 'INTERNAL' ? 'message-internal' : 'message-external'}`}
                  >
                    <div className="message-header">
                      <strong>{msg.author_label || msg.author_name || 'Unknown'}</strong>
                      <small>{formatDateTime(msg.created_at)}</small>
                    </div>
                    <div className="message-body">
                      {msg.message_text}
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply Form */}
              {threadDetail.status !== 'CLOSED' && (
                <form onSubmit={handleReply} className="support-reply-form">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your reply..."
                    rows={4}
                    required
                  />
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    <button type="submit" disabled={submitting || !replyText.trim()}>
                      {submitting ? 'Sending...' : 'Send Reply'}
                    </button>
                    {threadDetail.status === 'OPEN' && (
                      <button type="button" onClick={handleResolve} className="btn-secondary">
                        Mark Resolved
                      </button>
                    )}
                    {threadDetail.status === 'RESOLVED' && (
                      <button type="button" onClick={handleClose} className="btn-secondary">
                        Close Thread
                      </button>
                    )}
                    {(threadDetail.status === 'RESOLVED' || threadDetail.status === 'CLOSED') && (
                      <button type="button" onClick={handleReopen} className="btn-secondary">
                        Reopen
                      </button>
                    )}
                  </div>
                </form>
              )}

              {threadDetail.status === 'CLOSED' && (
                <div className="alert alert-muted" style={{ marginTop: '1rem' }}>
                  This thread is closed. <button onClick={handleReopen} className="btn-link">Reopen</button>
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
