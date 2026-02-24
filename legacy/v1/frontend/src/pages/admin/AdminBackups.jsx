import React, { useEffect, useMemo, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import InfoTip from '../../components/ui/InfoTip'
import { fetchBackups, triggerBackup, backupDownloadUrl } from '../../api/backups'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`
}

export default function AdminBackups() {
  const [payload, setPayload] = useState({ files: [], status: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pin, setPin] = useState('')
  const [triggering, setTriggering] = useState(false)
  const [message, setMessage] = useState(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchBackups()
      setPayload(data || { files: [], status: null })
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to load backups'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const tierFiles = useMemo(
    () => payload.files.filter((file) => file.location === 'tier'),
    [payload.files],
  )

  const baseFiles = useMemo(
    () => payload.files.filter((file) => file.location === 'base'),
    [payload.files],
  )

  const statusTone = payload.status?.state === 'success'
    ? 'ok'
    : payload.status?.state === 'failed'
      ? 'danger'
      : payload.status?.state === 'running'
        ? 'info'
        : 'muted'

  const triggerBackupNow = async () => {
    setTriggering(true)
    setMessage(null)
    try {
      await triggerBackup(pin)
      setMessage('Backup request queued. Refresh in a minute to see status.')
      setPin('')
      refresh()
    } catch (err) {
      setMessage(toUserMessage(err, 'Failed to trigger backup'))
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Backups"
        subtitle="Monitor, verify, and trigger backup runs. Requires admin role and a backup PIN."
        actions={<Badge tone={statusTone}>{payload.status?.state || 'idle'}</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div> : null}
      {message ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{message}</div> : null}

      <div className="grid cols-3" style={{ marginBottom: '0.9rem' }}>
        <div className="card tight">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="kicker">Last Run</div>
            <InfoTip text="Timestamp from the latest backup status." />
          </div>
          <div className="stat-value">
            {payload.status?.finished_at ? formatDateTime(payload.status.finished_at) : '—'}
          </div>
        </div>
        <div className="card tight">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="kicker">Tiered Sets</div>
            <InfoTip text="Daily A/B + weekly + fortnightly + monthly." />
          </div>
          <div className="stat-value">{tierFiles.length}</div>
        </div>
        <div className="card tight">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="kicker">Recent Files</div>
            <InfoTip text="Timestamped backups retained locally." />
          </div>
          <div className="stat-value">{baseFiles.length}</div>
        </div>
      </div>

      <Card style={{ marginBottom: '0.9rem' }}>
        <CardHeader
          title="Trigger Backup"
          subtitle="Requires admin session + backup PIN."
          action={(
            <button type="button" className="secondary" onClick={refresh}>
              Refresh
            </button>
          )}
        />
        <div className="toolbar">
          <input
            type="password"
            placeholder="Backup PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <button
            type="button"
            className="primary"
            onClick={triggerBackupNow}
            disabled={!pin || triggering}
          >
            {triggering ? 'Requesting…' : 'Run Backup Now'}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            Status updates within 30–60 seconds.
          </span>
        </div>
      </Card>

      <Card style={{ marginBottom: '0.9rem' }}>
        <CardHeader
          title="Tiered Backups (Drive)"
          subtitle="These are the five rotating backup sets."
        />
        {loading ? (
          <ListSkeleton rows={4} />
        ) : tierFiles.length === 0 ? (
          <EmptyState>No tiered backups found yet.</EmptyState>
        ) : (
          <div className="list">
            {tierFiles.map((file) => (
              <div key={`${file.location}-${file.name}`} className="list-item" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{file.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {file.kind ? titleCase(file.kind) : 'file'} · {file.tier ? titleCase(file.tier) : '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12 }}>{formatBytes(file.size_bytes)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(file.modified_at)}</div>
                  <a className="link-button" href={backupDownloadUrl(file.name)} target="_blank" rel="noreferrer">
                    Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Recent Local Backups"
          subtitle="Timestamped backups retained locally for quick restores."
        />
        {loading ? (
          <ListSkeleton rows={4} />
        ) : baseFiles.length === 0 ? (
          <EmptyState>No local backups found yet.</EmptyState>
        ) : (
          <div className="list">
            {baseFiles.map((file) => (
              <div key={`${file.location}-${file.name}`} className="list-item" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{file.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {file.kind ? titleCase(file.kind) : 'file'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12 }}>{formatBytes(file.size_bytes)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(file.modified_at)}</div>
                  <a className="link-button" href={backupDownloadUrl(file.name)} target="_blank" rel="noreferrer">
                    Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function ListSkeleton({ rows = 4 }) {
  return (
    <div className="list">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={`sk-${idx}`} className="list-item" style={{ display: 'grid', gap: 6 }}>
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
      ))}
    </div>
  )
}
