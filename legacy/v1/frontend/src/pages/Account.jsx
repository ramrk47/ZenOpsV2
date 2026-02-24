import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAssignments, fetchAssignmentSummary } from '../api/assignments'
import { fetchNotifications } from '../api/notifications'
import { fetchMyTasks } from '../api/tasks'
import { fetchMyLeave } from '../api/leave'
import { fetchApprovalsInbox } from '../api/approvals'
import { fetchUserDirectory, updateMyProfile } from '../api/users'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import { Card, CardHeader } from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import { dueStateLabel, dueStateTone, formatDate, formatDateTime } from '../utils/format'
import api, { toUserMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { canSeeAdmin } from '../utils/rbac'

export default function Account() {
  const { user, capabilities, refreshAuth } = useAuth()
  const [assignments, setAssignments] = useState([])
  const [summary, setSummary] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [tasks, setTasks] = useState([])
  const [leave, setLeave] = useState([])
  const [approvals, setApprovals] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [profileForm, setProfileForm] = useState({ email: '', full_name: '', phone: '' })
  const [passwordForm, setPasswordForm] = useState({ current_password: '', password: '', confirm: '' })
  const [profileNotice, setProfileNotice] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const viewOrg = canSeeAdmin(capabilities)
        const [mine, notif, myLeave, myTasks] = await Promise.all([
          fetchAssignments({ mine: !viewOrg, completion: 'PENDING' }),
          fetchNotifications({ unread_only: true, limit: 6 }),
          fetchMyLeave(),
          fetchMyTasks({ include_done: false, limit: 6 }).catch(() => []),
        ])
        if (!cancelled) {
          setAssignments(mine)
          setNotifications(notif)
          setLeave(myLeave)
          setTasks(myTasks)
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [user, capabilities])

  useEffect(() => {
    if (!canSeeAdmin(capabilities)) return
    fetchAssignmentSummary()
      .then(setSummary)
      .catch((err) => console.error(err))
    fetchApprovalsInbox(false)
      .then((data) => setApprovals(data.slice(0, 6)))
      .catch((err) => console.error(err))
    fetchUserDirectory().then(setUsers).catch((err) => console.error(err))
  }, [user, capabilities])

  useEffect(() => {
    if (!user) return
    setProfileForm({
      email: user.email || '',
      full_name: user.full_name || '',
      phone: user.phone || '',
    })
  }, [user])

  const groups = useMemo(() => {
    const overdue = assignments.filter((a) => a.due_state === 'OVERDUE')
    const dueSoon = assignments.filter((a) => a.due_state === 'DUE_SOON')
    const ok = assignments.filter((a) => a.due_state === 'OK')
    const unpaid = assignments.filter((a) => a.is_paid === false)
    return { overdue, dueSoon, ok, unpaid }
  }, [assignments])

  const taskStats = useMemo(() => {
    const now = new Date()
    const overdue = tasks.filter((t) => t.due_at && new Date(t.due_at) < now)
    const dueSoon = tasks.filter((t) => {
      if (!t.due_at) return false
      const due = new Date(t.due_at)
      return due >= now && due.getTime() - now.getTime() <= 24 * 60 * 60 * 1000
    })
    return { overdue, dueSoon }
  }, [tasks])

  const quickActions = [
    { label: 'New Assignment', to: '/assignments/new' },
    { label: 'Request Leave', to: '/requests' },
    { label: 'Upload Docs', to: '/assignments' },
    { label: 'Open Queue', to: '/assignments' },
  ]

  const todayLeave = leave.find((l) => l.status === 'APPROVED')
  const userMap = useMemo(() => {
    const map = new Map()
    users.forEach((u) => map.set(String(u.id), u))
    return map
  }, [users])

  async function handleProfileSave(e) {
    e.preventDefault()
    setProfileError(null)
    setProfileNotice(null)
    setSavingProfile(true)
    try {
      const payload = {
        email: profileForm.email.trim().toLowerCase(),
        full_name: profileForm.full_name.trim() || null,
        phone: profileForm.phone.trim() || null,
      }
      if (!payload.email) {
        setProfileError('Email is required.')
        return
      }
      await updateMyProfile(payload)
      await refreshAuth()
      setProfileNotice('Profile updated.')
    } catch (err) {
      console.error(err)
      setProfileError(toUserMessage(err, 'Failed to update profile'))
    } finally {
      setSavingProfile(false)
    }
  }

  async function handlePasswordSave(e) {
    e.preventDefault()
    setProfileError(null)
    setProfileNotice(null)
    setSavingProfile(true)
    try {
      if (!passwordForm.current_password || !passwordForm.password) {
        setProfileError('Current and new password are required.')
        return
      }
      if (passwordForm.password !== passwordForm.confirm) {
        setProfileError('Passwords do not match.')
        return
      }
      await updateMyProfile({
        current_password: passwordForm.current_password,
        password: passwordForm.password,
      })
      setPasswordForm({ current_password: '', password: '', confirm: '' })
      setProfileNotice('Password updated.')
      await refreshAuth()
    } catch (err) {
      console.error(err)
      setProfileError(toUserMessage(err, 'Failed to update password'))
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="My Day"
        subtitle="Focus on what matters now: overdue work, due soon, and critical signals."
        actions={(
          <>
            <Link to="/assignments" className="nav-link">
              Open Queue
            </Link>
            <Link to="/assignments/new" className="nav-link">
              New Assignment
            </Link>
          </>
        )}
      />

      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        {quickActions.map((action) => (
          <Link key={`${action.to}-${action.label}`} to={action.to} className="nav-link">
            {action.label}
          </Link>
        ))}
      </div>

      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        <StatCard
          kicker="My Queue"
          label="Open Assignments"
          value={assignments.length}
          help="Assignments visible to you that are not completed or cancelled."
        />
        <StatCard
          kicker="Fire"
          label="Overdue"
          value={groups.overdue.length}
          tone="danger"
          help="Assignments where due time has already passed."
        />
        <StatCard
          kicker="Next 4h"
          label="Due Soon"
          value={groups.dueSoon.length}
          tone="warn"
          help="Assignments due within the next 24 hours."
        />
        <StatCard
          kicker="Finance"
          label="Unpaid"
          value={groups.unpaid.length}
          tone="accent"
          help="Assignments with payment pending."
        >
          {canSeeAdmin(capabilities) && summary ? (
            <div className="muted">Org unpaid: {summary.unpaid}</div>
          ) : null}
        </StatCard>
      </div>

      <div className="split">
        <div className="grid">
          <Card id="tasks">
            <CardHeader
              title="Overdue"
              subtitle="Assignments that need immediate attention"
              action={<Badge tone="danger">{groups.overdue.length}</Badge>}
            />
            {loading ? (
              <div className="muted">Loading queue…</div>
            ) : groups.overdue.length === 0 ? (
              <EmptyState>No overdue work. Nice.</EmptyState>
            ) : (
              <div className="list">
                {groups.overdue.slice(0, 8).map((a) => (
                  <Link key={a.id} to={`/assignments/${a.id}`} className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{a.assignment_code}</strong>
                      <Badge tone="danger">{dueStateLabel(a)}</Badge>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {a.borrower_name || 'No borrower name'} · {a.bank_name || a.valuer_client_name || a.case_type}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      Due {formatDateTime(a.due_time)} · {userMap.get(String(a.assigned_to_user_id))?.full_name || 'Unassigned'}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      Primary risk: {a.is_paid ? '—' : 'Payment pending'}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Due Soon"
              subtitle="Keep these moving to avoid escalation"
              action={<Badge tone="warn">{groups.dueSoon.length}</Badge>}
            />
            {groups.dueSoon.length === 0 ? (
              <EmptyState>No near-term deadlines.</EmptyState>
            ) : (
              <div className="list">
                {groups.dueSoon.slice(0, 8).map((a) => (
                  <Link key={a.id} to={`/assignments/${a.id}`} className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{a.assignment_code}</strong>
                      <Badge tone={dueStateTone(a.due_state)}>{dueStateLabel(a)}</Badge>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {a.borrower_name || 'No borrower name'} · {a.property_type || a.property_type_id || 'Property'}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      Due {formatDateTime(a.due_time)} · {userMap.get(String(a.assigned_to_user_id))?.full_name || 'Unassigned'}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid">
          <Card>
            <CardHeader title="Signals" subtitle="Notifications and approvals" />
            {notifications.length === 0 ? (
              <EmptyState>No unread notifications.</EmptyState>
            ) : (
              <div className="list">
                {notifications.map((n) => (
                  <div key={n.id} className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Badge tone="info">{n.type}</Badge>
                      <span className="muted" style={{ fontSize: 12 }}>{formatDate(n.created_at)}</span>
                    </div>
                    <div style={{ marginTop: 6 }}>{n.message}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <Link to="/requests" className="nav-link">Open Requests</Link>
            </div>
            {canSeeAdmin(capabilities) ? (
              <div style={{ marginTop: 12 }}>
                <div className="kicker">Approvals</div>
                {approvals.length === 0 ? (
                  <div className="muted" style={{ marginTop: 6 }}>No pending approvals.</div>
                ) : (
                  <div className="list" style={{ marginTop: 6 }}>
                    {approvals.map((a) => (
                      <Link key={a.id} to="/admin/approvals" className="list-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong>{a.action_type}</strong>
                          <Badge tone="warn">{a.status}</Badge>
                        </div>
                        <div className="muted" style={{ marginTop: 4 }}>
                          Entity: {a.entity_type} #{a.entity_id}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="My Tasks"
              subtitle="Tasks assigned to you across assignments."
              action={(
                <div style={{ display: 'flex', gap: 8 }}>
                  <Badge tone={taskStats.overdue.length > 0 ? 'danger' : 'ok'}>
                    {taskStats.overdue.length} overdue
                  </Badge>
                  <Badge tone={taskStats.dueSoon.length > 0 ? 'warn' : 'ok'}>
                    {taskStats.dueSoon.length} due soon
                  </Badge>
                </div>
              )}
            />
            {tasks.length === 0 ? (
              <EmptyState>No active tasks right now.</EmptyState>
            ) : (
              <div className="list">
                {tasks.map((task) => (
                  <Link key={task.id} to={`/assignments/${task.assignment_id}`} className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{task.title}</strong>
                      {task.due_at ? (
                        <Badge tone={new Date(task.due_at) < new Date() ? 'danger' : 'info'}>
                          {formatDateTime(task.due_at)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {task.assignment_code || `Assignment #${task.assignment_id}`} · {task.borrower_name || 'Assignment'}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Leave" subtitle="Planned time away" />
            {todayLeave ? (
              <div className="list-item">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{todayLeave.leave_type}</strong>
                  <Badge tone="ok">{todayLeave.status}</Badge>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {formatDate(todayLeave.start_date)} → {formatDate(todayLeave.end_date || todayLeave.start_date)}
                </div>
              </div>
            ) : (
              <EmptyState>No active leave.</EmptyState>
            )}
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link to="/requests" className="nav-link">Request Leave</Link>
              <Link to="/calendar" className="nav-link">Open Calendar</Link>
            </div>
          </Card>

          {canSeeAdmin(capabilities) && summary ? (
            <Card>
              <CardHeader title="Org Snapshot" subtitle="Across all assignments" />
              <div className="grid cols-2">
                <StatCard label="Total" value={summary.total} kicker="All" />
                <StatCard label="Pending" value={summary.pending} kicker="Open" />
                <StatCard label="Completed" value={summary.completed} kicker="Done" tone="ok" />
                <StatCard label="Overdue" value={summary.overdue} kicker="SLA" tone="danger" />
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <Card id="my-account" style={{ marginTop: '1.2rem' }}>
        <CardHeader title="My Account" subtitle="Update your personal details and password." />
        {profileError ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{profileError}</div> : null}
        {profileNotice ? <div className="card notice tight" style={{ marginBottom: '0.8rem' }}>{profileNotice}</div> : null}

        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
          <form className="grid" onSubmit={handleProfileSave}>
            <div className="grid cols-2">
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Full Name</span>
                <input
                  value={profileForm.full_name}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, full_name: e.target.value }))}
                  placeholder="Your name"
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Phone</span>
                <input
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="Contact number"
                />
              </label>
            </div>
            <label className="grid" style={{ gap: 6 }}>
              <span className="kicker">Email (Login ID)</span>
              <input
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, email: e.target.value }))}
                required
              />
            </label>
            <button type="submit" disabled={savingProfile}>Save Profile</button>
            <div className="muted" style={{ fontSize: 12 }}>
              Admin/HR edits override previous values if needed.
            </div>
          </form>

          <form className="grid" onSubmit={handlePasswordSave}>
            <label className="grid" style={{ gap: 6 }}>
              <span className="kicker">Current Password</span>
              <input
                type="password"
                value={passwordForm.current_password}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, current_password: e.target.value }))}
              />
            </label>
            <label className="grid" style={{ gap: 6 }}>
              <span className="kicker">New Password</span>
              <input
                type="password"
                value={passwordForm.password}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
            <label className="grid" style={{ gap: 6 }}>
              <span className="kicker">Confirm New Password</span>
              <input
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm: e.target.value }))}
              />
            </label>
            <button type="submit" className="secondary" disabled={savingProfile}>Update Password</button>
            <div className="muted" style={{ fontSize: 12 }}>
              If admin resets your password, the latest admin change takes precedence.
            </div>
          </form>
        </div>
      </Card>

      <MfaSettingsCard />
      <WhatsAppSettingsCard />
    </div>
  )
}


function MfaSettingsCard() {
  const { user, refreshAuth } = useAuth()
  const [mfaStep, setMfaStep] = useState('idle') // idle | setup | verify | done | disable
  const [setupData, setSetupData] = useState(null) // { secret, provisioning_uri }
  const [backupCodes, setBackupCodes] = useState(null)
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const mfaEnabled = user?.totp_enabled

  async function handleStartSetup() {
    setError(null)
    setLoading(true)
    try {
      const res = await api.post('/api/auth/totp/setup')
      setSetupData(res.data)
      setMfaStep('setup')
    } catch (err) {
      setError(toUserMessage(err, 'Failed to start MFA setup'))
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifySetup(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.post('/api/auth/totp/verify-setup', { totp_code: totpCode })
      setBackupCodes(res.data.backup_codes || [])
      setMfaStep('done')
      setTotpCode('')
      await refreshAuth()
    } catch (err) {
      setError(toUserMessage(err, 'Invalid code. Try again.'))
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  async function handleDisable() {
    setError(null)
    setLoading(true)
    try {
      await api.post('/api/auth/totp/disable')
      setMfaStep('idle')
      setSetupData(null)
      setBackupCodes(null)
      await refreshAuth()
    } catch (err) {
      setError(toUserMessage(err, 'Failed to disable MFA'))
    } finally {
      setLoading(false)
    }
  }

  async function handleRegenerateCodes(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.post('/api/auth/totp/regenerate-backup-codes', { totp_code: totpCode })
      setBackupCodes(res.data.backup_codes || [])
      setMfaStep('done')
      setTotpCode('')
    } catch (err) {
      setError(toUserMessage(err, 'Invalid TOTP code'))
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  function handleCancelSetup() {
    setMfaStep('idle')
    setSetupData(null)
    setBackupCodes(null)
    setTotpCode('')
    setError(null)
  }

  return (
    <Card id="mfa-settings" style={{ marginTop: '1.2rem' }}>
      <CardHeader
        title="Two-Factor Authentication"
        subtitle={mfaEnabled ? 'MFA is enabled for your account.' : 'Add an extra layer of security to your account.'}
        action={mfaEnabled ? <Badge tone="ok">Enabled</Badge> : <Badge tone="warn">Disabled</Badge>}
      />

      {error && <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div>}

      {/* Idle state — show enable/disable buttons */}
      {mfaStep === 'idle' && !mfaEnabled && (
        <div>
          <p className="muted" style={{ marginBottom: 12 }}>
            Protect your account with a TOTP authenticator app (Google Authenticator, Authy, etc.).
          </p>
          <button onClick={handleStartSetup} disabled={loading}>
            {loading ? 'Starting...' : 'Set Up MFA'}
          </button>
        </div>
      )}

      {mfaStep === 'idle' && mfaEnabled && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setMfaStep('regenerate')} disabled={loading}>
            Regenerate Backup Codes
          </button>
          <button className="secondary" onClick={handleDisable} disabled={loading} style={{ color: 'var(--danger, #dc2626)' }}>
            {loading ? 'Disabling...' : 'Disable MFA'}
          </button>
        </div>
      )}

      {/* Setup step — show QR code and secret */}
      {mfaStep === 'setup' && setupData && (
        <div>
          <p className="muted" style={{ marginBottom: 12 }}>
            Scan the QR code or enter the secret key in your authenticator app, then enter the 6-digit code below.
          </p>
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ padding: 12, background: 'var(--surface, #fff)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)' }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupData.provisioning_uri)}`}
                alt="TOTP QR Code"
                width={200}
                height={200}
              />
            </div>
            <div>
              <div className="kicker" style={{ marginBottom: 4 }}>Secret Key (manual entry)</div>
              <code style={{ fontFamily: 'monospace', fontSize: '0.85em', wordBreak: 'break-all', display: 'block', padding: 8, background: 'var(--bg-alt, #f9fafb)', borderRadius: 4 }}>
                {setupData.secret}
              </code>
            </div>
          </div>

          <form onSubmit={handleVerifySetup} style={{ maxWidth: 320 }}>
            <label className="grid" style={{ gap: 6, marginBottom: 12 }}>
              <span className="kicker">Verification Code</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                autoComplete="one-time-code"
                required
                style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.1em' }}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={totpCode.length !== 6 || loading}>
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </button>
              <button type="button" className="secondary" onClick={handleCancelSetup}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Regenerate backup codes step */}
      {mfaStep === 'regenerate' && (
        <div>
          <p className="muted" style={{ marginBottom: 12 }}>
            Enter your current TOTP code to generate new backup codes. Old codes will be invalidated.
          </p>
          <form onSubmit={handleRegenerateCodes} style={{ maxWidth: 320 }}>
            <label className="grid" style={{ gap: 6, marginBottom: 12 }}>
              <span className="kicker">Current TOTP Code</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                autoComplete="one-time-code"
                required
                style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.1em' }}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={totpCode.length !== 6 || loading}>
                {loading ? 'Generating...' : 'Regenerate Codes'}
              </button>
              <button type="button" className="secondary" onClick={handleCancelSetup}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Done — show backup codes */}
      {mfaStep === 'done' && backupCodes && (
        <div>
          <div style={{ padding: 16, background: 'var(--warn-bg, #fffbeb)', border: '1px solid var(--warn-border, #fde68a)', borderRadius: 8, marginBottom: 16 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Save these backup codes</strong>
            <p className="muted" style={{ marginBottom: 12, fontSize: '0.9em' }}>
              Each code can only be used once. Store them in a safe place. If you lose your authenticator device, these are your only way back in.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, fontFamily: 'monospace', fontSize: '0.95em' }}>
              {backupCodes.map((code, i) => (
                <div key={i} style={{ padding: '4px 8px', background: 'var(--bg-alt, #f9fafb)', borderRadius: 4 }}>
                  {code}
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => { setMfaStep('idle'); setBackupCodes(null) }}>
            Done, I've saved them
          </button>
        </div>
      )}
    </Card>
  )
}


function WhatsAppSettingsCard() {
  const { user, refreshAuth } = useAuth()
  const [optedIn, setOptedIn] = useState(false)
  const [number, setNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) return
    setOptedIn(!!user.whatsapp_opted_in)
    setNumber(user.whatsapp_number || '')
  }, [user])

  async function handleOptIn(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const trimmed = number.trim()
    if (!trimmed || trimmed.length < 7) {
      setError('Please enter a valid WhatsApp number (min 7 digits).')
      return
    }
    setSaving(true)
    try {
      await api.post('/api/notifications/whatsapp/opt-in', { whatsapp_number: trimmed })
      setOptedIn(true)
      setNotice('WhatsApp notifications enabled.')
      await refreshAuth()
    } catch (err) {
      setError(toUserMessage(err, 'Failed to enable WhatsApp notifications'))
    } finally {
      setSaving(false)
    }
  }

  async function handleOptOut() {
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      await api.post('/api/notifications/whatsapp/opt-out')
      setOptedIn(false)
      setNumber('')
      setNotice('WhatsApp notifications disabled.')
      await refreshAuth()
    } catch (err) {
      setError(toUserMessage(err, 'Failed to disable WhatsApp notifications'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card id="whatsapp-settings" style={{ marginTop: '1.2rem' }}>
      <CardHeader
        title="WhatsApp Notifications"
        subtitle={optedIn ? 'You will receive notifications via WhatsApp.' : 'Get notified on WhatsApp for important updates.'}
        action={optedIn ? <Badge tone="ok">Enabled</Badge> : <Badge tone="muted">Disabled</Badge>}
      />

      {error && <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div>}
      {notice && <div className="card notice tight" style={{ marginBottom: '0.8rem' }}>{notice}</div>}

      {!optedIn ? (
        <form onSubmit={handleOptIn} style={{ maxWidth: 400 }}>
          <label className="grid" style={{ gap: 6, marginBottom: 12 }}>
            <span className="kicker">WhatsApp Number</span>
            <input
              type="tel"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="+254 712 345 678"
              required
              minLength={7}
              maxLength={20}
            />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? 'Enabling...' : 'Enable WhatsApp Notifications'}
          </button>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            By opting in, you consent to receive operational notifications via WhatsApp.
          </div>
        </form>
      ) : (
        <div>
          <div style={{ marginBottom: 12 }}>
            <span className="kicker">Number: </span>
            <span>{number || 'Not set'}</span>
          </div>
          <button className="secondary" onClick={handleOptOut} disabled={saving} style={{ color: 'var(--danger, #dc2626)' }}>
            {saving ? 'Disabling...' : 'Disable WhatsApp Notifications'}
          </button>
        </div>
      )}
    </Card>
  )
}
