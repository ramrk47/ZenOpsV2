import React, { useState } from 'react'

/**
 * DocumentPreviewDrawer
 *
 * In-console document preview drawer for PDFs and images.
 * Shows preview with metadata and action buttons.
 *
 * Props:
 * - document: { id, name, file_url, file_type, file_size, uploaded_at, uploaded_by }
 * - isOpen: boolean
 * - onClose: function
 * - onDownload: function (optional)
 * - onDelete: function (optional)
 */
export default function DocumentPreviewDrawer({ document, isOpen, onClose, onDownload, onDelete }) {
  const [imageZoom, setImageZoom] = useState(1)
  const [imageRotation, setImageRotation] = useState(0)
  const [pdfError, setPdfError] = useState(null)

  if (!isOpen || !document) return null

  const isImage = document.file_type?.startsWith('image/')
  const isPDF = document.file_type === 'application/pdf'
  const isPreviewable = isImage || isPDF

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
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function handleDownload() {
    if (onDownload) {
      onDownload(document)
    } else {
      // Default download behavior
      const a = document.createElement('a')
      a.href = document.file_url
      a.download = document.name || 'document'
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  function handleDelete() {
    if (onDelete && window.confirm(`Delete "${document.name}"?`)) {
      onDelete(document)
      onClose()
    }
  }

  function handleImageZoomIn() {
    setImageZoom(prev => Math.min(prev + 0.25, 3))
  }

  function handleImageZoomOut() {
    setImageZoom(prev => Math.max(prev - 0.25, 0.5))
  }

  function handleImageRotate() {
    setImageRotation(prev => (prev + 90) % 360)
  }

  function handleImageReset() {
    setImageZoom(1)
    setImageRotation(0)
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer drawer-right" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <div>
            <h3 style={{ margin: 0 }}>{document.name}</h3>
            <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
              {formatFileSize(document.file_size)}
            </div>
          </div>
          <button className="ghost" onClick={onClose} style={{ padding: '0.5rem' }}>
            ✕
          </button>
        </div>

        {/* Preview Area */}
        <div className="drawer-body" style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
          {!isPreviewable ? (
            <div className="empty" style={{ margin: '2rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
              <div>Preview not available</div>
              <div className="muted" style={{ marginTop: '0.5rem' }}>
                This file type cannot be previewed in the browser
              </div>
              <button onClick={handleDownload} style={{ marginTop: '1rem' }}>
                Download to View
              </button>
            </div>
          ) : isImage ? (
            <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Image Controls */}
              <div className="card tight" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="ghost" onClick={handleImageZoomIn} disabled={imageZoom >= 3}>
                  🔍+ Zoom In
                </button>
                <button className="ghost" onClick={handleImageZoomOut} disabled={imageZoom <= 0.5}>
                  🔍- Zoom Out
                </button>
                <button className="ghost" onClick={handleImageRotate}>
                  🔄 Rotate
                </button>
                <button className="ghost" onClick={handleImageReset}>
                  ↺ Reset
                </button>
                <div className="muted" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                  {Math.round(imageZoom * 100)}%
                </div>
              </div>

              {/* Image Preview */}
              <div style={{
                flex: 1,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'auto',
                background: 'var(--surface)',
                borderRadius: '4px',
                padding: '1rem',
              }}>
                <img
                  src={document.file_url}
                  alt={document.name}
                  style={{
                    maxWidth: '100%',
                    height: 'auto',
                    transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                    transition: 'transform 0.2s ease',
                  }}
                />
              </div>
            </div>
          ) : isPDF ? (
            <div style={{ padding: '1rem' }}>
              <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📑</div>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>PDF Preview</div>
                <div className="muted" style={{ marginBottom: '1.5rem' }}>
                  PDF preview requires additional library installation
                </div>
                <div className="muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                  To enable PDF preview, install:
                  <code style={{
                    display: 'block',
                    margin: '0.5rem auto',
                    padding: '0.5rem',
                    background: 'var(--bg)',
                    borderRadius: '4px',
                    maxWidth: '400px',
                  }}>
                    npm install react-pdf
                  </code>
                </div>
                <button onClick={handleDownload}>
                  Download PDF
                </button>
                {pdfError && (
                  <div style={{ marginTop: '1rem', color: 'var(--warn)' }}>
                    {pdfError}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Metadata Section */}
        <div className="drawer-footer" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="card tight">
            <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Document Info</div>
            <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
              <div>
                <span className="muted">File Name:</span>
                <div style={{ fontWeight: 500 }}>{document.name}</div>
              </div>
              <div>
                <span className="muted">Type:</span>
                <div>{document.file_type || 'Unknown'}</div>
              </div>
              <div>
                <span className="muted">Size:</span>
                <div>{formatFileSize(document.file_size)}</div>
              </div>
              {document.uploaded_at && (
                <div>
                  <span className="muted">Uploaded:</span>
                  <div>{formatDate(document.uploaded_at)}</div>
                </div>
              )}
              {document.uploaded_by_name && (
                <div>
                  <span className="muted">Uploaded By:</span>
                  <div>{document.uploaded_by_name}</div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button onClick={handleDownload} style={{ flex: 1 }}>
              ⬇️ Download
            </button>
            {onDelete && (
              <button className="ghost" onClick={handleDelete} style={{ color: 'var(--warn)' }}>
                🗑️ Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
