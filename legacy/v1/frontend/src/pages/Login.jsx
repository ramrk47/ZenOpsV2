import React, { useState } from 'react'
import { useAuth } from '../auth/AuthContext'

export default function Login() {
  const { login, mfaPending, verifyMfa, verifyMfaBackup, cancelMfa } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [backupCode, setBackupCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

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
          <div className="kicker">Zen Ops</div>
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
          <div className="kicker">Zen Ops</div>
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
        <div className="kicker">Zen Ops</div>
        <h2 className="auth-title">Zen Ops</h2>
        <div className="muted auth-subtitle">
          Work OS for valuation operations
        </div>

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
      </div>
    </div>
  )
}
