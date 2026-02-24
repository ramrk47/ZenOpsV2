import React, { useEffect, useMemo, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import { fetchBanks, fetchCompanyAccounts, createCompanyAccount, updateCompanyAccount } from '../../api/master'
import { toUserMessage } from '../../api/client'
import { loadJson, saveJson } from '../../utils/storage'

const FILTERS_KEY = 'zenops.companyAccounts.filters.v1'

function accountToForm(account) {
  if (!account) {
    return {
      bank_id: '',
      account_name: '',
      account_number: '',
      ifsc_code: '',
      bank_name: '',
      branch_name: '',
      upi_id: '',
      is_primary: false,
      is_active: true,
      notes: '',
    }
  }
  return {
    bank_id: account.bank_id ? String(account.bank_id) : '',
    account_name: account.account_name || '',
    account_number: account.account_number || '',
    ifsc_code: account.ifsc_code || '',
    bank_name: account.bank_name || '',
    branch_name: account.branch_name || '',
    upi_id: account.upi_id || '',
    is_primary: Boolean(account.is_primary),
    is_active: Boolean(account.is_active),
    notes: account.notes || '',
  }
}

export default function AdminCompanyAccounts() {
  const [accounts, setAccounts] = useState([])
  const [banks, setBanks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const storedFilters = loadJson(FILTERS_KEY, { searchTerm: '', showInactive: false })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState(storedFilters.searchTerm || '')
  const [showInactive, setShowInactive] = useState(Boolean(storedFilters.showInactive))

  useEffect(() => {
    saveJson(FILTERS_KEY, { searchTerm, showInactive })
  }, [searchTerm, showInactive])

  const [selectedId, setSelectedId] = useState(null)
  const [editForm, setEditForm] = useState(accountToForm(null))

  const [createForm, setCreateForm] = useState(accountToForm(null))

  useEffect(() => {
    let cancelled = false

    async function loadAccounts() {
      setLoading(true)
      setError(null)
      try {
        const [accountData, bankData] = await Promise.all([
          fetchCompanyAccounts(),
          fetchBanks().catch(() => []),
        ])
        if (cancelled) return
        setAccounts(accountData)
        setBanks(bankData)
        const nextSelectedId =
          selectedId && accountData.some((a) => a.id === selectedId) ? selectedId : accountData[0]?.id ?? null
        setSelectedId(nextSelectedId)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load company accounts'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAccounts()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedId) || null,
    [accounts, selectedId],
  )

  const filteredAccounts = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return accounts.filter((account) => {
      if (!showInactive && !account.is_active) return false
      if (!query) return true
      const haystack = [
        account.account_name,
        account.bank_name,
        account.branch_name,
        account.account_number,
        account.ifsc_code,
        account.upi_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [accounts, searchTerm, showInactive])

  const bankMap = useMemo(() => {
    const map = new Map()
    banks.forEach((bank) => map.set(bank.id, bank))
    return map
  }, [banks])

  useEffect(() => {
    setEditForm(accountToForm(selectedAccount))
  }, [selectedAccount])

  const primaryCount = accounts.filter((a) => a.is_primary).length

  function updateEditForm(key, value) {
    setEditForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateCreateForm(key, value) {
    setCreateForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSelect(account) {
    setSelectedId(account.id)
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    if (!selectedAccount) return
    try {
      const payload = {
        ...editForm,
        bank_id: editForm.bank_id ? Number(editForm.bank_id) : null,
        notes: editForm.notes.trim() || null,
        ifsc_code: editForm.ifsc_code.trim() || null,
        branch_name: editForm.branch_name.trim() || null,
        upi_id: editForm.upi_id.trim() || null,
      }
      await updateCompanyAccount(selectedAccount.id, payload)
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update company account'))
    }
  }

  async function handleMakePrimary(account) {
    try {
      await updateCompanyAccount(account.id, { is_primary: true })
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to set primary account'))
    }
  }

  async function handleToggleActive(account) {
    try {
      await updateCompanyAccount(account.id, { is_active: !account.is_active })
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update account status'))
    }
  }

  async function handleCreateAccount(e) {
    e.preventDefault()
    try {
      const payload = {
        ...createForm,
        bank_id: createForm.bank_id ? Number(createForm.bank_id) : null,
        notes: createForm.notes.trim() || null,
        ifsc_code: createForm.ifsc_code.trim() || null,
        branch_name: createForm.branch_name.trim() || null,
        upi_id: createForm.upi_id.trim() || null,
      }
      if (!payload.account_name || !payload.account_number || !payload.bank_name) {
        setError('Account name, number, and bank name are required.')
        return
      }
      await createCompanyAccount(payload)
      setCreateForm(accountToForm(null))
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create company account'))
    }
  }

  return (
    <div>
      <PageHeader
        title="Company Accounts"
        subtitle="Control which bank details appear on invoices and billing artifacts."
        actions={<Badge tone={primaryCount === 1 ? 'ok' : 'warn'}>{primaryCount} primary</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      <div className="split">
      <Card>
        <CardHeader
          title="Accounts"
          subtitle="Select an account to edit, or set a primary account."
          action={<button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>Refresh</button>}
        />

        {loading ? (
          <DataTable loading columns={4} rows={6} />
        ) : accounts.length === 0 ? (
          <EmptyState>No company accounts configured yet.</EmptyState>
        ) : (
          <>
            <div className="filter-shell" style={{ marginBottom: '0.8rem' }}>
              <div className="toolbar dense">
                <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
                  {filtersOpen ? 'Hide Filters' : 'Filters'}
                </button>
                <Badge tone="info">{filteredAccounts.length} shown</Badge>
              </div>
              {filtersOpen ? (
                <div className="filter-panel">
                  <div className="filter-grid">
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="kicker">Search</span>
                      <input
                        type="search"
                        placeholder="Search account, bank, IFSC, UPI"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={(e) => setShowInactive(e.target.checked)}
                      />
                      Include inactive accounts
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
            {filteredAccounts.length === 0 ? (
              <EmptyState>No accounts match the current filters.</EmptyState>
            ) : (
              <div className="list">
                {filteredAccounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    className="list-item"
                    onClick={() => handleSelect(account)}
                    style={account.id === selectedId ? { borderColor: 'rgba(91, 140, 255, 0.6)' } : undefined}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ display: 'grid', gap: 4, textAlign: 'left' }}>
                        <strong>{account.account_name}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {account.bank_name}
                          {account.bank_id ? ` · mapped: ${bankMap.get(account.bank_id)?.name || account.bank_id}` : ''}
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>•••{account.account_number.slice(-4)}</span>
                      </div>
                      <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                        {account.is_primary ? <Badge tone="ok">Primary</Badge> : null}
                        {!account.is_active ? <Badge tone="muted">Inactive</Badge> : null}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {!account.is_primary ? (
                        <span className="nav-link" onClick={(e) => { e.stopPropagation(); handleMakePrimary(account) }}>
                          Make Primary
                        </span>
                      ) : null}
                      <span className="nav-link" onClick={(e) => { e.stopPropagation(); handleToggleActive(account) }}>
                        {account.is_active ? 'Deactivate' : 'Activate'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

        <div className="grid">
          <Card>
            <CardHeader
              title={selectedAccount ? 'Edit Account' : 'Edit Account'}
              subtitle={selectedAccount ? `Editing ${selectedAccount.account_name}` : 'Select an account to edit'}
            />

            {!selectedAccount ? (
              <EmptyState>Select an account from the list to edit details.</EmptyState>
            ) : (
              <form className="grid" onSubmit={handleSaveEdit}>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Commissioning Bank</span>
                  <select value={editForm.bank_id} onChange={(e) => updateEditForm('bank_id', e.target.value)}>
                    <option value="">No bank mapping</option>
                    {banks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {editForm.bank_id ? `Mapped to: ${bankMap.get(Number(editForm.bank_id))?.name || editForm.bank_id}` : 'Used as a fallback / primary account.'}
                  </div>
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Account Name</span>
                  <input value={editForm.account_name} onChange={(e) => updateEditForm('account_name', e.target.value)} />
                </label>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Account Number</span>
                  <input value={editForm.account_number} onChange={(e) => updateEditForm('account_number', e.target.value)} />
                </label>

                <div className="grid cols-2 tight-cols">
                  <label className="grid" style={{ gap: 6 }}>
                    <span className="kicker">Bank Name</span>
                    <input value={editForm.bank_name} onChange={(e) => updateEditForm('bank_name', e.target.value)} />
                  </label>
                  <label className="grid" style={{ gap: 6 }}>
                    <span className="kicker">Branch</span>
                    <input value={editForm.branch_name} onChange={(e) => updateEditForm('branch_name', e.target.value)} />
                  </label>
                </div>

                <div className="grid cols-2 tight-cols">
                  <label className="grid" style={{ gap: 6 }}>
                    <span className="kicker">IFSC</span>
                    <input value={editForm.ifsc_code} onChange={(e) => updateEditForm('ifsc_code', e.target.value)} />
                  </label>
                  <label className="grid" style={{ gap: 6 }}>
                    <span className="kicker">UPI</span>
                    <input value={editForm.upi_id} onChange={(e) => updateEditForm('upi_id', e.target.value)} />
                  </label>
                </div>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Notes</span>
                  <textarea rows={3} value={editForm.notes} onChange={(e) => updateEditForm('notes', e.target.value)} />
                </label>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={editForm.is_primary} onChange={(e) => updateEditForm('is_primary', e.target.checked)} />
                    Primary
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={editForm.is_active} onChange={(e) => updateEditForm('is_active', e.target.checked)} />
                    Active
                  </label>
                </div>

                <button type="submit">Save Changes</button>
              </form>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Add Account"
              subtitle="Provision new invoicing details without downtime."
            />

            <form className="grid" onSubmit={handleCreateAccount}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Commissioning Bank</span>
                <select value={createForm.bank_id} onChange={(e) => updateCreateForm('bank_id', e.target.value)}>
                  <option value="">No bank mapping</option>
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Account Name</span>
                <input value={createForm.account_name} onChange={(e) => updateCreateForm('account_name', e.target.value)} />
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Account Number</span>
                <input value={createForm.account_number} onChange={(e) => updateCreateForm('account_number', e.target.value)} />
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Bank Name</span>
                <input value={createForm.bank_name} onChange={(e) => updateCreateForm('bank_name', e.target.value)} />
              </label>

              <div className="grid cols-2 tight-cols">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Branch</span>
                  <input value={createForm.branch_name} onChange={(e) => updateCreateForm('branch_name', e.target.value)} />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">IFSC</span>
                  <input value={createForm.ifsc_code} onChange={(e) => updateCreateForm('ifsc_code', e.target.value)} />
                </label>
              </div>

              <div className="grid cols-2 tight-cols">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">UPI</span>
                  <input value={createForm.upi_id} onChange={(e) => updateCreateForm('upi_id', e.target.value)} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={createForm.is_primary} onChange={(e) => updateCreateForm('is_primary', e.target.checked)} />
                  Primary
                </label>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={createForm.is_active} onChange={(e) => updateCreateForm('is_active', e.target.checked)} />
                Active
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Notes</span>
                <textarea rows={3} value={createForm.notes} onChange={(e) => updateCreateForm('notes', e.target.value)} />
              </label>

              <button type="submit">Create Account</button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}
