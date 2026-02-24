import React, { useState, useEffect, useCallback } from 'react'
import DocumentComments from './DocumentComments'
import { reviewDocument } from '../api/documents'
import api from '../api/client'

const REVIEW_STATUSES = ['REVIEWED', 'NEEDS_CLARIFICATION', 'REJECTED', 'FINAL']

/**
 * DocumentPreviewDrawerV2
 * 
 * Fixed document preview with authenticated blob fetching.
 * Supports: PDF, images, text files, Word, Excel
 * Comments displayed below preview (not as separate tab)
 */
export default function DocumentPreviewDrawerV2({
  document,
  assignmentId,
  previewUrl,
  downloadUrl,
  isOpen,
  onClose,
  onReviewComplete,
  onDownload,
  onDelete,
  currentUser,
}) {
  const [imageZoom, setImageZoom] = useState(1)
  const [imageRotation, setImageRotation] = useState(0)
  const [reviewStatus, setReviewStatus] = useState(document?.review_status || 'REVIEWED')
  const [reviewNote, setReviewNote] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)
  const [commentsCount, setCommentsCount] = useState(document?.comments_count || 0)
  
  // Blob-based preview state (with auth)
  const [blobUrl, setBlobUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [textContent, setTextContent] = useState('')

  // File type detection
  const mimeType = document?.mime_type || ''
  const fileName = document?.original_name || ''
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  
  const isImage = mimeType.startsWith('image/')
  const isPDF = mimeType === 'application/pdf'
  const isText = mimeType.startsWith('text/') || 
                 mimeType === 'application/json' ||
                 ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'].includes(ext)
  const isWord = mimeType.includes('word') || mimeType.includes('officedocument.wordprocessing') ||
                 ['doc', 'docx'].includes(ext)
  const isExcel = mimeType.includes('spreadsheet') || mimeType.includes('excel') ||
                  ['xls', 'xlsx'].includes(ext)
  const isCAD = ['dwg', 'dxf', 'dwf'].includes(ext)
  
  // Previewable types
  const isNativePreviewable = isImage || isPDF || isText
  const isOfficePreviewable = isWord || isExcel
  const isPreviewable = isNativePreviewable || isOfficePreviewable
  
  const isPartner = currentUser?.role === 'EXTERNAL_PARTNER'
  const MAX_PREVIEW_SIZE = 10 * 1024 * 1024 // 10MB
  const isFileTooLarge = document?.size > MAX_PREVIEW_SIZE

  // Fetch file with authentication
  const fetchFile = useCallback(async () => {
    if (!previewUrl || !isOpen) return
    
    // Cleanup previous blob
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl)
      setBlobUrl(null)
    }
    setTextContent('')
    setError(null)
    setLoading(true)

    try {
      const response = await api.get(previewUrl, {
        responseType: isText ? 'text' : 'blob'
      })

      if (isText) {
        setTextContent(response.data)
      } else {
        const blob = new Blob([response.data], { type: mimeType })
        const url = URL.createObjectURL(blob)
        setBlobUrl(url)
      }
    } catch (err) {
      console.error('Preview fetch error:', err)
      setError(err.response?.data?.detail || err.message || 'Failed to load preview')
    } finally {
      setLoading(false)
    }
  }, [previewUrl, isOpen, isText, mimeType])

  // Fetch on open
  useEffect(() => {
    if (isOpen && document && isNativePreviewable && !isFileTooLarge) {
      fetchFile()
    }
  }, [isOpen, document?.id, isNativePreviewable, isFileTooLarge])

  // Cleanup on close
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [blobUrl])

  // Reset state when document changes
  useEffect(() => {
    if (document) {
      setReviewStatus(document.review_status || 'REVIEWED')
      setCommentsCount(document.comments_count || 0)
      setImageZoom(1)
      setImageRotation(0)
    }
  }, [document?.id])

  if (!isOpen || !document) return null

  function formatFileSize(bytes) {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-IN', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  function handleDownload() {
    if (onDownload) {
      onDownload(document)
    } else {
      // Download via authenticated request
      api.get(downloadUrl, { responseType: 'blob' })
        .then(response => {
          const url = URL.createObjectURL(response.data)
          const a = window.document.createElement('a')
          a.href = url
          a.download = document.original_name || 'document'
          window.document.body.appendChild(a)
          a.click()
          window.document.body.removeChild(a)
          URL.revokeObjectURL(url)
        })
        .catch(err => {
          console.error('Download failed:', err)
          alert('Download failed')
        })
    }
  }

  function handleDelete() {
    if (onDelete && window.confirm(`Delete "${document.original_name}"?`)) {
      onDelete(document)
      onClose()
    }
  }

  async function handleQuickReview(status) {
    if (!assignmentId || !document?.id) return
    setSubmittingReview(true)
    try {
      await reviewDocument(assignmentId, document.id, status, null)
      if (onReviewComplete) onReviewComplete()
    } catch (err) {
      console.error('Review failed:', err)
      alert(err.response?.data?.detail || 'Failed to update review status')
    } finally {
      setSubmittingReview(false)
    }
  }

  async function handleSaveReview() {
    if (!assignmentId || !document?.id) return
    setSubmittingReview(true)
    try {
      await reviewDocument(assignmentId, document.id, reviewStatus, reviewNote || null)
      setReviewNote('')
      if (onReviewComplete) onReviewComplete()
    } catch (err) {
      console.error('Review failed:', err)
      alert(err.response?.data?.detail || 'Failed to save review')
    } finally {
      setSubmittingReview(false)
    }
  }

  function getStatusColor(status) {
    switch (status) {
      case 'REVIEWED': return 'var(--ok)'
      case 'FINAL': return 'var(--accent-2)'
      case 'NEEDS_CLARIFICATION': return 'var(--warn)'
      case 'REJECTED': return 'var(--danger)'
      default: return 'var(--muted)'
    }
  }

  // Render preview content based on file type
  function renderPreview() {
    if (isFileTooLarge) {
      return (
        <div className="empty" style={{ padding: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📦</div>
          <div>File too large for preview ({formatFileSize(document.size)})</div>
          <button onClick={handleDownload} style={{ marginTop: '1rem' }}>
            Download to View
          </button>
        </div>
      )
    }

    if (loading) {
      return (
        <div className="empty" style={{ padding: '2rem' }}>
          <div style={{ fontSize: '2rem' }}>⏳</div>
          <div>Loading preview...</div>
        </div>
      )
    }

    if (error) {
      return (
        <div className="empty" style={{ padding: '2rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
          <div style={{ color: 'var(--warn)' }}>Preview failed: {error}</div>
          <button onClick={fetchFile} style={{ marginTop: '1rem' }}>
            Retry
          </button>
        </div>
      )
    }

    // Text files
    if (isText) {
      return (
        <div style={{ padding: '1rem', height: '100%', overflow: 'auto' }}>
          <pre style={{
            margin: 0,
            padding: '1rem',
            background: 'var(--surface)',
            borderRadius: '4px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            lineHeight: '1.5',
            minHeight: '300px',
            maxHeight: '50vh',
            overflow: 'auto'
          }}>
            {textContent || '(empty file)'}
          </pre>
        </div>
      )
    }

    // Image files
    if (isImage && blobUrl) {
      return (
        <div style={{ padding: '1rem' }}>
          {/* Image controls */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <button className="ghost" onClick={() => setImageZoom(z => Math.min(z + 0.25, 3))}>
              🔍+ Zoom In
            </button>
            <button className="ghost" onClick={() => setImageZoom(z => Math.max(z - 0.25, 0.5))}>
              🔍- Zoom Out
            </button>
            <button className="ghost" onClick={() => setImageRotation(r => (r + 90) % 360)}>
              🔄 Rotate
            </button>
            <button className="ghost" onClick={() => { setImageZoom(1); setImageRotation(0); }}>
              ↺ Reset
            </button>
            <span className="muted" style={{ marginLeft: 'auto' }}>{Math.round(imageZoom * 100)}%</span>
          </div>
          
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'auto',
            background: 'var(--surface)',
            borderRadius: '4px',
            padding: '1rem',
            minHeight: '500px',
            maxHeight: '70vh',
          }}>
            <img
              src={blobUrl}
              alt={document.original_name}
              style={{
                maxWidth: '100%',
                maxHeight: '65vh',
                height: 'auto',
                transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                transition: 'transform 0.2s ease',
              }}
            />
          </div>
        </div>
      )
    }

    // PDF files
    if (isPDF && blobUrl) {
      return (
        <div style={{ padding: '1rem', height: '100%' }}>
          <iframe
            src={blobUrl}
            title={document.original_name}
            style={{
              width: '100%',
              height: '50vh',
              minHeight: '400px',
              border: 'none',
              borderRadius: '4px',
              background: 'var(--surface)',
            }}
          />
        </div>
      )
    }

    // Word/Excel - Use Google Docs Viewer (requires file to be publicly accessible)
    // Since our files require auth, we show a download prompt instead
    if (isOfficePreviewable) {
      return (
        <div className="empty" style={{ padding: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
            {isWord ? '📝' : '📊'}
          </div>
          <div>{isWord ? 'Word Document' : 'Excel Spreadsheet'}</div>
          <div className="muted" style={{ marginTop: '0.5rem' }}>
            Office files cannot be previewed in browser.
          </div>
          <button onClick={handleDownload} style={{ marginTop: '1rem' }}>
            Download to View
          </button>
        </div>
      )
    }

    // CAD files
    if (isCAD) {
      return (
        <div className="empty" style={{ padding: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏗️</div>
          <div>CAD Drawing ({ext.toUpperCase()})</div>
          <div className="muted" style={{ marginTop: '0.5rem' }}>
            CAD files require specialized software to view.
          </div>
          <button onClick={handleDownload} style={{ marginTop: '1rem' }}>
            Download to View
          </button>
        </div>
      )
    }

    // Unsupported
    return (
      <div className="empty" style={{ padding: '2rem' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
        <div>Preview not available</div>
        <div className="muted" style={{ marginTop: '0.5rem' }}>
          File type: {mimeType || ext || 'unknown'}
        </div>
        <button onClick={handleDownload} style={{ marginTop: '1rem' }}>
          Download to View
        </button>
      </div>
    )
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        className="drawer drawer-right"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '85vw', maxWidth: '1400px' }}
      >
        {/* Header */}
        <div className="drawer-header">
          <div>
            <h3 style={{ margin: 0 }}>{document.original_name}</h3>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {formatFileSize(document.size)}
              </span>
              <span
                style={{
                  padding: '0.125rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: getStatusColor(document.review_status),
                  color: 'white',
                }}
              >
                {document.review_status?.replace(/_/g, ' ')}
              </span>
              {document.visibility === 'PARTNER_RELEASED' && (
                <span className="badge" style={{ fontSize: '0.75rem' }}>👁️ Partner Visible</span>
              )}
              {commentsCount > 0 && (
                <span className="badge info" style={{ fontSize: '0.75rem' }}>
                  💬 {commentsCount}
                </span>
              )}
            </div>
          </div>
          <button className="ghost" onClick={onClose} style={{ padding: '0.5rem' }}>
            ✕
          </button>
        </div>

        {/* Body - Split View */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: Preview + Comments (stacked) */}
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
            {/* Preview Section */}
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={{ padding: '0.5rem 1rem', fontWeight: 600, background: 'var(--surface)' }}>
                📄 Preview
              </div>
              {renderPreview()}
            </div>

            {/* Comments Section (below preview) */}
            <div>
              <div style={{ padding: '0.5rem 1rem', fontWeight: 600, background: 'var(--surface)' }}>
                💬 Comments & Notes {commentsCount > 0 && `(${commentsCount})`}
              </div>
              <div style={{ padding: '1rem' }}>
                <DocumentComments
                  documentId={document.id}
                  assignmentId={assignmentId}
                  onCommentCountChange={setCommentsCount}
                />
              </div>
            </div>
          </div>

          {/* Right Sidebar - Actions & Metadata */}
          <div
            style={{
              width: '320px',
              borderLeft: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
              background: 'var(--surface)',
            }}
          >
            {/* Quick Actions */}
            {!isPartner && (
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Quick Review</div>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleQuickReview('REVIEWED')}
                    disabled={submittingReview}
                    style={{ fontSize: '0.9rem' }}
                  >
                    ✓ Mark Reviewed
                  </button>
                  <button
                    className="ghost"
                    onClick={() => handleQuickReview('NEEDS_CLARIFICATION')}
                    disabled={submittingReview}
                    style={{ fontSize: '0.9rem' }}
                  >
                    ⚠️ Needs Clarification
                  </button>
                  <button
                    className="ghost"
                    onClick={() => handleQuickReview('FINAL')}
                    disabled={submittingReview}
                    style={{ fontSize: '0.9rem', color: 'var(--accent-2)' }}
                  >
                    🏁 Mark Final
                  </button>
                </div>
              </div>
            )}

            {/* Review with Note */}
            {!isPartner && (
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Review with Note</div>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="kicker">Status</span>
                    <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
                      {REVIEW_STATUSES.map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="kicker">Note (Internal)</span>
                    <textarea
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="Add review notes..."
                      rows={3}
                      style={{ fontSize: '0.9rem' }}
                    />
                  </label>
                  <button onClick={handleSaveReview} disabled={submittingReview}>
                    {submittingReview ? 'Saving...' : 'Save Review'}
                  </button>
                </div>
              </div>
            )}

            {/* Document Info */}
            <div style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Document Info</div>
              <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
                <div><span className="muted">Type:</span> {mimeType || ext || 'Unknown'}</div>
                <div><span className="muted">Size:</span> {formatFileSize(document.size)}</div>
                <div><span className="muted">Category:</span> {document.category || '—'}</div>
                {document.created_at && (
                  <div><span className="muted">Uploaded:</span> {formatDate(document.created_at)}</div>
                )}
                {document.reviewed_at && (
                  <div><span className="muted">Reviewed:</span> {formatDate(document.reviewed_at)}</div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '1rem' }}>
                <button onClick={handleDownload} className="secondary">
                  ⬇️ Download
                </button>
                {onDelete && !isPartner && (
                  <button className="ghost" onClick={handleDelete} style={{ color: 'var(--warn)' }}>
                    🗑️ Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
