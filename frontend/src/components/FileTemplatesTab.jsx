import { useState, useEffect, useCallback, useRef } from 'react'
import EmptyState from './ui/EmptyState'
import Badge from './ui/Badge'
import {
  fetchDocumentTemplates,
  createDocumentTemplate,
  updateDocumentTemplate,
  deleteDocumentTemplate,
  downloadDocumentTemplate,
} from '../api/documentTemplates'
import { formatDate, titleCase } from '../utils/format'

const CATEGORIES = ['REPORT', 'FORM', 'CHECKLIST', 'LETTER', 'OTHER']
const SERVICE_LINES = ['VALUATION', 'INDUSTRIAL', 'DPR', 'CMA']

function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FileTemplatesTab({ clients = [], propertyTypes = [], banks = [], branches = [] }) {
  const [templates, setTemplates] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)

  // filters
  const [filterClient, setFilterClient] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterActive, setFilterActive] = useState('true')
  const [filterBank, setFilterBank] = useState('')
  const [filterBranch, setFilterBranch] = useState('')

  // upload form
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    client_id: '',
    service_line: '',
    property_type_id: '',
    bank_id: '',
    branch_id: '',
    scope_type: '',
    display_order: 0,
  })
  const fileRef = useRef(null)

  // inline edit drafts
  const [drafts, setDrafts] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (filterClient) params.client_id = filterClient
      if (filterCategory) params.category = filterCategory
      if (filterBank) params.bank_id = filterBank
      if (filterBranch) params.branch_id = filterBranch
      if (filterActive !== '') params.is_active = filterActive
      const data = await fetchDocumentTemplates(params)
      setTemplates(data.items || [])
      setTotal(data.total || 0)
      // seed drafts
      const d = {}
      for (const t of data.items || []) {
        d[t.id] = {
          name: t.name,
          description: t.description || '',
          category: t.category || '',
          is_active: t.is_active,
          display_order: t.display_order,
          service_line: t.service_line || '',
          bank_id: t.bank_id || '',
          branch_id: t.branch_id || '',
          scope_type: t.scope_type || '',
        }
      }
      setDrafts(d)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }, [filterClient, filterCategory, filterActive, filterBank, filterBranch])

  useEffect(() => { load() }, [load])

  async function handleUpload(e) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return setError('Please select a file')
    if (!form.name.trim()) return setError('Please enter a name')
    if (!form.service_line) return setError('Please choose a service line')
    if (String(form.service_line || '').toUpperCase() === 'VALUATION' && !form.bank_id) {
      return setError('Bank is required for valuation templates')
    }

    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', form.name.trim())
      if (form.description) fd.append('description', form.description)
      if (form.category) fd.append('category', form.category)
      if (form.client_id) fd.append('client_id', form.client_id)
      if (form.service_line) fd.append('service_line', form.service_line)
      if (form.property_type_id) fd.append('property_type_id', form.property_type_id)
      if (form.bank_id) fd.append('bank_id', form.bank_id)
      if (form.branch_id) fd.append('branch_id', form.branch_id)
      if (form.scope_type) fd.append('scope_type', form.scope_type)
      fd.append('display_order', String(form.display_order || 0))

      await createDocumentTemplate(fd)
      setForm({
        name: '',
        description: '',
        category: '',
        client_id: '',
        service_line: '',
        property_type_id: '',
        bank_id: '',
        branch_id: '',
        scope_type: '',
        display_order: 0,
      })
      if (fileRef.current) fileRef.current.value = ''
      setShowUpload(false)
      load()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(id) {
    const draft = drafts[id]
    if (!draft) return
    setError(null)
    try {
      await updateDocumentTemplate(id, {
        name: draft.name,
        description: draft.description || null,
        category: draft.category || null,
        service_line: draft.service_line || null,
        bank_id: draft.bank_id || null,
        branch_id: draft.branch_id || null,
        scope_type: draft.scope_type || null,
        is_active: draft.is_active,
        display_order: draft.display_order,
      })
      load()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Update failed')
    }
  }

  async function handleDeactivate(id) {
    setError(null)
    try {
      await deleteDocumentTemplate(id)
      load()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Deactivate failed')
    }
  }

  async function handleDownload(template) {
    try {
      const response = await downloadDocumentTemplate(template.id)
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = template.original_name || 'template'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      setError('Download failed')
    }
  }

  function updateDraft(id, key, value) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
  }

  function isDirty(id) {
    const t = templates.find((t) => t.id === id)
    const d = drafts[id]
    if (!t || !d) return false
    return (
      d.name !== t.name ||
      (d.description || '') !== (t.description || '') ||
      (d.category || '') !== (t.category || '') ||
      (d.service_line || '') !== (t.service_line || '') ||
      String(d.bank_id || '') !== String(t.bank_id || '') ||
      String(d.branch_id || '') !== String(t.branch_id || '') ||
      d.is_active !== t.is_active ||
      d.display_order !== t.display_order
    )
  }

  return (
    <div className="grid">
      {error && (
        <div className="callout danger" style={{ marginBottom: '0.5rem' }}>
          {error}
          <button type="button" className="ghost small" onClick={() => setError(null)} style={{ marginLeft: 8 }}>Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="toolbar">
        <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
          <option value="">All Clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={filterBank} onChange={(e) => { setFilterBank(e.target.value); setFilterBranch('') }}>
          <option value="">All Banks</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} disabled={!filterBank}>
          <option value="">All Branches</option>
          {branches.filter((b) => String(b.bank_id) === String(filterBank)).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{titleCase(c)}</option>
          ))}
        </select>
        <select value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
          <option value="">All</option>
        </select>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setShowUpload(!showUpload)}>
          {showUpload ? 'Cancel' : 'Upload Template'}
        </button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <form className="grid" style={{ gap: '0.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-raised, #fafafa)' }} onSubmit={handleUpload}>
          <div className="toolbar">
            <input
              className="grow"
              placeholder="Template name *"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
            <select value={form.service_line} onChange={(e) => setForm((p) => ({ ...p, service_line: e.target.value, bank_id: '', branch_id: '' }))} required>
              <option value="">Service Line *</option>
              {SERVICE_LINES.map((line) => (
                <option key={line} value={line}>{titleCase(line)}</option>
              ))}
            </select>
            <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
              <option value="">Category</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{titleCase(c)}</option>
              ))}
            </select>
          </div>
          <div className="toolbar">
            {String(form.service_line || '').toUpperCase() === 'VALUATION' ? (
              <>
                <select value={form.bank_id} onChange={(e) => setForm((p) => ({ ...p, bank_id: e.target.value, branch_id: '' }))} required>
                  <option value="">Bank *</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <select value={form.branch_id} onChange={(e) => setForm((p) => ({ ...p, branch_id: e.target.value }))} disabled={!form.bank_id}>
                  <option value="">All branches</option>
                  {branches.filter((b) => String(b.bank_id) === String(form.bank_id)).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <select value={form.scope_type} onChange={(e) => setForm((p) => ({ ...p, scope_type: e.target.value }))}>
                  <option value="">Scope (optional)</option>
                  <option value="CLIENT">Client</option>
                  <option value="GLOBAL">Global</option>
                </select>
                <select value={form.client_id} onChange={(e) => setForm((p) => ({ ...p, client_id: e.target.value }))}>
                  <option value="">Global (all clients)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select value={form.property_type_id} onChange={(e) => setForm((p) => ({ ...p, property_type_id: e.target.value }))}>
                  <option value="">All property types</option>
                  {propertyTypes.map((pt) => (
                    <option key={pt.id} value={pt.id}>{pt.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <textarea
            rows={2}
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          />
          <div className="toolbar">
            <input type="file" ref={fileRef} required style={{ flex: 1 }} />
            <button type="submit" disabled={uploading}>
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      {loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : templates.length === 0 ? (
        <EmptyState>No file templates found. Upload one to get started.</EmptyState>
      ) : (
        <>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Showing {templates.length} of {total} template{total !== 1 ? 's' : ''}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Service Scope</th>
                  <th>Category</th>
                  <th>Template Scope</th>
                  <th>File</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => {
                  const d = drafts[t.id] || {}
                  const dirty = isDirty(t.id)
                  return (
                    <tr key={t.id}>
                      <td>
                        <input
                          value={d.name ?? t.name}
                          onChange={(e) => updateDraft(t.id, 'name', e.target.value)}
                          style={{ width: '100%', minWidth: 140 }}
                        />
                      </td>
                      <td>
                        <div className="grid" style={{ gap: 6 }}>
                          <select
                            value={d.service_line ?? t.service_line ?? ''}
                            onChange={(e) => updateDraft(t.id, 'service_line', e.target.value)}
                          >
                            <option value="">Service Line</option>
                            {SERVICE_LINES.map((line) => (
                              <option key={line} value={line}>{titleCase(line)}</option>
                            ))}
                          </select>
                          {String(d.service_line ?? t.service_line ?? '').toUpperCase() !== 'VALUATION' ? (
                            <select
                              value={d.scope_type ?? t.scope_type ?? ''}
                              onChange={(e) => updateDraft(t.id, 'scope_type', e.target.value)}
                            >
                              <option value="">Scope</option>
                              <option value="CLIENT">Client</option>
                              <option value="GLOBAL">Global</option>
                            </select>
                          ) : null}
                          {String(d.service_line ?? t.service_line ?? '').toUpperCase() === 'VALUATION' ? (
                            <>
                              <select
                                value={d.bank_id ?? t.bank_id ?? ''}
                                onChange={(e) => updateDraft(t.id, 'bank_id', e.target.value)}
                              >
                                <option value="">Bank</option>
                                {banks.map((b) => (
                                  <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                              </select>
                              <select
                                value={d.branch_id ?? t.branch_id ?? ''}
                                onChange={(e) => updateDraft(t.id, 'branch_id', e.target.value)}
                                disabled={!String(d.bank_id ?? t.bank_id ?? '')}
                              >
                                <option value="">All branches</option>
                                {branches
                                  .filter((b) => String(b.bank_id) === String(d.bank_id ?? t.bank_id ?? ''))
                                  .map((b) => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                  ))}
                              </select>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <select
                          value={d.category ?? t.category ?? ''}
                          onChange={(e) => updateDraft(t.id, 'category', e.target.value)}
                        >
                          <option value="">—</option>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>{titleCase(c)}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.82rem', lineHeight: 1.4 }}>
                          {t.service_line ? `${titleCase(t.service_line)}` : 'Global'}
                          {String(t.service_line || '').toUpperCase() === 'VALUATION' ? (
                            <>
                              {t.bank_name ? ` / ${t.bank_name}` : ''}
                              {t.branch_name ? ` / ${t.branch_name}` : ''}
                            </>
                          ) : (
                            <>
                              {t.client_name ? ` / ${t.client_name}` : ''}
                              {t.property_type_name ? ` / ${t.property_type_name}` : ''}
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() => handleDownload(t)}
                          title={t.original_name}
                          style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {t.original_name}
                        </button>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{formatSize(t.size)}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{formatDate(t.created_at)}</td>
                      <td>
                        <Badge tone={t.is_active ? 'ok' : 'muted'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {dirty && (
                          <button type="button" className="small" onClick={() => handleSave(t.id)}>Save</button>
                        )}
                        {t.is_active && (
                          <button type="button" className="ghost small danger" onClick={() => handleDeactivate(t.id)} style={{ marginLeft: 4 }}>
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
