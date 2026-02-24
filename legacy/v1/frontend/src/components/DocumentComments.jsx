import React, { useEffect, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../auth/AuthContext'

/**
 * DocumentComments
 *
 * Two-lane comment system for assignment documents:
 * - Internal lane: Team discussions with @mentions
 * - External lane: Client requests and communications
 *
 * Props:
 * - documentId: number (required)
 * - assignmentId: number (required)
 * - onCommentCountChange: function (optional) - Called when comment count changes
 */
export default function DocumentComments({ documentId, assignmentId, onCommentCountChange }) {
  const { user } = useAuth()
  const [activeLane, setActiveLane] = useState('INTERNAL')
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newComment, setNewComment] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (documentId) {
      loadComments()
    }
  }, [documentId, activeLane])

  async function loadComments() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/api/document-comments', {
        params: {
          document_id: documentId,
          lane: activeLane,
          include_resolved: true,
        }
      })
      setComments(data.comments || [])

      // Notify parent of comment count change
      if (onCommentCountChange) {
        onCommentCountChange(data.total || 0)
      }
    } catch (err) {
      console.error('Failed to load comments:', err)
      setError(err.message || 'Failed to load comments')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitComment() {
    if (!newComment.trim()) return

    setSubmitting(true)
    try {
      await api.post('/api/document-comments', {
        document_id: documentId,
        assignment_id: assignmentId,
        content: newComment.trim(),
        lane: activeLane,
        parent_comment_id: replyTo?.id || null,
        mentioned_user_ids: [], // Backend will parse from content
        is_visible_to_client: activeLane === 'EXTERNAL',
      })

      setNewComment('')
      setReplyTo(null)
      loadComments()
    } catch (err) {
      console.error('Failed to create comment:', err)
      alert(err.response?.data?.detail || 'Failed to create comment')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResolveComment(commentId, isResolved) {
    try {
      await api.post(`/api/document-comments/${commentId}/resolve`, {
        is_resolved: isResolved
      })
      loadComments()
    } catch (err) {
      console.error('Failed to resolve comment:', err)
      alert(err.response?.data?.detail || 'Failed to update comment')
    }
  }

  async function handleDeleteComment(commentId) {
    if (!window.confirm('Delete this comment?')) return

    try {
      await api.delete(`/api/document-comments/${commentId}`)
      loadComments()
    } catch (err) {
      console.error('Failed to delete comment:', err)
      alert(err.response?.data?.detail || 'Failed to delete comment')
    }
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return date.toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    })
  }

  // Group comments into threads (parent + replies)
  const threadedComments = comments.filter(c => !c.parent_comment_id)

  function getReplies(parentId) {
    return comments.filter(c => c.parent_comment_id === parentId)
  }

  function CommentItem({ comment, isReply = false }) {
    const isAuthor = user?.id === comment.author_id
    const replies = getReplies(comment.id)

    return (
      <div
        style={{
          marginLeft: isReply ? '2rem' : '0',
          marginTop: isReply ? '0.75rem' : '1rem',
          padding: '0.75rem',
          background: comment.is_resolved ? 'var(--surface-alt)' : 'var(--surface)',
          borderLeft: isReply ? '2px solid var(--border)' : 'none',
          borderRadius: isReply ? '0' : '6px',
          opacity: comment.is_resolved ? 0.7 : 1,
        }}
      >
        {/* Comment Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
          <div>
            <span style={{ fontWeight: 600 }}>{comment.author.full_name || comment.author.email}</span>
            <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
              {formatDate(comment.created_at)}
            </span>
            {comment.is_edited && (
              <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>(edited)</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {!comment.is_resolved && (
              <button
                className="ghost"
                onClick={() => setReplyTo(comment)}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
              >
                Reply
              </button>
            )}
            {!comment.is_resolved && (
              <button
                className="ghost"
                onClick={() => handleResolveComment(comment.id, true)}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
              >
                ✓ Resolve
              </button>
            )}
            {comment.is_resolved && (
              <button
                className="ghost"
                onClick={() => handleResolveComment(comment.id, false)}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
              >
                ↺ Reopen
              </button>
            )}
            {isAuthor && (
              <button
                className="ghost"
                onClick={() => handleDeleteComment(comment.id)}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem', color: 'var(--warn)' }}
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Comment Content */}
        <div style={{ fontSize: '0.95rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {highlightMentions(comment.content)}
        </div>

        {/* Mention Badge */}
        {comment.mentioned_user_ids && comment.mentioned_user_ids.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            <span className="badge" style={{ fontSize: '0.8rem', background: 'var(--accent)', color: 'var(--bg)' }}>
              👥 {comment.mentioned_user_ids.length} mentioned
            </span>
          </div>
        )}

        {/* Resolved Badge */}
        {comment.is_resolved && (
          <div style={{ marginTop: '0.5rem' }}>
            <span className="badge ok" style={{ fontSize: '0.8rem' }}>
              ✓ Resolved
            </span>
          </div>
        )}

        {/* Replies */}
        {replies.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            {replies.map(reply => (
              <CommentItem key={reply.id} comment={reply} isReply={true} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Lane Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
        <button
          className={activeLane === 'INTERNAL' ? 'tab active' : 'tab'}
          onClick={() => setActiveLane('INTERNAL')}
          style={{
            flex: 1,
            padding: '0.75rem',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            borderBottom: activeLane === 'INTERNAL' ? '2px solid var(--accent-2)' : '2px solid transparent',
            color: activeLane === 'INTERNAL' ? 'var(--text)' : 'var(--muted)',
            fontWeight: activeLane === 'INTERNAL' ? 600 : 400,
          }}
        >
          💬 Internal Team
        </button>
        <button
          className={activeLane === 'EXTERNAL' ? 'tab active' : 'tab'}
          onClick={() => setActiveLane('EXTERNAL')}
          style={{
            flex: 1,
            padding: '0.75rem',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            borderBottom: activeLane === 'EXTERNAL' ? '2px solid var(--accent-2)' : '2px solid transparent',
            color: activeLane === 'EXTERNAL' ? 'var(--text)' : 'var(--muted)',
            fontWeight: activeLane === 'EXTERNAL' ? 600 : 400,
          }}
        >
          📨 Client Requests
        </button>
      </div>

      {/* Comments List */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
        {loading ? (
          <div className="empty">Loading comments...</div>
        ) : error ? (
          <div className="empty">Error: {error}</div>
        ) : threadedComments.length === 0 ? (
          <div className="empty">
            <div style={{ marginBottom: 8 }}>No {activeLane.toLowerCase()} comments yet</div>
            <div className="muted" style={{ fontSize: '0.9rem' }}>
              {activeLane === 'INTERNAL'
                ? 'Start a discussion with your team'
                : 'Track client requests and communications'}
            </div>
          </div>
        ) : (
          threadedComments.map(comment => (
            <CommentItem key={comment.id} comment={comment} />
          ))
        )}
      </div>

      {/* New Comment Form */}
      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
        {replyTo && (
          <div style={{
            padding: '0.5rem',
            background: 'var(--surface-alt)',
            borderRadius: '4px',
            marginBottom: '0.5rem',
            fontSize: '0.85rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted">
                Replying to <strong>{replyTo.author.full_name || replyTo.author.email}</strong>
              </span>
              <button
                className="ghost"
                onClick={() => setReplyTo(null)}
                style={{ padding: '0.25rem 0.5rem' }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder={
            activeLane === 'INTERNAL'
              ? 'Add a comment... Use @name to mention teammates'
              : 'Add a client request or communication note...'
          }
          style={{
            width: '100%',
            minHeight: '80px',
            padding: '0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: '0.95rem',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
          disabled={submitting}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', alignItems: 'center' }}>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {activeLane === 'EXTERNAL' && '⚠️ Visible to client'}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {replyTo && (
              <button
                className="secondary"
                onClick={() => setReplyTo(null)}
                disabled={submitting}
              >
                Cancel Reply
              </button>
            )}
            <button
              onClick={handleSubmitComment}
              disabled={!newComment.trim() || submitting}
            >
              {submitting ? 'Posting...' : replyTo ? 'Post Reply' : 'Post Comment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
