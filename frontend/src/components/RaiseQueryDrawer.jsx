import React, { useState } from 'react'
import Drawer from './ui/Drawer'
import { createSupportThread } from '../api/support'
import { toUserMessage } from '../api/client'

const QUERY_TYPES = [
  { value: 'document_issue', label: 'Document Issue' },
  { value: 'payment_query', label: 'Payment Query' },
  { value: 'status_update', label: 'Status Update Request' },
  { value: 'general', label: 'General Question' },
  { value: 'other', label: 'Other' },
]

const PRIORITIES = [
  { value: 'LOW', label: 'Low - General inquiry' },
  { value: 'MEDIUM', label: 'Medium - Needs attention' },
  { value: 'HIGH', label: 'High - Urgent' },
]

export default function RaiseQueryDrawer({ open, onClose, assignmentId, assignmentRef }) {
  const [queryType, setQueryType] = useState('general')
  const [priority, setPriority] = useState('MEDIUM')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const payload = {
        subject: subject || `${QUERY_TYPES.find((t) => t.value === queryType)?.label} - ${assignmentRef || 'General'}`,
        initial_message: message,
        priority,
        assignment_id: assignmentId || null,
      }

      await createSupportThread(payload)
      setSuccess(true)
      setTimeout(() => {
        handleClose()
      }, 2000)
    } catch (err) {
      console.error('Failed to create support thread:', err)
      setError(toUserMessage(err, 'Failed to create support query'))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setQueryType('general')
    setPriority('MEDIUM')
    setSubject('')
    setMessage('')
    setError(null)
    setSuccess(false)
    onClose()
  }

  return (
    <Drawer open={open} onClose={handleClose} ariaLabel="Raise Support Query">
      <div className="drawer-header">
        <h2>Raise a Query</h2>
        <button
          onClick={handleClose}
          className="drawer-close"
          aria-label="Close"
          type="button"
        >
          ✕
        </button>
      </div>

      <div className="drawer-body">
        {success ? (
          <div className="alert alert-ok">
            <strong>Query submitted successfully!</strong>
            <p>Our team will get back to you shortly via email.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="support-form">
            {assignmentRef && (
              <div className="form-info">
                <strong>Assignment:</strong> {assignmentRef}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="queryType">Query Type</label>
              <select
                id="queryType"
                value={queryType}
                onChange={(e) => setQueryType(e.target.value)}
                required
              >
                {QUERY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                required
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="subject">Subject (optional)</label>
              <input
                id="subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief description of your query"
                maxLength={200}
              />
            </div>

            <div className="form-group">
              <label htmlFor="message">Message *</label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Please describe your query in detail..."
                rows={6}
                required
                maxLength={2000}
              />
              <small className="form-hint">{message.length} / 2000 characters</small>
            </div>

            {error && (
              <div className="alert alert-danger">
                {error}
              </div>
            )}

            <div className="form-actions">
              <button type="button" onClick={handleClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={loading || !message.trim()}>
                {loading ? 'Submitting...' : 'Submit Query'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Drawer>
  )
}
