import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { resolveStepUp, rejectStepUp, toUserMessage } from '../api/client'
import { resolveHomeRoute } from '../utils/rbac'
import IdleWarningModal from '../components/IdleWarningModal'
import StepUpMFAModal from '../components/StepUpMFAModal'

const AuthContext = createContext()

// ── Session / idle constants ───────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const IDLE_WARNING_SECONDS  = 60             // show modal 60 s before timeout
const IDLE_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [capabilities, setCapabilities] = useState({})
  const [initialising, setInitialising] = useState(true)
  const [mfaPending, setMfaPending] = useState(null) // { mfa_token, user }
  const [showIdleWarning, setShowIdleWarning] = useState(false)
  const [showStepUp, setShowStepUp] = useState(false)
  const navigate = useNavigate()
  const useCookieAuth = import.meta.env.VITE_USE_COOKIE_AUTH === 'true'

  // Refs for idle / heartbeat timers
  const lastActivityRef = useRef(Date.now())
  const idleTimerRef = useRef(null)
  const heartbeatRef = useRef(null)
  const logoutInProgressRef = useRef(false)
  const authEpochRef = useRef(0)

  const clearLocalAuthState = useCallback(() => {
    localStorage.removeItem('token')
    sessionStorage.removeItem('step_up_token')
    setUser(null)
    setCapabilities({})
    setMfaPending(null)
    setShowIdleWarning(false)
    clearTimeout(idleTimerRef.current)
    clearInterval(heartbeatRef.current)
  }, [])

  // Listen for step-up MFA challenge events from the API interceptor
  useEffect(() => {
    const handler = () => setShowStepUp(true)
    window.addEventListener('step-up-required', handler)
    return () => window.removeEventListener('step-up-required', handler)
  }, [])

  async function refreshAuth({ allowAnonymous = false } = {}) {
    const epoch = authEpochRef.current
    try {
      const [me, caps] = await Promise.all([
        api.get('/api/auth/me'),
        api.get('/api/auth/capabilities'),
      ])
      if (logoutInProgressRef.current || epoch !== authEpochRef.current) return false
      setUser(me.data)
      setCapabilities(caps.data?.capabilities || {})
      return true
    } catch (err) {
      console.error(err)
      if (!allowAnonymous) {
        if (!logoutInProgressRef.current) logout()
      }
      else {
        if (logoutInProgressRef.current || epoch !== authEpochRef.current) return false
        setUser(null)
        setCapabilities({})
      }
      return false
    } finally {
      if (epoch === authEpochRef.current) setInitialising(false)
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('token')
    const shouldAttempt = Boolean(token) || useCookieAuth
    if (shouldAttempt) refreshAuth({ allowAnonymous: !token })
    else setInitialising(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function login(email, password) {
    try {
      const data = new URLSearchParams()
      data.append('username', email)
      data.append('password', password)
      const res = await api.post('/api/auth/login', data)

      // Check if MFA is required
      if (res.data.mfa_required && res.data.mfa_token) {
        logoutInProgressRef.current = false
        setMfaPending({ mfa_token: res.data.mfa_token, user: res.data.user })
        return { mfaRequired: true }
      }

      // No MFA — complete login
      logoutInProgressRef.current = false
      authEpochRef.current += 1
      if (!useCookieAuth) localStorage.setItem('token', res.data.access_token)
      if (res.data.user) setUser(res.data.user)
      if (res.data.capabilities) setCapabilities(res.data.capabilities)
      refreshAuth({ allowAnonymous: false })
      const next = resolveHomeRoute(res.data.user, res.data.capabilities)
      navigate(next)
      return { mfaRequired: false }
    } catch (err) {
      throw new Error(toUserMessage(err, 'Invalid email or password'))
    }
  }

  async function verifyMfa(totpCode) {
    if (!mfaPending) throw new Error('No MFA session pending')
    try {
      const res = await api.post('/api/auth/mfa/verify', {
        mfa_token: mfaPending.mfa_token,
        totp_code: totpCode,
      })

      logoutInProgressRef.current = false
      authEpochRef.current += 1
      if (!useCookieAuth) localStorage.setItem('token', res.data.access_token)
      if (res.data.user) setUser(res.data.user)
      if (res.data.capabilities) setCapabilities(res.data.capabilities)
      setMfaPending(null)
      refreshAuth({ allowAnonymous: false })
      const next = resolveHomeRoute(res.data.user, res.data.capabilities)
      navigate(next)
    } catch (err) {
      throw new Error(toUserMessage(err, 'Invalid TOTP code'))
    }
  }

  async function verifyMfaBackup(backupCode) {
    if (!mfaPending) throw new Error('No MFA session pending')
    try {
      const res = await api.post('/api/auth/mfa/verify-backup', {
        mfa_token: mfaPending.mfa_token,
        backup_code: backupCode,
      })

      logoutInProgressRef.current = false
      authEpochRef.current += 1
      if (!useCookieAuth) localStorage.setItem('token', res.data.access_token)
      if (res.data.user) setUser(res.data.user)
      if (res.data.capabilities) setCapabilities(res.data.capabilities)
      setMfaPending(null)
      refreshAuth({ allowAnonymous: false })
      const next = resolveHomeRoute(res.data.user, res.data.capabilities)
      navigate(next)
    } catch (err) {
      throw new Error(toUserMessage(err, 'Invalid backup code'))
    }
  }

  function cancelMfa() {
    setMfaPending(null)
  }

  const logout = useCallback(async () => {
    if (logoutInProgressRef.current) return
    const token = localStorage.getItem('token')
    const logoutUrl = `${api.defaults.baseURL || ''}/api/auth/logout`
    logoutInProgressRef.current = true
    authEpochRef.current += 1
    clearLocalAuthState()

    // Best-effort server-side token revocation after local teardown.
    try {
      await fetch(logoutUrl, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
    } catch {
      // Ignore — local teardown + redirect is the safety net.
    }
    navigate('/login', { replace: true })
    window.setTimeout(() => {
      if (window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }, 150)
    window.setTimeout(() => {
      logoutInProgressRef.current = false
    }, 800)
  }, [clearLocalAuthState, navigate])

  useEffect(() => {
    const interceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error?.response?.status === 401) {
          if (logoutInProgressRef.current) {
            return Promise.reject(error)
          }
          const detail = error?.response?.data?.detail
          if (detail === 'session_expired') {
            console.warn('[session] expired — logging out')
          }
          logout()
        }
        return Promise.reject(error)
      },
    )
    return () => api.interceptors.response.eject(interceptor)
  }, [logout])

  // ── Heartbeat — refresh token every 5 min while logged in ──────────
  useEffect(() => {
    if (!user || logoutInProgressRef.current) return
    async function sendHeartbeat() {
      if (logoutInProgressRef.current) return
      try {
        const res = await api.post('/api/auth/heartbeat')
        if (res.data?.access_token && !useCookieAuth) {
          localStorage.setItem('token', res.data.access_token)
        }
      } catch (err) {
        // 401 will be caught by the interceptor above → auto-logout
        console.warn('[heartbeat] failed', err?.response?.status)
      }
    }
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(heartbeatRef.current)
  }, [user, useCookieAuth])

  // ── Idle detection — show warning modal before auto-logout ─────────
  useEffect(() => {
    if (!user) return

    // Determine timeout from role (mirror backend settings)
    const roles = user.roles || [user.role]
    const isAdmin = roles.some((r) =>
      ['ADMIN', 'OPS_MANAGER', 'HR', 'FINANCE'].includes(r),
    )
    const idleTimeoutMs = (isAdmin ? 30 : 120) * 60 * 1000
    const warningAtMs = idleTimeoutMs - IDLE_WARNING_SECONDS * 1000

    function resetIdleTimer() {
      lastActivityRef.current = Date.now()
      setShowIdleWarning(false)
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        setShowIdleWarning(true)
      }, warningAtMs)
    }

    // Attach activity listeners
    IDLE_EVENTS.forEach((evt) => window.addEventListener(evt, resetIdleTimer, { passive: true }))
    resetIdleTimer() // start the timer

    return () => {
      IDLE_EVENTS.forEach((evt) => window.removeEventListener(evt, resetIdleTimer))
      clearTimeout(idleTimerRef.current)
    }
  }, [user])

  // Handlers for the warning modal
  const handleStayLoggedIn = useCallback(async () => {
    if (logoutInProgressRef.current) return
    setShowIdleWarning(false)
    lastActivityRef.current = Date.now()
    // Fire an immediate heartbeat to refresh the token
    try {
      const res = await api.post('/api/auth/heartbeat')
      if (res.data?.access_token && !useCookieAuth) {
        localStorage.setItem('token', res.data.access_token)
      }
    } catch { /* interceptor handles 401 */ }
  }, [useCookieAuth])

  const value = useMemo(
    () => ({
      user,
      capabilities,
      login,
      logout,
      api,
      initialising,
      refreshAuth,
      mfaPending,
      verifyMfa,
      verifyMfaBackup,
      cancelMfa,
    }),
    [user, capabilities, initialising, logout, mfaPending],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      {showIdleWarning && user && (
        <IdleWarningModal
          secondsLeft={IDLE_WARNING_SECONDS}
          onStayLoggedIn={handleStayLoggedIn}
          onLogout={logout}
        />
      )}
      {showStepUp && (
        <StepUpMFAModal
          onSuccess={(token) => {
            setShowStepUp(false)
            resolveStepUp(token)
          }}
          onCancel={() => {
            setShowStepUp(false)
            rejectStepUp()
          }}
        />
      )}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
