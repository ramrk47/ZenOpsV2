import React, { useEffect, useState } from 'react'
import { fetchAssignmentSummary, fetchAssignmentWorkload } from '../api/assignments'

export default function AdminDashboard() {
  const [summary, setSummary] = useState(null)
  const [workload, setWorkload] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      setError(null)
      try {
        const [s, w] = await Promise.all([
          fetchAssignmentSummary(),
          fetchAssignmentWorkload(),
        ])
        setSummary(s)
        setWorkload(w || {})
      } catch (err) {
        console.error(err)
        setError('Failed to load dashboard data')
      }
    }
    load()
  }, [])
  return (
    <div className="page">
      <div>
        <h2>Admin Dashboard</h2>
        <div className="muted">Legacy summary view (kept for fallback).</div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="card">
        {summary ? (
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div><strong>Total</strong><br />{summary.total}</div>
            <div><strong>Pending</strong><br />{summary.pending}</div>
            <div><strong>Completed</strong><br />{summary.completed}</div>
            <div><strong>Unpaid</strong><br />{summary.unpaid}</div>
          </div>
        ) : (
          <div className="muted">Loading summary…</div>
        )}
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Workload</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User ID</th>
                <th>OK</th>
                <th>Due Soon</th>
                <th>Overdue</th>
                <th>NA</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(workload).map((uid) => (
                <tr key={uid}>
                  <td>{uid}</td>
                  <td>{workload[uid].OK}</td>
                  <td>{workload[uid].DUE_SOON}</td>
                  <td>{workload[uid].OVERDUE}</td>
                  <td>{workload[uid].NA}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
