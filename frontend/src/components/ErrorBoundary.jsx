import React from 'react'
import axios from 'axios'

/**
 * Error Boundary component to catch JavaScript errors in child component tree.
 * Prevents crashes from propagating and displays a fallback UI.
 * Logs errors to backend for centralized monitoring.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
    
    // Send error to backend
    this.logErrorToBackend(error, errorInfo)
  }

  logErrorToBackend = async (error, errorInfo) => {
    try {
      const payload = {
        message: error?.message || error?.toString() || 'Unknown error',
        stack: errorInfo?.componentStack || error?.stack || '',
        route: window.location.pathname,
        user_agent: navigator.userAgent,
        build_version: import.meta.env.VITE_BUILD_VERSION || 'dev',
        component: errorInfo?.componentStack?.split('\n')[1]?.trim() || 'unknown',
        severity: 'error',
        metadata: {
          href: window.location.href,
          timestamp: new Date().toISOString(),
        },
      }

      await axios.post('/api/client-logs', payload, {
        timeout: 5000,
        // Don't use auth token (error might happen before auth)
      })
    } catch (err) {
      // Silently fail - don't want logging error to cause more errors
      console.error('Failed to log error to backend:', err)
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 16px' }}>Something went wrong</h2>
          <p style={{ color: '#666', marginBottom: 24 }}>
            An unexpected error occurred. Our team has been notified. Please try refreshing the page.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 20px',
                background: '#1976d2',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Refresh Page
            </button>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 20px',
                background: '#eee',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre style={{
              marginTop: 24,
              padding: 16,
              background: '#fee',
              borderRadius: 6,
              textAlign: 'left',
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 200,
            }}>
              {this.state.error.toString()}
              {this.state.errorInfo?.componentStack}
            </pre>
          )}
        </div>
      )
    }

    return this.props.children
  }
}

