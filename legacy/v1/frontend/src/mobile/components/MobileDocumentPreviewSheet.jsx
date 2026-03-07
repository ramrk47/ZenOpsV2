import React, { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { BottomSheet, Card } from './Primitives'

function formatFileSize(bytes) {
  const value = Number(bytes || 0)
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export default function MobileDocumentPreviewSheet({
  open,
  document,
  previewUrl,
  downloadUrl,
  onClose,
}) {
  const [blobUrl, setBlobUrl] = useState(null)
  const [textContent, setTextContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const mimeType = document?.mime_type || ''
  const extension = useMemo(() => document?.original_name?.split('.').pop()?.toLowerCase() || '', [document?.original_name])
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'
  const isText = mimeType.startsWith('text/') || ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'].includes(extension)
  const canPreview = isImage || isPdf || isText

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!open || !document || !previewUrl || !canPreview) return
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
        setBlobUrl(null)
      }
      setTextContent('')
      setError('')
      setLoading(true)
      try {
        const response = await api.get(previewUrl, { responseType: isText ? 'text' : 'blob' })
        if (cancelled) return
        if (isText) {
          setTextContent(response.data)
        } else {
          setBlobUrl(URL.createObjectURL(new Blob([response.data], { type: mimeType || undefined })))
        }
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.detail || 'Preview unavailable.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [canPreview, document, isText, mimeType, open, previewUrl])

  async function handleDownload() {
    if (!document || !downloadUrl) return
    try {
      const response = await api.get(downloadUrl, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const link = window.document.createElement('a')
      link.href = url
      link.download = document.original_name || 'document'
      window.document.body.appendChild(link)
      link.click()
      window.document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Download failed.')
    }
  }

  return (
    <BottomSheet open={open} title={document?.original_name || 'Preview'} onClose={onClose}>
      {document ? (
        <div className="m-sheet-stack">
          <Card className="m-sheet-card">
            <div className="m-preview-meta">
              <strong>{document.original_name}</strong>
              <small>{document.category || 'Uncategorized'} · {formatFileSize(document.size)}</small>
            </div>
          </Card>

          <Card className="m-sheet-card">
            {loading ? <p className="m-muted-note">Loading preview…</p> : null}
            {error ? <div className="m-alert m-alert-error">{error}</div> : null}
            {!loading && !error && !canPreview ? (
              <p className="m-muted-note">Inline preview is not available for this file type. Download the file to inspect it.</p>
            ) : null}
            {!loading && !error && isImage && blobUrl ? <img className="m-preview-image" src={blobUrl} alt={document.original_name} /> : null}
            {!loading && !error && isPdf && blobUrl ? <iframe className="m-preview-frame" src={blobUrl} title={document.original_name} /> : null}
            {!loading && !error && isText ? <pre className="m-preview-text">{textContent}</pre> : null}
            <div className="m-inline-actions">
              <button type="button" className="m-primary-btn" onClick={handleDownload}>Download</button>
              <button type="button" className="m-secondary-btn" onClick={onClose}>Close</button>
            </div>
          </Card>
        </div>
      ) : null}
    </BottomSheet>
  )
}
