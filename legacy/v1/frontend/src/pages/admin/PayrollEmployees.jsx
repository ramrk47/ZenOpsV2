import React, { useEffect, useState } from 'react'
import { fetchSalaryStructures, createSalaryStructure, updateSalaryStructure } from '../../api/payroll'
import { fetchUserDirectory } from '../../api/users'

export default function PayrollEmployees() {
  const [loading, setLoading] = useState(true)
  const [structures, setStructures] = useState([])
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showActiveOnly, setShowActiveOnly] = useState(true)

  // Create/Edit Modal
  const [showModal, setShowModal] = useState(false)
  const [editingStructure, setEditingStructure] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    user_id: '',
    effective_from: '',
    effective_to: '',
    monthly_gross: '',
    basic_salary: '',
    hra: '',
    special_allowance: '',
    standard_minutes_per_day: '480',
    payroll_divisor_days: '30',
    overtime_multiplier: '2.0',
    pf_applicable: true,
    esi_applicable: false,
    pt_applicable: true,
    tds_applicable: false,
  })

  useEffect(() => {
    loadData()
  }, [showActiveOnly])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [structuresData, usersData] = await Promise.all([
        fetchSalaryStructures({ activeOnly: showActiveOnly }),
        fetchUserDirectory({ includeInactive: false })
      ])
      setStructures(Array.isArray(structuresData) ? structuresData : structuresData.structures || [])
      setUsers(Array.isArray(usersData) ? usersData : usersData.users || [])
    } catch (err) {
      console.error('Failed to load employees:', err)
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  function openCreateModal() {
    setEditingStructure(null)
    setFormData({
      user_id: '',
      effective_from: new Date().toISOString().split('T')[0],
      effective_to: '',
      monthly_gross: '',
      basic_salary: '',
      hra: '',
      special_allowance: '',
      standard_minutes_per_day: '480',
      payroll_divisor_days: '30',
      overtime_multiplier: '2.0',
      pf_applicable: true,
      esi_applicable: false,
      pt_applicable: true,
      tds_applicable: false,
    })
    setShowModal(true)
  }

  function openEditModal(structure) {
    setEditingStructure(structure)
    setFormData({
      user_id: String(structure.user_id),
      effective_from: structure.effective_from,
      effective_to: structure.effective_to || '',
      monthly_gross: String(structure.monthly_gross || 0),
      basic_salary: String(structure.basic_salary || 0),
      hra: String(structure.hra || 0),
      special_allowance: String(structure.special_allowance || 0),
      standard_minutes_per_day: String(structure.standard_minutes_per_day || 480),
      payroll_divisor_days: String(structure.payroll_divisor_days || 30),
      overtime_multiplier: String(structure.overtime_multiplier || 2.0),
      pf_applicable: structure.pf_applicable !== false,
      esi_applicable: structure.esi_applicable === true,
      pt_applicable: structure.pt_applicable !== false,
      tds_applicable: structure.tds_applicable === true,
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!formData.user_id) {
      alert('Please select an employee')
      return
    }
    if (!formData.effective_from) {
      alert('Please set effective from date')
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...formData,
        user_id: parseInt(formData.user_id, 10),
        monthly_gross: parseFloat(formData.monthly_gross) || 0,
        basic_salary: parseFloat(formData.basic_salary) || 0,
        hra: parseFloat(formData.hra) || 0,
        special_allowance: parseFloat(formData.special_allowance) || 0,
        standard_minutes_per_day: parseInt(formData.standard_minutes_per_day, 10) || 480,
        payroll_divisor_days: parseInt(formData.payroll_divisor_days, 10) || 30,
        overtime_multiplier: parseFloat(formData.overtime_multiplier) || 2.0,
        effective_to: formData.effective_to || null,
      }

      if (editingStructure) {
        await updateSalaryStructure(editingStructure.id, payload)
      } else {
        await createSalaryStructure(payload)
      }

      setShowModal(false)
      loadData()
    } catch (err) {
      console.error('Failed to save salary structure:', err)
      alert(err.response?.data?.detail || 'Failed to save salary structure')
    } finally {
      setSaving(false)
    }
  }

  function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0)
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  function getUserName(userId) {
    const user = users.find(u => u.id === userId)
    return user ? user.full_name || user.email : `User ${userId}`
  }

  const filteredStructures = structures.filter(s => {
    if (!searchTerm) return true
    const userName = getUserName(s.user_id).toLowerCase()
    return userName.includes(searchTerm.toLowerCase())
  })

  // Group by user
  const groupedByUser = filteredStructures.reduce((acc, s) => {
    if (!acc[s.user_id]) acc[s.user_id] = []
    acc[s.user_id].push(s)
    return acc
  }, {})

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll Employees</h1>
          <div className="page-subtitle">Manage employee salary structures</div>
        </div>
        <div className="header-actions">
          <button onClick={openCreateModal}>
            + Add Salary Structure
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="toolbar">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search employees..."
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={showActiveOnly}
              onChange={(e) => setShowActiveOnly(e.target.checked)}
            />
            <span>Active Only</span>
          </label>
        </div>
      </div>

      {/* Employee List */}
      <div className="card">
        {loading ? (
          <div className="empty">Loading employees...</div>
        ) : error ? (
          <div className="empty">Error: {error}</div>
        ) : Object.keys(groupedByUser).length === 0 ? (
          <div className="empty">
            <div style={{ marginBottom: 8 }}>No salary structures found</div>
            <button onClick={openCreateModal}>
              Add First Salary Structure
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Effective From</th>
                <th>Effective To</th>
                <th style={{ textAlign: 'right' }}>Monthly Gross</th>
                <th style={{ textAlign: 'right' }}>Basic</th>
                <th style={{ textAlign: 'right' }}>HRA</th>
                <th>Statutory</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedByUser).map(([userId, userStructures]) => (
                <React.Fragment key={userId}>
                  {userStructures
                    .sort((a, b) => new Date(b.effective_from) - new Date(a.effective_from))
                    .map((structure, idx) => (
                      <tr key={structure.id}>
                        <td style={{ fontWeight: idx === 0 ? 600 : 400 }}>
                          {getUserName(structure.user_id)}
                        </td>
                        <td>{formatDate(structure.effective_from)}</td>
                        <td className={structure.effective_to ? 'muted' : ''}>
                          {structure.effective_to ? formatDate(structure.effective_to) : 'Current'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {formatCurrency(structure.monthly_gross)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {formatCurrency(structure.basic_salary)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {formatCurrency(structure.hra)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {structure.pf_applicable && <span className="badge muted">PF</span>}
                            {structure.esi_applicable && <span className="badge muted">ESI</span>}
                            {structure.pt_applicable && <span className="badge muted">PT</span>}
                            {structure.tds_applicable && <span className="badge muted">TDS</span>}
                          </div>
                        </td>
                        <td>
                          {!structure.effective_to && (
                            <button
                              className="ghost"
                              onClick={() => openEditModal(structure)}
                              style={{ padding: '0.25rem 0.5rem' }}
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => !saving && setShowModal(false)}>
          <div className="modal-content" style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3>{editingStructure ? 'Edit Salary Structure' : 'Add Salary Structure'}</h3>

            <div className="grid" style={{ marginTop: '1rem', gap: '1rem' }}>
              {/* Employee Selection */}
              <label className="grid">
                <span className="muted">Employee *</span>
                <select
                  value={formData.user_id}
                  onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                  disabled={editingStructure !== null || saving}
                  required
                >
                  <option value="">Select employee...</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.email}
                    </option>
                  ))}
                </select>
              </label>

              {/* Effective Dates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label className="grid">
                  <span className="muted">Effective From *</span>
                  <input
                    type="date"
                    value={formData.effective_from}
                    onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                    disabled={saving}
                    required
                  />
                </label>
                <label className="grid">
                  <span className="muted">Effective To</span>
                  <input
                    type="date"
                    value={formData.effective_to}
                    onChange={(e) => setFormData({ ...formData, effective_to: e.target.value })}
                    disabled={saving}
                  />
                </label>
              </div>

              {/* Salary Components */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <div className="muted" style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Salary Components</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <label className="grid">
                    <span className="muted">Monthly Gross *</span>
                    <input
                      type="number"
                      value={formData.monthly_gross}
                      onChange={(e) => setFormData({ ...formData, monthly_gross: e.target.value })}
                      disabled={saving}
                      min="0"
                      step="1"
                      required
                    />
                  </label>
                  <label className="grid">
                    <span className="muted">Basic Salary</span>
                    <input
                      type="number"
                      value={formData.basic_salary}
                      onChange={(e) => setFormData({ ...formData, basic_salary: e.target.value })}
                      disabled={saving}
                      min="0"
                      step="1"
                    />
                  </label>
                  <label className="grid">
                    <span className="muted">HRA</span>
                    <input
                      type="number"
                      value={formData.hra}
                      onChange={(e) => setFormData({ ...formData, hra: e.target.value })}
                      disabled={saving}
                      min="0"
                      step="1"
                    />
                  </label>
                  <label className="grid">
                    <span className="muted">Special Allowance</span>
                    <input
                      type="number"
                      value={formData.special_allowance}
                      onChange={(e) => setFormData({ ...formData, special_allowance: e.target.value })}
                      disabled={saving}
                      min="0"
                      step="1"
                    />
                  </label>
                </div>
              </div>

              {/* Hybrid Payroll Config */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <div className="muted" style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Hybrid Payroll Configuration</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <label className="grid">
                    <span className="muted">Minutes/Day</span>
                    <input
                      type="number"
                      value={formData.standard_minutes_per_day}
                      onChange={(e) => setFormData({ ...formData, standard_minutes_per_day: e.target.value })}
                      disabled={saving}
                      min="0"
                    />
                  </label>
                  <label className="grid">
                    <span className="muted">Payroll Days</span>
                    <input
                      type="number"
                      value={formData.payroll_divisor_days}
                      onChange={(e) => setFormData({ ...formData, payroll_divisor_days: e.target.value })}
                      disabled={saving}
                      min="1"
                    />
                  </label>
                  <label className="grid">
                    <span className="muted">OT Multiplier</span>
                    <input
                      type="number"
                      value={formData.overtime_multiplier}
                      onChange={(e) => setFormData({ ...formData, overtime_multiplier: e.target.value })}
                      disabled={saving}
                      min="1"
                      step="0.1"
                    />
                  </label>
                </div>
              </div>

              {/* Statutory Deductions */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <div className="muted" style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Statutory Deductions</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={formData.pf_applicable}
                      onChange={(e) => setFormData({ ...formData, pf_applicable: e.target.checked })}
                      disabled={saving}
                    />
                    <span>PF Applicable</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={formData.esi_applicable}
                      onChange={(e) => setFormData({ ...formData, esi_applicable: e.target.checked })}
                      disabled={saving}
                    />
                    <span>ESI Applicable</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={formData.pt_applicable}
                      onChange={(e) => setFormData({ ...formData, pt_applicable: e.target.checked })}
                      disabled={saving}
                    />
                    <span>PT Applicable</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={formData.tds_applicable}
                      onChange={(e) => setFormData({ ...formData, tds_applicable: e.target.checked })}
                      disabled={saving}
                    />
                    <span>TDS Applicable</span>
                  </label>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  onClick={handleSave}
                  disabled={!formData.user_id || !formData.effective_from || saving}
                >
                  {saving ? 'Saving...' : editingStructure ? 'Update Structure' : 'Create Structure'}
                </button>
                <button
                  className="secondary"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
