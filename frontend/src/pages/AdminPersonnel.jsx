import React, { useEffect, useState } from 'react'
import { fetchUsers, createUser, updateUser } from '../api/users'

export default function AdminPersonnel() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newUser, setNewUser] = useState({ email: '', full_name: '', role: 'EMPLOYEE', password: '' })
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchUsers()
        setUsers(data || [])
      } catch (err) {
        console.error(err)
        setError('Failed to load users')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])
  async function handleCreate(e) {
    e.preventDefault()
    try {
      const created = await createUser(newUser)
      setUsers((us) => [...us, created])
      setNewUser({ email: '', full_name: '', role: 'EMPLOYEE', password: '' })
    } catch (err) {
      console.error(err)
      alert('Error creating user')
    }
  }
  async function handleRoleChange(id, role) {
    try {
      const updated = await updateUser(id, { role })
      setUsers((us) => us.map((u) => (u.id === id ? updated : u)))
    } catch (err) {
      console.error(err)
    }
  }
  async function handleActiveToggle(id, is_active) {
    try {
      const updated = await updateUser(id, { is_active })
      setUsers((us) => us.map((u) => (u.id === id ? updated : u)))
    } catch (err) {
      console.error(err)
    }
  }
  return (
    <div className="page">
      <h2>Personnel Management</h2>
      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <div className="muted">Loading users…</div>
      ) : (
      <div className="table-wrap">
        <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.full_name}</td>
              <td>
                <select value={u.role} onChange={(e) => handleRoleChange(u.id, e.target.value)}>
                  {['ADMIN','OPS_MANAGER','HR','FINANCE','ASSISTANT_VALUER','FIELD_VALUER','EMPLOYEE'].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </td>
              <td>
                <input type="checkbox" checked={u.is_active} onChange={(e) => handleActiveToggle(u.id, e.target.checked)} />
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      )}
      <h3 style={{ marginTop: '1rem' }}>Create New User</h3>
      <form onSubmit={handleCreate}>
        <div>
          <label>Email
            <input type="email" value={newUser.email} onChange={(e) => setNewUser((nu) => ({ ...nu, email: e.target.value }))} required />
          </label>
        </div>
        <div>
          <label>Full Name
            <input type="text" value={newUser.full_name} onChange={(e) => setNewUser((nu) => ({ ...nu, full_name: e.target.value }))} />
          </label>
        </div>
        <div>
          <label>Role
            <select value={newUser.role} onChange={(e) => setNewUser((nu) => ({ ...nu, role: e.target.value }))}>
              {['ADMIN','OPS_MANAGER','HR','FINANCE','ASSISTANT_VALUER','FIELD_VALUER','EMPLOYEE'].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <label>Password
            <input type="password" value={newUser.password} onChange={(e) => setNewUser((nu) => ({ ...nu, password: e.target.value }))} required />
          </label>
        </div>
        <button type="submit">Create</button>
      </form>
    </div>
  )
}
