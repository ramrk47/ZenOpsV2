# Technical Specification: Support + Email + WhatsApp System

**Version**: 1.0  
**Date**: 2026-02-09  
**Status**: DRAFT - Awaiting Approval

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Backend Implementation](#backend-implementation)
5. [Frontend Implementation](#frontend-implementation)
6. [Configuration Management](#configuration-management)
7. [Security Considerations](#security-considerations)
8. [Testing Strategy](#testing-strategy)
9. [Deployment Plan](#deployment-plan)
10. [File Structure](#file-structure)

---

## 1. Overview

### Goals
- **Email**: Robust Resend integration with audit trail
- **Support System**: Internal ticket system for external partner queries
- **WhatsApp**: Click-to-chat integration (no API/cost)
- **Config UI**: Admin interface for managing API keys securely

### Key Requirements
- ✅ NO hardcoded API keys in code
- ✅ NO .env file modifications in code
- ✅ NO secrets exposed to frontend
- ✅ NO destructive database operations
- ✅ Expand-only migrations

---

## 2. Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND LAYER                          │
├─────────────────────────────────────────────────────────────┤
│  External Portal          │  Internal Console               │
│  - WhatsApp Bubble        │  - Support Inbox                │
│  - Raise Query Modal      │  - Thread Management            │
│  - Thread View            │  - Config UI (Admin)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     API LAYER                               │
├─────────────────────────────────────────────────────────────┤
│  /api/portal/support/*    │  /api/support/*                 │
│  /api/admin/config/*      │  /api/support/link-tokens/*     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   SERVICE LAYER                             │
├─────────────────────────────────────────────────────────────┤
│  email_service.py         │  support_service.py             │
│  support_token.py         │  config_service.py              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   DATA LAYER                                │
├─────────────────────────────────────────────────────────────┤
│  SupportThread            │  SystemConfig                   │
│  SupportMessage           │  EmailDeliveryLog               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              BACKGROUND WORKERS                             │
├─────────────────────────────────────────────────────────────┤
│  email_worker.py (existing, enhanced)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema

### 3.1 SystemConfig Table (NEW)

**Purpose**: Store sensitive configuration (API keys, settings) in database instead of .env

```sql
CREATE TABLE system_config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,  -- Encrypted for sensitive values
    is_encrypted BOOLEAN DEFAULT FALSE,
    is_public BOOLEAN DEFAULT FALSE,  -- Can be exposed to frontend
    description TEXT,
    updated_by_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_system_config_key ON system_config(key);
CREATE INDEX idx_system_config_public ON system_config(is_public) WHERE is_public = TRUE;

-- Initial data
INSERT INTO system_config (key, value, is_encrypted, is_public, description) VALUES
('EMAIL_API_KEY', NULL, TRUE, FALSE, 'Resend API key (server-side only)'),
('EMAIL_FROM', 'noreply@zenops.com', FALSE, FALSE, 'Email sender address'),
('EMAIL_PROVIDER', 'resend', FALSE, FALSE, 'Email provider (resend/postmark/smtp)'),
('WHATSAPP_NUMBER', '917975357599', FALSE, TRUE, 'WhatsApp contact number (digits only)'),
('OPS_SUPPORT_EMAIL', 'ops@zenops.com', FALSE, FALSE, 'Ops team email for support notifications');
```

**Key Features**:
- `is_encrypted`: Values encrypted at rest using Fernet (symmetric)
- `is_public`: Safe to expose to frontend (e.g., WhatsApp number)
- `updated_by_user_id`: Audit trail
- No secrets in .env or git

### 3.2 SupportThread Table (NEW)

```sql
CREATE TABLE support_threads (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_by_role VARCHAR(50) NOT NULL,  -- Role at time of creation
    
    -- Thread metadata
    subject VARCHAR(500) NOT NULL,
    status VARCHAR(50) DEFAULT 'OPEN',  -- OPEN, IN_PROGRESS, RESOLVED, CLOSED
    priority VARCHAR(50) DEFAULT 'NORMAL',  -- LOW, NORMAL, HIGH, URGENT
    channel VARCHAR(50) DEFAULT 'PORTAL',  -- PORTAL, WHATSAPP, EMAIL, PHONE
    
    -- Assignment context
    assignment_code VARCHAR(50),
    assignment_client_name VARCHAR(255),
    
    -- Tracking
    assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    last_message_at TIMESTAMP,
    closed_at TIMESTAMP,
    closed_by_user_id INTEGER REFERENCES users(id),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_support_threads_assignment ON support_threads(assignment_id);
CREATE INDEX idx_support_threads_creator ON support_threads(created_by_user_id);
CREATE INDEX idx_support_threads_status ON support_threads(status);
CREATE INDEX idx_support_threads_assigned ON support_threads(assigned_to_user_id);
CREATE INDEX idx_support_threads_created ON support_threads(created_at DESC);
```

**Enum Values**:
```python
class SupportThreadStatus(enum.StrEnum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"

class SupportThreadPriority(enum.StrEnum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    URGENT = "URGENT"

class SupportThreadChannel(enum.StrEnum):
    PORTAL = "PORTAL"
    WHATSAPP = "WHATSAPP"
    EMAIL = "EMAIL"
    PHONE = "PHONE"
```

### 3.3 SupportMessage Table (NEW)

```sql
CREATE TABLE support_messages (
    id SERIAL PRIMARY KEY,
    thread_id INTEGER NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
    
    -- Author (can be user or system)
    author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_label VARCHAR(255),  -- "John Doe (Partner)" or "System"
    is_internal BOOLEAN DEFAULT FALSE,  -- Internal notes vs customer-facing
    
    -- Content
    body TEXT NOT NULL,
    attachments_json JSONB,  -- [{name, url, size, type}, ...]
    
    -- Metadata
    sent_via VARCHAR(50) DEFAULT 'PORTAL',  -- PORTAL, EMAIL, WHATSAPP
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_support_messages_thread ON support_messages(thread_id, created_at);
CREATE INDEX idx_support_messages_author ON support_messages(author_user_id);
CREATE INDEX idx_support_messages_created ON support_messages(created_at DESC);
```

### 3.4 EmailDeliveryLog Table (NEW)

**Purpose**: Audit trail for all outbound emails

```sql
CREATE TABLE email_delivery_log (
    id SERIAL PRIMARY KEY,
    
    -- Event tracking
    event_type VARCHAR(100) NOT NULL,  -- SUPPORT_THREAD_CREATED, MENTION, etc.
    idempotency_key VARCHAR(255) UNIQUE,  -- Prevent duplicates
    
    -- Recipients
    to_email VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    cc_emails TEXT[],
    
    -- Content
    subject VARCHAR(500) NOT NULL,
    html_body TEXT,
    text_body TEXT,
    
    -- Delivery status
    status VARCHAR(50) DEFAULT 'QUEUED',  -- QUEUED, SENT, FAILED, BOUNCED
    provider VARCHAR(50),  -- resend, postmark, smtp
    provider_message_id VARCHAR(255),
    
    -- Retry tracking
    attempts INTEGER DEFAULT 0,
    last_attempt_at TIMESTAMP,
    next_retry_at TIMESTAMP,
    last_error TEXT,
    
    -- Context
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
    support_thread_id INTEGER REFERENCES support_threads(id) ON DELETE SET NULL,
    notification_id INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
    
    -- Metadata
    tags JSONB,  -- {category: "support", priority: "high"}
    metadata JSONB,  -- Additional context
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_email_delivery_status ON email_delivery_log(status);
CREATE INDEX idx_email_delivery_next_retry ON email_delivery_log(next_retry_at) WHERE status = 'QUEUED';
CREATE INDEX idx_email_delivery_user ON email_delivery_log(user_id);
CREATE INDEX idx_email_delivery_thread ON email_delivery_log(support_thread_id);
CREATE INDEX idx_email_delivery_idempotency ON email_delivery_log(idempotency_key);
CREATE INDEX idx_email_delivery_created ON email_delivery_log(created_at DESC);
```

**Enum Values**:
```python
class EmailDeliveryStatus(enum.StrEnum):
    QUEUED = "QUEUED"
    SENT = "SENT"
    FAILED = "FAILED"
    BOUNCED = "BOUNCED"
    DELIVERED = "DELIVERED"
```

---

## 4. Backend Implementation

### 4.1 Configuration Service

**File**: `backend/app/services/config_service.py`

```python
"""System configuration management with encryption."""
from typing import Any, Optional
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session
from app.models.system_config import SystemConfig
from app.core.settings import settings

# Encryption key from environment (not in DB)
ENCRYPTION_KEY = settings.config_encryption_key or Fernet.generate_key()
_cipher = Fernet(ENCRYPTION_KEY)

def get_config(db: Session, key: str, default: Any = None) -> Any:
    """Get config value, decrypting if needed."""
    
def set_config(db: Session, key: str, value: Any, 
               is_encrypted: bool = False, 
               updated_by_user_id: int = None) -> SystemConfig:
    """Set config value, encrypting if needed."""
    
def get_public_config(db: Session) -> dict:
    """Get all public config values (safe for frontend)."""
    
def refresh_config_cache():
    """Reload config from DB (called after admin updates)."""
```

### 4.2 Email Service

**File**: `backend/app/services/email_service.py`

```python
"""Enhanced email service with audit trail and idempotency."""
from typing import Optional, Dict, List
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.services import email  # Existing email module
from app.models.email_delivery_log import EmailDeliveryLog
from app.services.config_service import get_config

def send_email(
    db: Session,
    *,
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    event_type: str,
    idempotency_key: Optional[str] = None,
    tags: Optional[Dict] = None,
    metadata: Optional[Dict] = None,
    user_id: Optional[int] = None,
    assignment_id: Optional[int] = None,
    support_thread_id: Optional[int] = None,
) -> EmailDeliveryLog:
    """
    Send email with audit trail.
    
    - Checks idempotency_key to prevent duplicates
    - Logs to email_delivery_log
    - Queues for background sending if provider unavailable
    - Returns delivery log record
    """

def queue_email(...) -> EmailDeliveryLog:
    """Queue email for background worker processing."""

def retry_failed_emails(db: Session, max_age_hours: int = 24):
    """Retry failed emails (called by worker)."""
```

### 4.3 Support Service

**File**: `backend/app/services/support_service.py`

```python
"""Support thread management and notifications."""
from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.support_thread import SupportThread, SupportMessage
from app.models.user import User
from app.services.email_service import send_email
from app.services.notifications import create_notification

def create_support_thread(
    db: Session,
    *,
    created_by_user: User,
    assignment_id: Optional[int],
    subject: str,
    initial_message: str,
    channel: str = "PORTAL",
) -> SupportThread:
    """
    Create support thread and notify ops team.
    
    1. Create thread record
    2. Create initial message
    3. Send in-app notification to ops
    4. Queue email to OPS_SUPPORT_EMAIL
    5. Return thread
    """

def add_message_to_thread(
    db: Session,
    *,
    thread_id: int,
    author_user: User,
    body: str,
    attachments: Optional[List] = None,
    is_internal: bool = False,
) -> SupportMessage:
    """Add message to thread and notify relevant parties."""

def notify_ops_team(db: Session, thread: SupportThread):
    """Send notifications to ops team about new thread."""
```

### 4.4 Support Token Service

**File**: `backend/app/services/support_token.py`

```python
"""Signed tokens for external support access."""
from datetime import datetime, timedelta
from typing import Optional, Dict
from jose import jwt
from app.core.settings import settings

def create_support_link_token(
    assignment_id: int,
    external_user_id: int,
    assignment_code: str,
    exp_days: int = 7,
) -> str:
    """
    Create signed JWT token for external support access.
    
    Token payload:
    - assignment_id
    - external_user_id
    - assignment_code (for display)
    - exp (expiration)
    - iat (issued at)
    """
    
def verify_support_link_token(token: str) -> Optional[Dict]:
    """Verify and decode support token. Returns payload or None."""
```

### 4.5 API Routes

#### External Portal Routes
**File**: `backend/app/routers/portal_support.py`

```python
"""External partner support portal routes."""
from fastapi import APIRouter, Depends
from app.core.deps import get_current_user

router = APIRouter(prefix="/api/portal/support", tags=["portal-support"])

@router.get("/link-context")
def get_support_link_context(token: str):
    """Verify token and return assignment context for pre-fill."""

@router.post("/threads")
def create_support_thread(payload: CreateThreadRequest, token: str):
    """Create new support thread (external user)."""

@router.get("/threads")
def list_my_support_threads(
    assignment_id: Optional[int] = None,
    current_user: User = Depends(get_current_user)
):
    """List threads created by current user."""

@router.get("/threads/{thread_id}")
def get_support_thread(thread_id: int, current_user: User = Depends(...)):
    """Get thread details and messages."""

@router.post("/threads/{thread_id}/messages")
def add_message_to_thread(thread_id: int, payload: AddMessageRequest):
    """Add message to thread."""
```

#### Internal Support Routes
**File**: `backend/app/routers/support.py`

```python
"""Internal support management routes."""
from fastapi import APIRouter, Depends
from app.core.deps import get_current_user
from app.core import rbac

router = APIRouter(prefix="/api/support", tags=["support"])

@router.get("/threads")
@rbac.require_role([Role.ADMIN, Role.OPS_MANAGER])
def list_support_threads(
    status: Optional[str] = None,
    assignment_id: Optional[int] = None,
    priority: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
):
    """List all support threads (admin/ops)."""

@router.get("/threads/{thread_id}")
def get_support_thread_detail(thread_id: int):
    """Get full thread with messages."""

@router.patch("/threads/{thread_id}")
@rbac.require_role([Role.ADMIN, Role.OPS_MANAGER])
def update_support_thread(
    thread_id: int,
    payload: UpdateThreadRequest,
):
    """Update thread status, priority, assignee."""

@router.post("/threads/{thread_id}/messages")
def add_internal_message(thread_id: int, payload: AddMessageRequest):
    """Add message to thread (internal or external)."""

@router.post("/threads/{thread_id}/close")
@rbac.require_role([Role.ADMIN, Role.OPS_MANAGER])
def close_support_thread(thread_id: int):
    """Close thread."""
```

#### Admin Config Routes
**File**: `backend/app/routers/admin_config.py`

```python
"""Admin configuration management routes."""
from fastapi import APIRouter, Depends
from app.core.deps import get_current_user
from app.core import rbac

router = APIRouter(prefix="/api/admin/config", tags=["admin-config"])

@router.get("/")
@rbac.require_role([Role.ADMIN])
def list_config_items():
    """List all config items (masked sensitive values)."""

@router.get("/public")
def get_public_config():
    """Get public config (no auth required, safe for frontend)."""

@router.put("/{key}")
@rbac.require_role([Role.ADMIN])
def update_config_item(
    key: str,
    payload: UpdateConfigRequest,
    current_user: User = Depends(get_current_user),
):
    """Update config value. Triggers config reload."""

@router.post("/reload")
@rbac.require_role([Role.ADMIN])
def reload_config():
    """Force reload config from database."""

@router.post("/test-email")
@rbac.require_role([Role.ADMIN])
def test_email_config(to: str):
    """Send test email to verify configuration."""
```

---

## 5. Frontend Implementation

### 5.1 Utility Functions

**File**: `frontend/src/utils/whatsapp.js`

```javascript
/**
 * Build WhatsApp click-to-chat URL.
 * @param {string} phoneDigits - Phone number (digits only, international format)
 * @param {string} text - Pre-filled message text
 * @returns {string} WhatsApp URL
 */
export function buildWhatsAppLink(phoneDigits, text) {
  const cleanPhone = phoneDigits.replace(/[^0-9]/g, '')
  const encodedText = encodeURIComponent(text)
  return `https://wa.me/${cleanPhone}?text=${encodedText}`
}

/**
 * Build support WhatsApp message.
 * @param {string} assignmentCode - Assignment reference
 * @param {string} supportLink - Signed support link URL
 * @returns {string} Formatted message
 */
export function buildSupportWhatsAppMessage(assignmentCode, supportLink) {
  return `Hi, I need help with Assignment ${assignmentCode}.\n\nSupport Link: ${supportLink}`
}
```

**File**: `frontend/src/api/support.js`

```javascript
import api from './client'

export const getSupportLinkContext = (token) => {
  return api.get('/api/portal/support/link-context', { params: { token } })
}

export const createSupportThread = (data) => {
  return api.post('/api/portal/support/threads', data)
}

export const listMySupportThreads = (assignmentId = null) => {
  return api.get('/api/portal/support/threads', { 
    params: assignmentId ? { assignment_id: assignmentId } : {} 
  })
}

export const getSupportThread = (threadId) => {
  return api.get(`/api/portal/support/threads/${threadId}`)
}

export const addMessageToThread = (threadId, body, attachments = []) => {
  return api.post(`/api/portal/support/threads/${threadId}/messages`, {
    body,
    attachments
  })
}

// Internal routes
export const listAllSupportThreads = (filters = {}) => {
  return api.get('/api/support/threads', { params: filters })
}

export const updateSupportThread = (threadId, updates) => {
  return api.patch(`/api/support/threads/${threadId}`, updates)
}

export const closeSupportThread = (threadId) => {
  return api.post(`/api/support/threads/${threadId}/close`)
}
```

### 5.2 External Portal Components

**File**: `frontend/src/components/WhatsAppBubble.jsx`

```jsx
import React, { useEffect, useState } from 'react'
import { buildWhatsAppLink } from '../utils/whatsapp'
import api from '../api/client'

/**
 * Floating WhatsApp contact bubble.
 * Positioned bottom-right with WhatsApp icon.
 */
export default function WhatsAppBubble({ message = "Hi, I need help!" }) {
  const [whatsappNumber, setWhatsappNumber] = useState('917975357599')
  
  useEffect(() => {
    // Fetch from public config
    api.get('/api/admin/config/public')
      .then(({ data }) => {
        if (data.WHATSAPP_NUMBER) {
          setWhatsappNumber(data.WHATSAPP_NUMBER)
        }
      })
      .catch(console.error)
  }, [])
  
  const whatsappUrl = buildWhatsAppLink(whatsappNumber, message)
  
  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: '60px',
        height: '60px',
        borderRadius: '50%',
        background: '#25D366',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '32px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        zIndex: 1000,
        textDecoration: 'none',
      }}
      aria-label="Contact us on WhatsApp"
    >
      💬
    </a>
  )
}
```

**File**: `frontend/src/components/RaiseQueryModal.jsx`

```jsx
import React, { useState } from 'react'
import { createSupportThread } from '../api/support'
import { buildWhatsAppLink, buildSupportWhatsAppMessage } from '../utils/whatsapp'

/**
 * Modal for external users to raise support queries.
 * Shows after assignment selection.
 */
export default function RaiseQueryModal({ 
  isOpen, 
  onClose, 
  assignment,
  supportToken,
  onThreadCreated 
}) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdThread, setCreatedThread] = useState(null)
  
  // Subject templates
  const subjectOptions = [
    'Document Request',
    'Payment Query',
    'Timeline Clarification',
    'Report Issue',
    'General Query',
    'Other'
  ]
  
  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    
    try {
      const { data } = await createSupportThread({
        token: supportToken,
        subject,
        body: message,
        attachments: []
      })
      
      setCreatedThread(data)
      onThreadCreated?.(data)
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to create thread')
    } finally {
      setSubmitting(false)
    }
  }
  
  // Show success view with WhatsApp option
  if (createdThread) {
    const supportLink = `${window.location.origin}/support?token=${supportToken}&thread=${createdThread.id}`
    const whatsappMessage = buildSupportWhatsAppMessage(assignment.assignment_code, supportLink)
    const whatsappUrl = buildWhatsAppLink('917975357599', whatsappMessage)
    
    return (
      <div className="modal" style={{ display: isOpen ? 'block' : 'none' }}>
        <div className="modal-content">
          <h2>✅ Query Submitted</h2>
          <p>Thread #{createdThread.id} created. Our team will respond soon.</p>
          
          <div style={{ marginTop: '2rem' }}>
            <h3>Need immediate assistance?</h3>
            <a 
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
              style={{ background: '#25D366', color: 'white' }}
            >
              💬 Chat on WhatsApp
            </a>
            <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
              Reference: {assignment.assignment_code}
            </p>
          </div>
          
          <button onClick={onClose} style={{ marginTop: '2rem' }}>
            Close
          </button>
        </div>
      </div>
    )
  }
  
  // Show form
  return (
    <div className="modal" style={{ display: isOpen ? 'block' : 'none' }}>
      <div className="modal-content">
        <h2>Raise Support Query</h2>
        <p className="muted">Assignment: {assignment.assignment_code}</p>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Subject *</label>
            <select 
              value={subject} 
              onChange={e => setSubject(e.target.value)}
              required
            >
              <option value="">Select a topic...</option>
              {subjectOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>Message *</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={6}
              placeholder="Describe your query in detail..."
              required
            />
          </div>
          
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Query'}
            </button>
            <button type="button" onClick={onClose} className="ghost">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

**File**: `frontend/src/pages/partner/SupportThreadView.jsx`

```jsx
/**
 * View support thread with messages.
 * Shows conversation history + reply box.
 */
export default function SupportThreadView({ threadId }) {
  // Implementation details...
}
```

### 5.3 Internal Admin Components

**File**: `frontend/src/pages/admin/SupportInbox.jsx`

```jsx
/**
 * Internal support inbox for ops/admin.
 * Lists threads, filters, quick actions.
 */
export default function SupportInbox() {
  const [threads, setThreads] = useState([])
  const [filters, setFilters] = useState({ status: 'OPEN' })
  const [selectedThread, setSelectedThread] = useState(null)
  
  // Implementation details...
}
```

**File**: `frontend/src/pages/admin/AdminConfig.jsx`

```jsx
import React, { useState, useEffect } from 'react'
import api from '../../api/client'

/**
 * Admin configuration UI.
 * Manage system settings including EMAIL_API_KEY, WHATSAPP_NUMBER.
 */
export default function AdminConfig() {
  const [configs, setConfigs] = useState([])
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    loadConfigs()
  }, [])
  
  async function loadConfigs() {
    try {
      const { data } = await api.get('/api/admin/config')
      setConfigs(data.items)
    } catch (err) {
      console.error('Failed to load configs:', err)
    } finally {
      setLoading(false)
    }
  }
  
  async function handleUpdate(key, value) {
    try {
      await api.put(`/api/admin/config/${key}`, { value })
      await api.post('/api/admin/config/reload')
      alert('Configuration updated successfully')
      loadConfigs()
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to update config')
    }
  }
  
  async function testEmail() {
    const email = prompt('Send test email to:')
    if (!email) return
    
    try {
      await api.post('/api/admin/config/test-email', { to: email })
      alert('Test email sent! Check your inbox.')
    } catch (err) {
      alert('Test email failed: ' + (err.response?.data?.detail || err.message))
    }
  }
  
  return (
    <div className="admin-config">
      <h1>System Configuration</h1>
      
      <div style={{ marginBottom: '2rem' }}>
        <button onClick={testEmail} className="btn">
          📧 Send Test Email
        </button>
      </div>
      
      {loading ? (
        <div>Loading...</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Description</th>
              <th>Value</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {configs.map(config => (
              <tr key={config.key}>
                <td><code>{config.key}</code></td>
                <td>{config.description}</td>
                <td>
                  {config.is_encrypted ? (
                    <span className="muted">••••••••</span>
                  ) : (
                    <code>{config.value || '(not set)'}</code>
                  )}
                </td>
                <td>
                  <button 
                    onClick={() => {
                      const newValue = prompt(`Update ${config.key}:`, config.value)
                      if (newValue !== null) {
                        handleUpdate(config.key, newValue)
                      }
                    }}
                    className="ghost"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      
      <div className="alert info" style={{ marginTop: '2rem' }}>
        <strong>Note:</strong> Changes to EMAIL_API_KEY and other sensitive configs
        require admin privileges. Values are encrypted at rest and never exposed to git.
      </div>
    </div>
  )
}
```

---

## 6. Configuration Management

### 6.1 Encryption Strategy

**Library**: `cryptography.fernet` (already in requirements)

```python
# backend/app/services/config_encryption.py
from cryptography.fernet import Fernet
from app.core.settings import settings

# Key stored in environment ONLY (never in DB)
# Generate with: Fernet.generate_key()
CONFIG_ENCRYPTION_KEY = settings.config_encryption_key.encode()
cipher = Fernet(CONFIG_ENCRYPTION_KEY)

def encrypt_value(plaintext: str) -> str:
    """Encrypt config value."""
    return cipher.encrypt(plaintext.encode()).decode()

def decrypt_value(ciphertext: str) -> str:
    """Decrypt config value."""
    return cipher.decrypt(ciphertext.encode()).decode()
```

### 6.2 Settings Updates

**File**: `backend/app/core/settings.py`

Add new fields (not modifying .env):

```python
class Settings(BaseSettings):
    # ... existing fields ...
    
    # System configuration encryption
    config_encryption_key: str = Field(
        default=None,
        description="Fernet key for encrypting sensitive config values"
    )
    
    # Support system
    ops_support_email: str = Field(
        default="ops@zenops.com",
        description="Ops team email for support notifications"
    )
```

### 6.3 Configuration Loading Flow

```
1. App Startup
   ↓
2. Load settings from .env (basic config)
   ↓
3. Load SystemConfig from database
   ↓
4. Merge: DB overrides .env for configured keys
   ↓
5. Cache in memory (refresh on admin update)
   ↓
6. Services use get_config(key) → always returns latest
```

---

## 7. Security Considerations

### 7.1 API Key Protection

✅ **DO**:
- Store in `system_config` table with `is_encrypted=TRUE`
- Encrypt with Fernet using `CONFIG_ENCRYPTION_KEY` from env
- Never expose in API responses (mask as `••••••••`)
- Require ADMIN role to view/update
- Audit all changes with `updated_by_user_id`

❌ **DON'T**:
- Store in .env files (code will NOT read/write .env)
- Hardcode in source code
- Expose to frontend (even masked)
- Log decrypted values
- Commit to git

### 7.2 Support Token Security

**Token Structure**:
```javascript
{
  "assignment_id": 123,
  "external_user_id": 45,
  "assignment_code": "VAL-2026-001",
  "exp": 1234567890,  // 7 days from creation
  "iat": 1234560000
}
```

**Security Features**:
- Signed with JWT_SECRET (same as auth tokens)
- Expires after 7 days (configurable)
- Cannot be used to access other assignments
- Verified on every request
- Includes assignment_id to prevent tampering

### 7.3 RBAC Matrix

| Action | EXTERNAL_PARTNER | EMPLOYEE | OPS_MANAGER | ADMIN |
|--------|------------------|----------|-------------|-------|
| Create support thread | ✅ (own assignments) | ✅ | ✅ | ✅ |
| View thread | ✅ (own only) | ✅ (assigned) | ✅ (all) | ✅ (all) |
| Reply to thread | ✅ (creator) | ✅ | ✅ | ✅ |
| Close thread | ❌ | ❌ | ✅ | ✅ |
| View all threads | ❌ | ❌ | ✅ | ✅ |
| Manage config | ❌ | ❌ | ❌ | ✅ |
| Update EMAIL_API_KEY | ❌ | ❌ | ❌ | ✅ |

---

## 8. Testing Strategy

### 8.1 Backend Tests

**File**: `backend/tests/test_support_system.py`

```python
def test_create_support_thread():
    """Test thread creation with notifications."""
    
def test_external_user_cannot_access_other_threads():
    """Test RBAC enforcement."""
    
def test_support_token_creation_and_verification():
    """Test token signing and validation."""
    
def test_token_expiration():
    """Test expired token rejection."""
    
def test_email_delivery_log_creation():
    """Test email audit trail."""
    
def test_config_encryption():
    """Test encrypt/decrypt config values."""
    
def test_admin_config_update():
    """Test config update + reload."""
```

**File**: `backend/tests/test_email_service.py`

```python
def test_send_email_with_idempotency():
    """Test duplicate email prevention."""
    
def test_email_retry_on_failure():
    """Test retry logic."""
    
def test_email_daily_limit():
    """Test rate limiting."""
```

### 8.2 Frontend Tests

**File**: `frontend/tests/WhatsAppBubble.test.jsx`

```javascript
test('renders WhatsApp bubble', () => {
  // Component renders
})

test('builds correct WhatsApp URL', () => {
  // buildWhatsAppLink() produces valid URL
})
```

### 8.3 Integration Tests

**Smoke Test Checklist**:
```markdown
- [ ] Admin can update EMAIL_API_KEY via UI
- [ ] Test email sends successfully
- [ ] External user can create support thread
- [ ] Ops team receives notification
- [ ] Ops team receives email
- [ ] WhatsApp bubble opens chat with correct number
- [ ] Support token validates correctly
- [ ] Expired token rejected
- [ ] External user cannot access other user's threads
- [ ] Config reload updates runtime values
```

---

## 9. Deployment Plan

### 9.1 Database Migration

**File**: `backend/alembic/versions/XXXX_add_support_system.py`

```python
def upgrade():
    # 1. Create system_config table
    # 2. Create support_threads table
    # 3. Create support_messages table
    # 4. Create email_delivery_log table
    # 5. Create indexes
    # 6. Insert default config values
    
def downgrade():
    # Drop tables (expand-only, but include for completeness)
```

**Steps**:
```bash
# 1. Generate migration
cd backend
alembic revision --autogenerate -m "add_support_system"

# 2. Review migration file
# 3. Test on staging
alembic upgrade head

# 4. Deploy to production
docker compose exec api alembic upgrade head
```

### 9.2 Environment Variables

**Required** (add to .env.backend):
```bash
# Encryption key for system_config (generate once, keep secret)
CONFIG_ENCRYPTION_KEY=<fernet-key-base64>

# Initial email config (will be moved to DB after first admin login)
EMAIL_PROVIDER=resend
EMAIL_API_KEY=<resend-key>
EMAIL_FROM=noreply@zenops.com

# Support system
OPS_SUPPORT_EMAIL=ops@zenops.com
```

**Generate Encryption Key**:
```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
```

### 9.3 Deployment Sequence

1. **Code Deploy** (zero downtime)
2. **Run Migrations** (expand-only)
3. **Admin Setup**:
   - Login as admin
   - Navigate to Configuration
   - Move EMAIL_API_KEY from .env to DB
   - Configure WHATSAPP_NUMBER
   - Test email sending
4. **Verify**:
   - Create test support thread
   - Check notifications
   - Check email delivery
   - Test WhatsApp bubble

---

## 10. File Structure

### Backend Files (NEW)
```
backend/
├── alembic/versions/
│   └── XXXX_add_support_system.py (NEW)
├── app/
│   ├── models/
│   │   ├── system_config.py (NEW)
│   │   ├── support_thread.py (NEW)
│   │   ├── support_message.py (NEW)
│   │   └── email_delivery_log.py (NEW)
│   ├── schemas/
│   │   ├── system_config.py (NEW)
│   │   ├── support.py (NEW)
│   │   └── email_delivery.py (NEW)
│   ├── services/
│   │   ├── config_service.py (NEW)
│   │   ├── config_encryption.py (NEW)
│   │   ├── email_service.py (NEW - enhanced)
│   │   ├── support_service.py (NEW)
│   │   └── support_token.py (NEW)
│   ├── routers/
│   │   ├── portal_support.py (NEW)
│   │   ├── support.py (NEW)
│   │   └── admin_config.py (NEW)
│   └── scripts/
│       └── email_worker.py (MODIFIED - enhanced)
└── tests/
    ├── test_support_system.py (NEW)
    ├── test_email_service.py (NEW)
    └── test_config_service.py (NEW)
```

### Frontend Files (NEW)
```
frontend/
└── src/
    ├── api/
    │   ├── support.js (NEW)
    │   └── config.js (NEW)
    ├── utils/
    │   └── whatsapp.js (NEW)
    ├── components/
    │   ├── WhatsAppBubble.jsx (NEW)
    │   ├── RaiseQueryModal.jsx (NEW)
    │   └── SupportThreadView.jsx (NEW)
    └── pages/
        ├── partner/
        │   └── SupportThreads.jsx (NEW)
        └── admin/
            ├── SupportInbox.jsx (NEW)
            └── AdminConfig.jsx (NEW)
```

### Documentation (NEW)
```
docs/
├── EMAIL_SETUP.md (NEW)
├── SUPPORT_PORTAL.md (NEW)
└── SMOKE_TEST_CHECKLIST.md (NEW)
```

---

## Approval Checklist

Before implementation, please review:

- [ ] Database schema approved
- [ ] API endpoint design approved
- [ ] Security approach approved (encryption, tokens)
- [ ] Frontend component structure approved
- [ ] Configuration management approach approved
- [ ] No hardcoded secrets
- [ ] No .env file modifications in code
- [ ] Expand-only migrations
- [ ] Testing strategy sufficient

**Estimated Implementation Time**: 10-12 hours (phased approach recommended)

**Phase 1** (3-4h): Email service + Config system  
**Phase 2** (4-5h): Support threads backend  
**Phase 3** (2-3h): Frontend components  
**Phase 4** (1-2h): Tests + documentation

---

## Questions for Clarification

1. **Email Provider**: Confirm Resend is the preferred provider?
2. **WhatsApp Number**: Confirm `917975357599` is correct and active?
3. **Ops Email**: What should be the default OPS_SUPPORT_EMAIL?
4. **Priority**: Should we implement all phases or MVP first?
5. **Existing Users**: Should we migrate any existing config from .env to DB automatically?

---

**Status**: AWAITING APPROVAL  
**Next Step**: Review spec → Approve → Begin implementation  
**Document Version**: 1.0  
**Last Updated**: 2026-02-09
