/**
 * Sentry integration for Zen Ops frontend.
 * 
 * This module initializes Sentry for error tracking and performance monitoring.
 * It only activates if VITE_SENTRY_DSN environment variable is set.
 */

import * as Sentry from '@sentry/react'

// Get configuration from environment
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
const ENVIRONMENT = import.meta.env.VITE_ENVIRONMENT || 'development'
const RELEASE = import.meta.env.VITE_GIT_SHA || import.meta.env.VITE_VERSION || 'unknown'

/**
 * Initialize Sentry if DSN is configured.
 */
export function initSentry() {
  if (!SENTRY_DSN) {
    console.log('[Sentry] DSN not configured, skipping initialization')
    return false
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: ENVIRONMENT,
      release: `zenops-frontend@${RELEASE}`,
      
      // Performance monitoring
      tracesSampleRate: ENVIRONMENT === 'production' ? 0.1 : 1.0,
      
      // Session replay (optional, set to 0 to disable)
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: ENVIRONMENT === 'production' ? 0.1 : 0,
      
      // Filtering
      beforeSend(event, hint) {
        // Filter out common noise
        const error = hint?.originalException
        if (error?.message) {
          // Ignore network errors that are user-caused
          if (error.message.includes('Network Error')) {
            return null
          }
          // Ignore cancelled requests
          if (error.message.includes('Request aborted')) {
            return null
          }
        }
        return event
      },
      
      // Integrations
      integrations: [
        // Browser tracing for performance
        new Sentry.BrowserTracing({
          // Trace all API calls
          traceFetch: true,
          traceXHR: true,
        }),
      ],
    })
    
    console.log(`[Sentry] Initialized for ${ENVIRONMENT} (release: ${RELEASE})`)
    return true
  } catch (error) {
    console.error('[Sentry] Failed to initialize:', error)
    return false
  }
}

/**
 * Capture an exception with optional context.
 */
export function captureException(error, context = {}) {
  if (!SENTRY_DSN) return
  
  Sentry.captureException(error, {
    extra: context,
  })
}

/**
 * Capture a message with optional level.
 */
export function captureMessage(message, level = 'info') {
  if (!SENTRY_DSN) return
  
  Sentry.captureMessage(message, level)
}

/**
 * Set user context for error tracking.
 */
export function setUser(user) {
  if (!SENTRY_DSN) return
  
  if (user) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    })
  } else {
    Sentry.setUser(null)
  }
}

/**
 * Add breadcrumb for debugging.
 */
export function addBreadcrumb(message, category = 'app', level = 'info', data = {}) {
  if (!SENTRY_DSN) return
  
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
  })
}

/**
 * Error boundary component for React.
 */
export const ErrorBoundary = Sentry.ErrorBoundary

export default Sentry
