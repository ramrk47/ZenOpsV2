import React, { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { isDemoMode } from '../config/featureFlags'
import BrandLogo from '../components/BrandLogo'
import DemoMarker from '../components/DemoMarker'
import Badge from '../components/ui/Badge'

export default function Login() {
  const { login, mfaPending, verifyMfa, verifyMfaBackup, cancelMfa } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [backupCode, setBackupCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const demoMode = isDemoMode()

  function applyDemoCreds(nextEmail, nextPassword) {
    setEmail(nextEmail)
    setPassword(nextPassword)
    setError(null)
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err.message || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  async function handleMfaVerify(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await verifyMfa(totpCode)
    } catch (err) {
      setError(err.message || 'Invalid verification code')
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  async function handleBackupCodeVerify(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await verifyMfaBackup(backupCode)
    } catch (err) {
      setError(err.message || 'Invalid backup code')
      setBackupCode('')
    } finally {
      setLoading(false)
    }
  }

  function handleBackToLogin() {
    cancelMfa()
    setError(null)
    setTotpCode('')
    setBackupCode('')
    setPassword('')
    setUseBackup(false)
  }

  function toggleBackupMode() {
    setUseBackup(!useBackup)
    setError(null)
    setTotpCode('')
    setBackupCode('')
  }

  // MFA verification step — backup code mode
  if (mfaPending && useBackup) {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <BrandLogo variant="auth-compact" className="auth-brand" />
          <h2 className="auth-title">Use Backup Code</h2>
          <div className="muted auth-subtitle">
            Enter one of your recovery codes (e.g. ABCD-EFGH)
          </div>

          <form onSubmit={handleBackupCodeVerify} className="grid">
            <label className="grid">
              <span className="muted">Backup Code</span>
              <input
                type="text"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                autoFocus
                autoComplete="off"
                required
                className="auth-code-input"
              />
            </label>

            {error ? (
              <div className="badge danger" role="alert">
                {error}
              </div>
            ) : null}

            <button type="submit" disabled={backupCode.length < 4 || loading}>
              {loading ? 'Verifying...' : 'Verify Backup Code'}
            </button>

            <button
              type="button"
              className="ghost"
              onClick={toggleBackupMode}
            >
              Use authenticator app instead
            </button>

            <button
              type="button"
              className="secondary"
              onClick={handleBackToLogin}
            >
              Back to login
            </button>
          </form>
        </div>
      </div>
    )
  }

  // MFA verification step — TOTP mode
  if (mfaPending) {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <BrandLogo variant="auth-compact" className="auth-brand" />
          <h2 className="auth-title">Two-Factor Authentication</h2>
          <div className="muted auth-subtitle">
            Enter the 6-digit code from your authenticator app
          </div>

          <form onSubmit={handleMfaVerify} className="grid">
            <label className="grid">
              <span className="muted">Verification Code</span>
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
                className="auth-code-input totp"
              />
            </label>

            {error ? (
              <div className="badge danger" role="alert">
                {error}
              </div>
            ) : null}

            <button type="submit" disabled={totpCode.length !== 6 || loading}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>

            <button
              type="button"
              className="ghost"
              onClick={toggleBackupMode}
            >
              Lost your device? Use a backup code
            </button>

            <button
              type="button"
              className="secondary"
              onClick={handleBackToLogin}
            >
              Back to login
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Standard login form
  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <BrandLogo variant="auth" showCredit className="auth-brand" />
        <h2 className="auth-title">Sign In</h2>
        <div className="muted auth-subtitle">
          Work OS for valuation operations
        </div>
        <DemoMarker variant="public" className="auth-demo-marker" />

        <form onSubmit={handleLogin} className="grid">
          <label className="grid">
            <span className="muted">Email</span>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="username"
              required
            />
          </label>

          <label className="grid">
            <span className="muted">Password</span>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>

          {error ? (
            <div className="badge danger" role="alert">
              {error}
            </div>
          ) : null}

          <button type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {demoMode ? (
          <div className="demo-login-panel">
            <div className="demo-login-panel-head">
              <div className="metric-card-kicker">Demo Workspace</div>
              <div className="demo-login-panel-tags">
                <Badge tone="info">Admin</Badge>
                <Badge tone="info">Field</Badge>
                <Badge tone="ok">Associate</Badge>
                <Badge tone="warn">More roles coming soon</Badge>
              </div>
            </div>
            <div className="muted">
              Public demo users are pre-seeded here. Pick a role to autofill the login form.
            </div>
            <div className="demo-credential-grid">
              <button
                type="button"
                className="demo-credential-card"
                onClick={() => applyDemoCreds('admin@maulya.local', 'password')}
              >
                <span className="demo-credential-title">Login as Admin (demo)</span>
                <span className="demo-credential-copy">Full approvals and finance walkthrough</span>
                <span className="table-meta">admin@maulya.local / password</span>
              </button>
              <button
                type="button"
                className="demo-credential-card"
                onClick={() => applyDemoCreds('field@maulya.local', 'password')}
              >
                <span className="demo-credential-title">Login as Field User (demo)</span>
                <span className="demo-credential-copy">Create assignments and work the delivery flow</span>
                <span className="table-meta">field@maulya.local / password</span>
              </button>
              <button
                type="button"
                className="demo-credential-card"
                onClick={() => applyDemoCreds('associate@maulya.local', 'password')}
              >
                <span className="demo-credential-title">Login as Associate (demo)</span>
                <span className="demo-credential-copy">Explore the partner-facing workspace and uploads journey</span>
                <span className="table-meta">associate@maulya.local / password</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
