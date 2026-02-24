import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Button } from './components/ui/button';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

const statusOptions = [
  'requested',
  'assigned',
  'in_progress',
  'awaiting_docs',
  'draft_in_progress',
  'under_review',
  'finalized',
  'delivered',
  'cancelled'
] as const;

const priorityOptions = ['low', 'normal', 'high', 'urgent'] as const;
const taskStatusOptions = ['todo', 'doing', 'done', 'blocked'] as const;
const lifecycleStatusOptions = [
  'DRAFT',
  'COLLECTING',
  'QC_PENDING',
  'CHANGES_REQUESTED',
  'QC_APPROVED',
  'DELIVERED',
  'BILLED',
  'PAID',
  'CLOSED'
] as const;
const assignmentStageOptions = [
  'draft_created',
  'data_collected',
  'qc_pending',
  'qc_changes_requested',
  'qc_approved',
  'finalized',
  'sent_to_client',
  'billed',
  'paid',
  'closed'
] as const;
const assignmentSourceTypeOptions = ['direct', 'bank', 'channel'] as const;
const taskOpsStatusOptions = ['OPEN', 'DONE', 'BLOCKED'] as const;
const taskOpsPriorityOptions = ['LOW', 'MEDIUM', 'HIGH'] as const;
const documentPurposeOptions = ['evidence', 'reference', 'photo', 'annexure', 'other'] as const;
const documentSourceOptions = ['mobile_camera', 'mobile_gallery', 'desktop_upload', 'portal_upload', 'tenant', 'internal'] as const;
const documentClassificationOptions = ['bank_kyc', 'site_photo', 'approval_plan', 'tax_receipt', 'legal', 'invoice', 'other'] as const;
const documentSensitivityOptions = ['public', 'internal', 'pii', 'confidential'] as const;
const employeeRoleOptions = ['admin', 'manager', 'assistant_valuer', 'field_valuer', 'hr', 'finance', 'operations'] as const;

type AssignmentStatus = (typeof statusOptions)[number];
type AssignmentPriority = (typeof priorityOptions)[number];
type TaskStatus = (typeof taskStatusOptions)[number];
type AssignmentStage = (typeof assignmentStageOptions)[number];
type AssignmentLifecycleStatus = (typeof lifecycleStatusOptions)[number];
type EmployeeRole = (typeof employeeRoleOptions)[number];
type DocumentSource = (typeof documentSourceOptions)[number];
type DocumentClassification = (typeof documentClassificationOptions)[number];
type DocumentSensitivity = (typeof documentSensitivityOptions)[number];

interface EmployeeRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: EmployeeRole;
  status: 'active' | 'inactive';
}

interface AssignmentSummary {
  id: string;
  title: string;
  summary: string | null;
  priority: AssignmentPriority;
  status: AssignmentStatus;
  stage: AssignmentStage;
  lifecycle_status: AssignmentLifecycleStatus;
  due_date: string | null;
  due_at?: string | null;
  source_type?: 'direct' | 'bank' | 'channel';
  source_label?: string;
  bank_name?: string | null;
  bank_branch_name?: string | null;
  property_name?: string | null;
  data_completeness?: {
    score: number;
    missing: string[];
  };
  work_order_id: string | null;
  assignees: Array<{
    user_id: string;
    role: string;
    user_name: string;
  }>;
  task_count: number;
}

interface AssignmentDetail {
  id: string;
  title: string;
  summary: string | null;
  priority: AssignmentPriority;
  status: AssignmentStatus;
  stage: AssignmentStage;
  lifecycle_status: AssignmentLifecycleStatus;
  due_date: string | null;
  due_at?: string | null;
  data_completeness?: {
    score: number;
    missing: string[];
  };
  work_order_id: string | null;
  created_at: string;
  updated_at: string;
  assignees: Array<{
    id: string;
    user_id: string;
    role: string;
    user: {
      id: string;
      name: string;
      email: string;
    };
  }>;
  floors: Array<{
    id: string;
    name: string;
    sort_order: number;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    floor_id: string | null;
    floor: { id: string; name: string; sort_order: number } | null;
    assigned_to_user: { id: string; name: string; email: string } | null;
    due_date: string | null;
  }>;
  messages: Array<{
    id: string;
    body: string;
    created_at: string;
    author: { id: string; name: string; email: string };
  }>;
  activities: Array<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    created_at: string;
    actor: { id: string; name: string; email: string } | null;
  }>;
  documents: Array<{
    id: string;
    purpose: string;
    linked_at: string;
    metadata: {
      original_filename: string | null;
      status: string;
      content_type: string | null;
      size_bytes: number | null;
    };
    presign_download_endpoint: string;
  }>;
  status_history?: Array<{
    id: string;
    from_status: AssignmentLifecycleStatus | null;
    to_status: AssignmentLifecycleStatus;
    note: string | null;
    created_at: string;
  }>;
}

type AssignmentDocumentLink = AssignmentDetail['documents'][number];

interface RepogenWarning {
  code: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  field_key?: string;
  section_key?: string | null;
}

interface RepogenFieldRow {
  id: string;
  section_key: string | null;
  field_key: string;
  source: 'manual' | 'ocr' | 'derived';
  value: unknown;
  normalized_text: string | null;
  source_document_id: string | null;
  ocr: Record<string, unknown> | null;
  derived_from: Record<string, unknown> | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RepogenEvidenceRow {
  id: string;
  section_key: string | null;
  field_key: string | null;
  label: string | null;
  sort_order: number;
  metadata_json: Record<string, unknown>;
  ocr: Record<string, unknown> | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  document: {
    id: string;
    original_filename: string | null;
    content_type: string | null;
    size_bytes: number | null;
    status: string;
    classification: string;
    source: string;
    storage_key: string;
    presign_download_endpoint: string;
  };
}

interface RepogenArtifactRow {
  id: string;
  kind: string;
  filename: string;
  storage_ref: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface RepogenPackRow {
  id: string;
  template_key: string;
  report_family: string;
  version: number;
  status: string;
  created_by_user_id: string | null;
  warnings: RepogenWarning[];
  context_snapshot: Record<string, unknown> | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
  template_version: { id: string; version: number; label: string | null } | null;
  artifacts: RepogenArtifactRow[];
}

interface RepogenJobRow {
  id: string;
  assignment_id: string;
  template_key: string;
  report_family: string;
  idempotency_key: string;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  error_message: string | null;
  worker_trace: string | null;
  requested_by_user_id: string | null;
  request_payload: Record<string, unknown>;
  warnings: RepogenWarning[];
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  template_version: { id: string; version: number; label: string | null } | null;
  report_pack: RepogenPackRow | null;
}

interface RepogenContextResponse {
  assignment: {
    id: string;
    title: string;
    status: string;
    stage: string;
  };
  template: {
    key: 'SBI_UNDER_5CR_V1';
    family: string;
    registry: {
      template_id: string;
      status: string;
      versions: Array<{
        id: string;
        version: number;
        label: string | null;
        status: string;
        storage_ref: string | null;
      }>;
    } | null;
  };
  fields: RepogenFieldRow[];
  evidence_links: RepogenEvidenceRow[];
  warnings: RepogenWarning[];
  computed_preview: {
    fmv: number;
    realizable: number;
    distress: number;
    book_value: number | null;
    depreciation_pct: number | null;
  } | null;
  latest_job: RepogenJobRow | null;
  audit_timeline: Array<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    metadata_json: Record<string, unknown>;
    created_at: string;
  }>;
}

interface MasterDataOption {
  id: string;
  name?: string;
  branch_name?: string;
  channel_name?: string;
}

interface TaskRow {
  id: string;
  assignment_id: string | null;
  title: string;
  description: string | null;
  status: (typeof taskOpsStatusOptions)[number];
  priority: (typeof taskOpsPriorityOptions)[number];
  due_at: string | null;
  overdue: boolean;
}

interface AnalyticsOverview {
  assignments_total: number;
  assignments_open: number;
  tasks_open: number;
  tasks_overdue: number;
  channel_requests_submitted: number;
  outbox_failed: number;
  outbox_dead: number;
}

interface ServiceInvoiceSummary {
  id: string;
  account_id: string;
  account_display_name: string | null;
  invoice_number: string | null;
  status: 'DRAFT' | 'ISSUED' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
  total_amount: number;
  amount_due: number;
  amount_paid: number;
  currency: string;
  issued_date: string | null;
  due_date: string | null;
  created_at: string;
}

interface PaymentOrderHandle {
  id: string;
  checkout_url: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
}

const EMPTY_ANALYTICS_OVERVIEW: AnalyticsOverview = {
  assignments_total: 0,
  assignments_open: 0,
  tasks_open: 0,
  tasks_overdue: 0,
  channel_requests_submitted: 0,
  outbox_failed: 0,
  outbox_dead: 0
};

const statusChipClass = (status: string): string => {
  if (status === 'delivered' || status === 'finalized') return 'bg-emerald-100 text-emerald-800 border-emerald-300';
  if (status === 'in_progress' || status === 'draft_in_progress') return 'bg-blue-100 text-blue-800 border-blue-300';
  if (status === 'awaiting_docs' || status === 'under_review') return 'bg-amber-100 text-amber-900 border-amber-300';
  if (status === 'cancelled') return 'bg-red-100 text-red-800 border-red-300';
  return 'bg-slate-100 text-slate-800 border-slate-300';
};

const apiRequest = async <T,>(token: string, path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
};

function AssignmentListPage({ token }: { token: string }) {
  const [status, setStatus] = useState<AssignmentStatus | ''>('');
  const [stage, setStage] = useState<AssignmentStage | ''>('');
  const [priority, setPriority] = useState<AssignmentPriority | ''>('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AssignmentSummary[]>([]);
  const [myTasks, setMyTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!token) {
      setError('Paste a bearer token to load assignments.');
      setRows([]);
      return;
    }

    setLoading(true);
    setError('');

    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (stage) query.set('stage', stage);
    if (priority) query.set('priority', priority);
    if (assigneeUserId) query.set('assignee_user_id', assigneeUserId);
    if (dueDate) query.set('due_date', dueDate);
    if (search) query.set('search', search);

    try {
      const [data, tasks] = await Promise.all([
        apiRequest<AssignmentSummary[]>(token, `/assignments?${query.toString()}`),
        apiRequest<TaskRow[]>(token, '/tasks?assigned_to_me=true')
      ]);
      setRows(data);
      setMyTasks(tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load assignments.');
      setRows([]);
      setMyTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  return (
    <section className="space-y-4">
      <header className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="m-0 text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">Assignment Spine</p>
            <h1 className="m-0 text-3xl font-bold">Assignments</h1>
          </div>
          <Link className="inline-flex rounded-lg border border-[var(--zen-border)] px-4 py-2 text-sm font-semibold" to="/assignments/new">
            New Assignment
          </Link>
        </div>

        <div className="grid gap-2 md:grid-cols-6">
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={status} onChange={(event) => setStatus(event.target.value as AssignmentStatus | '')}>
            <option value="">All Statuses</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={stage} onChange={(event) => setStage(event.target.value as AssignmentStage | '')}>
            <option value="">All Stages</option>
            {assignmentStageOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={priority} onChange={(event) => setPriority(event.target.value as AssignmentPriority | '')}>
            <option value="">All Priorities</option>
            {priorityOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Assignee user id" value={assigneeUserId} onChange={(event) => setAssigneeUserId(event.target.value)} />
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Search title or summary" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button onClick={() => void load()} disabled={loading}>{loading ? 'Loading...' : 'Apply Filters'}</Button>
          {error ? <span className="text-sm text-red-700">{error}</span> : null}
        </div>
      </header>

      <section className="card overflow-x-auto">
        <div className="mb-3">
          <p className="m-0 text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">My Day</p>
          <p className="m-0 text-sm text-[var(--zen-muted)]">
            Tasks: overdue {myTasks.filter((task) => task.overdue && task.status !== 'DONE').length} · due soon{' '}
            {myTasks.filter((task) => !task.overdue && task.status !== 'DONE').length}
          </p>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Title</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Lifecycle</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Status</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Priority</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Due</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Data</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Assignees</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Tasks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-[var(--zen-border)] p-2">
                  <Link className="font-semibold text-[var(--zen-primary)]" to={`/assignments/${row.id}`}>{row.title}</Link>
                  <p className="m-0 text-xs text-[var(--zen-muted)]">{row.summary ?? 'No summary'}</p>
                </td>
                <td className="border-b border-[var(--zen-border)] p-2">{row.lifecycle_status}</td>
                <td className="border-b border-[var(--zen-border)] p-2">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${statusChipClass(row.status)}`}>{row.status}</span>
                </td>
                <td className="border-b border-[var(--zen-border)] p-2">{row.priority}</td>
                <td className="border-b border-[var(--zen-border)] p-2">{row.due_date ?? '-'}</td>
                <td className="border-b border-[var(--zen-border)] p-2">
                  {row.data_completeness ? `${row.data_completeness.score}%` : '-'}
                </td>
                <td className="border-b border-[var(--zen-border)] p-2">
                  <div className="flex flex-wrap gap-1">
                    {row.assignees.length === 0 ? <span className="text-xs text-[var(--zen-muted)]">Unassigned</span> : null}
                    {row.assignees.map((assignee) => (
                      <span key={`${row.id}-${assignee.user_id}`} className="inline-flex rounded-full border border-[var(--zen-border)] bg-white px-2 py-0.5 text-xs">
                        {assignee.user_name.slice(0, 2).toUpperCase()} · {assignee.role}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="border-b border-[var(--zen-border)] p-2">{row.task_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No assignments found.</p> : null}
      </section>
    </section>
  );
}

function NewAssignmentPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [source, setSource] = useState<'tenant' | 'external_portal' | 'partner'>('tenant');
  const [sourceType, setSourceType] = useState<(typeof assignmentSourceTypeOptions)[number]>('direct');
  const [priority, setPriority] = useState<AssignmentPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [feePaise, setFeePaise] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [bankSearch, setBankSearch] = useState('');
  const [branchSearch, setBranchSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [banks, setBanks] = useState<MasterDataOption[]>([]);
  const [branches, setBranches] = useState<MasterDataOption[]>([]);
  const [orgs, setOrgs] = useState<MasterDataOption[]>([]);
  const [properties, setProperties] = useState<MasterDataOption[]>([]);
  const [channels, setChannels] = useState<MasterDataOption[]>([]);
  const [contacts, setContacts] = useState<MasterDataOption[]>([]);
  const [bankId, setBankId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [orgId, setOrgId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [contactId, setContactId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadMaster = async (path: string, setter: (value: MasterDataOption[]) => void) => {
    if (!token) return;
    try {
      const rows = await apiRequest<MasterDataOption[]>(token, path);
      setter(rows);
    } catch {
      setter([]);
    }
  };

  useEffect(() => {
    if (!token) {
      return;
    }
    const query = (value: string) => `?search=${encodeURIComponent(value)}&limit=12`;
    void loadMaster(`/banks${query(bankSearch)}`, setBanks);
    void loadMaster(`/bank-branches${query(branchSearch)}${bankId ? `&bank_id=${bankId}` : ''}`, setBranches);
    void loadMaster(`/client-orgs${query(orgSearch)}`, setOrgs);
    void loadMaster(`/properties${query(propertySearch)}`, setProperties);
    void loadMaster(`/channels${query(channelSearch)}`, setChannels);
    void loadMaster(`/contacts${query(contactSearch)}${orgId ? `&client_org_id=${orgId}` : ''}`, setContacts);
  }, [token, bankSearch, branchSearch, orgSearch, propertySearch, channelSearch, contactSearch, bankId, orgId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      setError('Paste a bearer token first.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const created = await apiRequest<{ id: string }>(token, '/assignments', {
        method: 'POST',
        body: JSON.stringify({
          title,
          summary: summary || undefined,
          source,
          source_type: sourceType,
          priority,
          ...(bankId ? { bank_id: bankId } : {}),
          ...(branchId ? { bank_branch_id: branchId } : {}),
          ...(orgId ? { client_org_id: orgId } : {}),
          ...(propertyId ? { property_id: propertyId } : {}),
          ...(channelId ? { channel_id: channelId } : {}),
          ...(contactId ? { primary_contact_id: contactId } : {}),
          ...(feePaise ? { fee_paise: Number(feePaise) } : {}),
          ...(dueDate ? { due_date: dueDate } : {}),
          ...(workOrderId ? { work_order_id: workOrderId } : {})
        })
      });
      navigate(`/assignments/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create assignment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card">
      <h1 className="m-0 text-3xl font-bold">New Assignment</h1>
      <p className="text-sm text-[var(--zen-muted)]">Fast intake with master data spine for Bank/Branch/Referral Channel operations.</p>

      <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
        <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Assignment title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        <textarea className="min-h-24 rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Summary" value={summary} onChange={(event) => setSummary(event.target.value)} />

        <div className="grid gap-2 md:grid-cols-4">
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={source} onChange={(event) => setSource(event.target.value as 'tenant' | 'external_portal' | 'partner')}>
            <option value="tenant">tenant</option>
            <option value="external_portal">external_portal</option>
            <option value="partner">referral channel</option>
          </select>

          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={sourceType} onChange={(event) => setSourceType(event.target.value as (typeof assignmentSourceTypeOptions)[number])}>
            {assignmentSourceTypeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={priority} onChange={(event) => setPriority(event.target.value as AssignmentPriority)}>
            {priorityOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </div>

        <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Fee (paise)" value={feePaise} onChange={(event) => setFeePaise(event.target.value)} />

        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Search banks" value={bankSearch} onChange={(event) => setBankSearch(event.target.value)} />
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={bankId} onChange={(event) => setBankId(event.target.value)}>
            <option value="">Select bank</option>
            {banks.map((row) => (
              <option key={row.id} value={row.id}>{row.name ?? row.id}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Search branches" value={branchSearch} onChange={(event) => setBranchSearch(event.target.value)} />
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">Select branch</option>
            {branches.map((row) => (
              <option key={row.id} value={row.id}>{row.branch_name ?? row.name ?? row.id}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Search client orgs" value={orgSearch} onChange={(event) => setOrgSearch(event.target.value)} />
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={orgId} onChange={(event) => setOrgId(event.target.value)}>
            <option value="">Select client org</option>
            {orgs.map((row) => (
              <option key={row.id} value={row.id}>{row.name ?? row.id}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Search properties" value={propertySearch} onChange={(event) => setPropertySearch(event.target.value)} />
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
            <option value="">Select property</option>
            {properties.map((row) => (
              <option key={row.id} value={row.id}>{row.name ?? row.id}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Search referral channels" value={channelSearch} onChange={(event) => setChannelSearch(event.target.value)} />
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={channelId} onChange={(event) => setChannelId(event.target.value)}>
            <option value="">Select referral channel</option>
            {channels.map((row) => (
              <option key={row.id} value={row.id}>{row.channel_name ?? row.name ?? row.id}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Search contacts" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} />
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">Select contact</option>
            {contacts.map((row) => (
              <option key={row.id} value={row.id}>{row.name ?? row.id}</option>
            ))}
          </select>
        </div>

        <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Create from work_order_id (optional)" value={workOrderId} onChange={(event) => setWorkOrderId(event.target.value)} />

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={submitting}>{submitting ? 'Creating...' : 'Create Assignment'}</Button>
          <Link className="text-sm text-[var(--zen-muted)]" to="/assignments">Back to list</Link>
        </div>
        {error ? <p className="m-0 text-sm text-red-700">{error}</p> : null}
      </form>
    </section>
  );
}

function AssignmentDetailPage({ token }: { token: string }) {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<'overview' | 'tasks' | 'messages' | 'documents' | 'repogen' | 'activity'>('overview');
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [taskRows, setTaskRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusDraft, setStatusDraft] = useState<AssignmentStatus>('requested');
  const [lifecycleDraft, setLifecycleDraft] = useState<AssignmentLifecycleStatus>('DRAFT');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [attachDocumentId, setAttachDocumentId] = useState('');
  const [attachPurpose, setAttachPurpose] = useState<(typeof documentPurposeOptions)[number]>('reference');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPurpose, setUploadPurpose] = useState<(typeof documentPurposeOptions)[number]>('photo');
  const [uploadSource, setUploadSource] = useState<DocumentSource>('mobile_camera');
  const [uploadClassification, setUploadClassification] = useState<DocumentClassification>('site_photo');
  const [uploadSensitivity, setUploadSensitivity] = useState<DocumentSensitivity>('internal');
  const [uploadRemarks, setUploadRemarks] = useState('');
  const [uploadTakenOnSite, setUploadTakenOnSite] = useState(true);
  const [uploadTagValue, setUploadTagValue] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    if (!token || !id) {
      setAssignment(null);
      setError('Token and assignment id are required.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [data, tasks] = await Promise.all([
        apiRequest<AssignmentDetail>(token, `/assignments/${id}`),
        apiRequest<TaskRow[]>(token, `/tasks?assignment_id=${id}`)
      ]);
      setAssignment(data);
      setTaskRows(tasks);
      setStatusDraft(data.status);
      setLifecycleDraft(data.lifecycle_status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load assignment.');
      setAssignment(null);
      setTaskRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token, id]);

  const tasksByFloor = useMemo(() => {
    if (taskRows.length === 0) return [] as Array<{ floor: string; tasks: TaskRow[] }>;
    const groups = new Map<string, TaskRow[]>();
    for (const task of taskRows) {
      const key = 'Task Queue';
      const current = groups.get(key) ?? [];
      current.push(task);
      groups.set(key, current);
    }
    return Array.from(groups.entries()).map(([floor, tasks]) => ({ floor, tasks }));
  }, [taskRows]);

  const updateStatus = async () => {
    if (!token || !id) return;
    try {
      await apiRequest(token, `/assignments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: statusDraft })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update status.');
    }
  };

  const updateLifecycleStatus = async () => {
    if (!token || !id) return;
    try {
      await apiRequest(token, `/assignments/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({
          to_status: lifecycleDraft
        })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update lifecycle status.');
    }
  };

  const createTask = async () => {
    if (!taskTitle || !token || !id) return;
    try {
      await apiRequest(token, '/tasks', {
        method: 'POST',
        body: JSON.stringify({
          assignment_id: id,
          title: taskTitle,
          due_at: taskDueDate ? new Date(`${taskDueDate}T00:00:00.000Z`).toISOString() : undefined
        })
      });
      setTaskTitle('');
      setTaskDueDate('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create task.');
    }
  };

  const updateTaskStatus = async (taskId: string, nextStatus: TaskStatus) => {
    if (!token || !id) return;
    try {
      if (nextStatus === 'done') {
        await apiRequest(token, `/tasks/${taskId}/mark-done`, {
          method: 'POST'
        });
      } else {
        await apiRequest(token, `/tasks/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'OPEN' })
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update task.');
    }
  };

  const postMessage = async () => {
    if (!messageBody || !token || !id) return;
    try {
      await apiRequest(token, `/assignments/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: messageBody })
      });
      setMessageBody('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to post message.');
    }
  };

  const attachDocument = async () => {
    if (!attachDocumentId || !token || !id) return;
    try {
      await apiRequest(token, `/assignments/${id}/attach-document`, {
        method: 'POST',
        body: JSON.stringify({ document_id: attachDocumentId, purpose: attachPurpose })
      });
      setAttachDocumentId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to attach document.');
    }
  };

  const uploadAndAttachDocument = async () => {
    if (!uploadFile || !token || !id) return;
    setUploading(true);
    setUploadStatus('Preparing upload...');
    try {
      const presign = await apiRequest<{
        document_id: string;
        upload: { url: string; method: 'PUT'; headers: Record<string, string> };
      }>(token, '/files/presign-upload', {
        method: 'POST',
        body: JSON.stringify({
          purpose: uploadPurpose,
          assignment_id: id,
          filename: uploadFile.name,
          content_type: uploadFile.type || 'application/octet-stream',
          size_bytes: uploadFile.size,
          source: uploadSource,
          classification: uploadClassification,
          sensitivity: uploadSensitivity,
          captured_at: new Date().toISOString(),
          remarks: uploadRemarks || undefined,
          taken_on_site: uploadTakenOnSite
        })
      });

      setUploadStatus('Uploading...');
      const uploadResponse = await fetch(presign.upload.url, {
        method: presign.upload.method,
        headers: presign.upload.headers,
        body: uploadFile
      });
      if (!uploadResponse.ok) {
        throw new Error(`Object upload failed (${uploadResponse.status})`);
      }

      setUploadStatus('Confirming upload...');
      await apiRequest(token, '/files/confirm-upload', {
        method: 'POST',
        body: JSON.stringify({ document_id: presign.document_id })
      });

      await apiRequest(token, `/documents/${presign.document_id}/tags`, {
        method: 'POST',
        body: JSON.stringify({
          tags: [
            { key: 'classification', value: uploadClassification },
            { key: 'source', value: uploadSource },
            ...(uploadTagValue ? [{ key: 'note', value: uploadTagValue }] : [])
          ]
        })
      });

      setUploadStatus('Upload completed');
      setUploadFile(null);
      setUploadRemarks('');
      setUploadTagValue('');
      await load();
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : 'Upload failed');
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link className="text-xs text-[var(--zen-muted)]" to="/assignments">← Back to Assignments</Link>
            <h1 className="m-0 text-3xl font-bold">{assignment?.title ?? 'Assignment Detail'}</h1>
            <p className="m-0 text-sm text-[var(--zen-muted)]">{assignment?.summary ?? 'No summary'}</p>
          </div>
          <div className="flex items-center gap-2">
            <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as AssignmentStatus)}>
              {statusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <Button onClick={() => void updateStatus()} disabled={!assignment}>Update Status</Button>
            <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={lifecycleDraft} onChange={(event) => setLifecycleDraft(event.target.value as AssignmentLifecycleStatus)}>
              {lifecycleStatusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <Button onClick={() => void updateLifecycleStatus()} disabled={!assignment}>Move Next</Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(['overview', 'tasks', 'messages', 'documents', 'repogen', 'activity'] as const).map((next) => (
            <button
              key={next}
              className={`rounded-lg border px-3 py-1 text-sm ${tab === next ? 'border-[var(--zen-primary)] bg-white font-semibold' : 'border-[var(--zen-border)]'}`}
              onClick={() => setTab(next)}
              type="button"
            >
              {next}
            </button>
          ))}
        </div>
      </header>

      {loading ? <section className="card">Loading...</section> : null}
      {error ? <section className="card text-sm text-red-700">{error}</section> : null}

      {assignment && tab === 'overview' ? (
        <section className="card grid gap-3 md:grid-cols-2">
          <article>
            <h2 className="mt-0 text-lg">Overview</h2>
            <p className="m-0 text-sm">Status: <strong>{assignment.status}</strong></p>
            <p className="m-0 text-sm">Lifecycle: <strong>{assignment.lifecycle_status}</strong></p>
            <p className="m-0 text-sm">Priority: <strong>{assignment.priority}</strong></p>
            <p className="m-0 text-sm">Due Date: <strong>{assignment.due_date ?? '-'}</strong></p>
            <p className="m-0 text-sm">Work Order: <strong>{assignment.work_order_id ?? '-'}</strong></p>
            <p className="m-0 text-sm">
              Data Completeness: <strong>{assignment.data_completeness ? `${assignment.data_completeness.score}%` : '-'}</strong>
            </p>
          </article>
          <article>
            <h2 className="mt-0 text-lg">Assignees</h2>
            <ul className="m-0 list-none space-y-2 p-0">
              {assignment.assignees.map((assignee) => (
                <li key={assignee.id} className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm">
                  <strong>{assignee.user.name}</strong> · {assignee.role}
                </li>
              ))}
            </ul>
            {assignment.assignees.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No assignees yet.</p> : null}
          </article>
          <article className="md:col-span-2">
            <h2 className="mt-0 text-lg">Status Timeline</h2>
            <div className="space-y-2">
              {(assignment.status_history ?? []).map((item) => (
                <div key={item.id} className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm">
                  <p className="m-0">
                    {item.from_status ?? 'START'}
                    {' -> '}
                    <strong>{item.to_status}</strong>
                  </p>
                  <p className="m-0 text-xs text-[var(--zen-muted)]">{new Date(item.created_at).toLocaleString()}</p>
                  {item.note ? <p className="m-0 text-xs text-[var(--zen-muted)]">{item.note}</p> : null}
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {assignment && tab === 'tasks' ? (
        <section className="card space-y-3">
          <h2 className="mt-0 text-lg">Tasks</h2>
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Task title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
            <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} />
            <Button onClick={() => void createTask()}>Add Task</Button>
          </div>

          {tasksByFloor.map((group) => (
            <article key={group.floor} className="rounded-lg border border-[var(--zen-border)] p-3">
              <h3 className="m-0 text-base">{group.floor}</h3>
              <ul className="m-0 list-none space-y-2 p-0 pt-2">
                {group.tasks.map((task) => (
                  <li key={task.id} className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <strong>{task.title}</strong>
                        <p className="m-0 text-xs text-[var(--zen-muted)]">
                          Due: {task.due_at ? new Date(task.due_at).toLocaleDateString() : '-'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select className="rounded-lg border border-[var(--zen-border)] px-2 py-1" value={task.status.toLowerCase() === 'done' ? 'done' : 'todo'} onChange={(event) => void updateTaskStatus(task.id, event.target.value as TaskStatus)}>
                          {taskStatusOptions.filter((value) => value === 'todo' || value === 'done').map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${task.overdue ? 'border-red-300 bg-red-100 text-red-800' : 'border-slate-300 bg-slate-100 text-slate-800'}`}>
                          {task.status}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {taskRows.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No tasks yet.</p> : null}
        </section>
      ) : null}

      {assignment && tab === 'messages' ? (
        <section className="card space-y-3">
          <h2 className="mt-0 text-lg">Messages</h2>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <textarea className="min-h-20 rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Post update for the team" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} />
            <Button onClick={() => void postMessage()}>Post</Button>
          </div>

          <ul className="m-0 list-none space-y-2 p-0">
            {assignment.messages.map((message) => (
              <li key={message.id} className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2">
                <p className="m-0 text-sm">{message.body}</p>
                <p className="m-0 text-xs text-[var(--zen-muted)]">{message.author.name} · {new Date(message.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
          {assignment.messages.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No messages yet.</p> : null}
        </section>
      ) : null}

      {assignment && tab === 'documents' ? (
        <section className="card space-y-3">
          <h2 className="mt-0 text-lg">Documents</h2>
          <article className="rounded-lg border border-[var(--zen-border)] bg-white p-3">
            <h3 className="m-0 text-base">Mobile Upload</h3>
            <p className="m-0 text-xs text-[var(--zen-muted)]">Capture from camera, gallery, or file manager and tag at upload time.</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <input
                className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
                type="file"
                accept="image/*,.pdf,.doc,.docx"
                capture="environment"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
              <input
                className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
                type="file"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
              <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={uploadPurpose} onChange={(event) => setUploadPurpose(event.target.value as (typeof documentPurposeOptions)[number])}>
                {documentPurposeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={uploadSource} onChange={(event) => setUploadSource(event.target.value as DocumentSource)}>
                {documentSourceOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={uploadClassification} onChange={(event) => setUploadClassification(event.target.value as DocumentClassification)}>
                {documentClassificationOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={uploadSensitivity} onChange={(event) => setUploadSensitivity(event.target.value as DocumentSensitivity)}>
                {documentSensitivityOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2 md:col-span-2" placeholder="Remarks (optional)" value={uploadRemarks} onChange={(event) => setUploadRemarks(event.target.value)} />
              <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2 md:col-span-2" placeholder="Tag note (optional)" value={uploadTagValue} onChange={(event) => setUploadTagValue(event.target.value)} />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={uploadTakenOnSite} onChange={(event) => setUploadTakenOnSite(event.target.checked)} />
                Taken on site
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button onClick={() => void uploadAndAttachDocument()} disabled={!uploadFile || uploading}>
                {uploading ? 'Uploading...' : 'Upload + Tag'}
              </Button>
              {uploadStatus ? <span className="text-xs text-[var(--zen-muted)]">{uploadStatus}</span> : null}
            </div>
          </article>

          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Document id" value={attachDocumentId} onChange={(event) => setAttachDocumentId(event.target.value)} />
            <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={attachPurpose} onChange={(event) => setAttachPurpose(event.target.value as (typeof documentPurposeOptions)[number])}>
              {documentPurposeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <Button onClick={() => void attachDocument()}>Attach</Button>
          </div>

          <ul className="m-0 list-none space-y-2 p-0">
            {assignment.documents.map((document) => (
              <li key={document.id} className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm">
                <strong>{document.metadata.original_filename ?? document.id}</strong> · {document.purpose}
                <p className="m-0 text-xs text-[var(--zen-muted)]">
                  {document.metadata.content_type ?? 'unknown'} · {document.metadata.size_bytes ?? 0} bytes
                </p>
              </li>
            ))}
          </ul>
          {assignment.documents.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No linked documents.</p> : null}
        </section>
      ) : null}

      {assignment && tab === 'activity' ? (
        <section className="card">
          <h2 className="mt-0 text-lg">Activity Timeline</h2>
          <ul className="m-0 list-none space-y-2 p-0">
            {assignment.activities.map((activity) => (
              <li key={activity.id} className="rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <strong>{activity.type}</strong>
                  <span className="text-xs text-[var(--zen-muted)]">{new Date(activity.created_at).toLocaleString()}</span>
                </div>
                <p className="m-0 text-xs text-[var(--zen-muted)]">Actor: {activity.actor?.name ?? 'system'}</p>
                <pre className="m-0 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(activity.payload, null, 2)}</pre>
              </li>
            ))}
          </ul>
          {assignment.activities.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No activity yet.</p> : null}
        </section>
      ) : null}

      {assignment && tab === 'repogen' ? (
        <ReportGenerationPanel token={token} assignmentId={assignment.id} documents={assignment.documents} />
      ) : null}
    </section>
  );
}

const repogenFieldEditorConfig = [
  { key: 'property.address', label: 'Property Address', type: 'text' as const },
  { key: 'inspection_date', label: 'Inspection Date', type: 'date' as const },
  { key: 'assignment_date', label: 'Assignment Date', type: 'date' as const },
  { key: 'guideline_value_total', label: 'Guideline Value Total', type: 'number' as const },
  { key: 'land_value', label: 'Land Value', type: 'number' as const },
  { key: 'building_value', label: 'Building Value', type: 'number' as const },
  { key: 'building.age_years', label: 'Building Age (Years)', type: 'number' as const },
  { key: 'building.total_life_years', label: 'Building Total Life (Years)', type: 'number' as const }
];

const repogenEvidenceSections = [
  'guideline_screenshot',
  'gps_photos',
  'site_photos',
  'google_map',
  'route_map'
] as const;

const readFieldDraftValue = (field: RepogenFieldRow | undefined): string => {
  if (!field) return '';
  if (typeof field.value === 'string') return field.value;
  if (typeof field.value === 'number') return String(field.value);
  if (field.value === null || field.value === undefined) return '';
  return JSON.stringify(field.value);
};

function ReportGenerationPanel({
  token,
  assignmentId,
  documents
}: {
  token: string;
  assignmentId: string;
  documents: AssignmentDocumentLink[];
}) {
  const [context, setContext] = useState<RepogenContextResponse | null>(null);
  const [packs, setPacks] = useState<RepogenPackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({});
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [evidenceSectionKey, setEvidenceSectionKey] = useState<(typeof repogenEvidenceSections)[number]>('site_photos');
  const [evidenceFieldKey, setEvidenceFieldKey] = useState('');
  const [evidenceLabel, setEvidenceLabel] = useState('');
  const [replaceForTarget, setReplaceForTarget] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [activeJob, setActiveJob] = useState<RepogenJobRow | null>(null);

  const hydrateFieldDrafts = (ctx: RepogenContextResponse) => {
    const byKey = new Map<string, RepogenFieldRow>();
    for (const row of ctx.fields) {
      const compoundKey = row.section_key ? `${row.section_key}.${row.field_key}` : row.field_key;
      byKey.set(compoundKey, row);
      if (!row.section_key) {
        byKey.set(row.field_key, row);
      }
    }

    const next: Record<string, string> = {};
    for (const spec of repogenFieldEditorConfig) {
      next[spec.key] = readFieldDraftValue(byKey.get(spec.key));
    }
    setFieldDrafts(next);
  };

  const loadRepogen = async (preserveDrafts = false) => {
    if (!token || !assignmentId) return;
    setLoading(true);
    setError('');
    try {
      const [ctx, packResponse] = await Promise.all([
        apiRequest<RepogenContextResponse>(token, `/assignments/${assignmentId}/report-generation/context?template_key=SBI_UNDER_5CR_V1`),
        apiRequest<{ assignment_id: string; packs: RepogenPackRow[] }>(
          token,
          `/assignments/${assignmentId}/report-generation/packs?template_key=SBI_UNDER_5CR_V1&limit=10`
        )
      ]);
      setContext(ctx);
      setPacks(packResponse.packs);
      setActiveJob(ctx.latest_job);
      if (!preserveDrafts) {
        hydrateFieldDrafts(ctx);
      }
      if (!selectedDocumentId && documents.length > 0) {
        setSelectedDocumentId(documents[0]?.id ?? '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report generation context.');
      setContext(null);
      setPacks([]);
      setActiveJob(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRepogen();
  }, [token, assignmentId]);

  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status !== 'queued' && activeJob.status !== 'processing' && activeJob.status !== 'pending') return;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const latest = await apiRequest<RepogenJobRow>(token, `/report-generation/jobs/${activeJob.id}`);
          setActiveJob(latest);
          setContext((current) => (current ? { ...current, latest_job: latest } : current));
          if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'cancelled') {
            window.clearInterval(timer);
            await loadRepogen(true);
          }
        } catch {
          window.clearInterval(timer);
        }
      })();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status, assignmentId, token]);

  const onFieldChange = (key: string, value: string) => {
    setFieldDrafts((current) => ({
      ...current,
      [key]: value
    }));
  };

  const saveDraft = async () => {
    if (!token || !assignmentId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const fields = repogenFieldEditorConfig.map((spec) => {
        const raw = (fieldDrafts[spec.key] ?? '').trim();
        let value: string | number | null = raw;
        if (!raw) {
          value = null;
        } else if (spec.type === 'number') {
          const parsed = Number(raw);
          value = Number.isFinite(parsed) ? parsed : raw;
        }
        return {
          field_key: spec.key,
          value,
          source: 'manual' as const
        };
      });

      const next = await apiRequest<RepogenContextResponse>(token, `/assignments/${assignmentId}/report-generation/draft`, {
        method: 'PATCH',
        body: JSON.stringify({
          template_key: 'SBI_UNDER_5CR_V1',
          report_family: 'valuation',
          fields
        })
      });

      setContext(next);
      setActiveJob(next.latest_job);
      setNotice('Draft fields saved.');
      await loadRepogen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft fields.');
    } finally {
      setSaving(false);
    }
  };

  const attachEvidence = async () => {
    if (!selectedDocumentId || !token || !assignmentId) return;
    setAttaching(true);
    setError('');
    setNotice('');
    try {
      const next = await apiRequest<RepogenContextResponse>(token, `/assignments/${assignmentId}/report-generation/evidence`, {
        method: 'PUT',
        body: JSON.stringify({
          template_key: 'SBI_UNDER_5CR_V1',
          replace_for_target: replaceForTarget,
          links: [
            {
              section_key: evidenceSectionKey,
              field_key: evidenceFieldKey || undefined,
              document_id: selectedDocumentId,
              label: evidenceLabel || undefined,
              metadata_json: {
                ui_source: 'assignment_report_generation_panel'
              }
            }
          ]
        })
      });
      setContext(next);
      setActiveJob(next.latest_job);
      setNotice('Evidence link attached.');
      setEvidenceFieldKey('');
      setEvidenceLabel('');
      await loadRepogen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to attach evidence.');
    } finally {
      setAttaching(false);
    }
  };

  const triggerGenerate = async () => {
    if (!token || !assignmentId) return;
    setTriggering(true);
    setError('');
    setNotice('');
    try {
      const key =
        idempotencyKey.trim() ||
        `web:repogen:${assignmentId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
      setIdempotencyKey(key);
      const response = await apiRequest<{ idempotent: boolean; job: RepogenJobRow }>(
        token,
        `/assignments/${assignmentId}/report-generation/generate`,
        {
          method: 'POST',
          body: JSON.stringify({
            template_key: 'SBI_UNDER_5CR_V1',
            template_version: 1,
            report_family: 'valuation',
            idempotency_key: key
          })
        }
      );
      setActiveJob(response.job);
      setContext((current) => (current ? { ...current, latest_job: response.job } : current));
      setNotice(response.idempotent ? 'Existing generation job returned (idempotent).' : 'Generation queued.');
      await loadRepogen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger report generation.');
    } finally {
      setTriggering(false);
    }
  };

  const refreshJob = async () => {
    if (!activeJob || !token) return;
    try {
      const latest = await apiRequest<RepogenJobRow>(token, `/report-generation/jobs/${activeJob.id}`);
      setActiveJob(latest);
      setContext((current) => (current ? { ...current, latest_job: latest } : current));
      await loadRepogen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh job status.');
    }
  };

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg">Report Generation</h2>
          <p className="m-0 text-sm text-[var(--zen-muted)]">
            Upload-first draft + evidence linkage for <strong>SBI_UNDER_5CR_V1</strong> (Repogen spine phase 1).
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void loadRepogen(true)} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</Button>
          <Button onClick={() => void triggerGenerate()} disabled={triggering}>
            {triggering ? 'Queueing...' : 'Generate Report'}
          </Button>
        </div>
      </div>

      {error ? <p className="m-0 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="m-0 text-sm text-emerald-700">{notice}</p> : null}

      <article className="rounded-lg border border-[var(--zen-border)] bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-base">Generation Status</h3>
          <Button onClick={() => void refreshJob()} disabled={!activeJob}>Refresh Job</Button>
        </div>
        {activeJob ? (
          <div className="mt-2 grid gap-2 md:grid-cols-2 text-sm">
            <p className="m-0">Job: <strong>{activeJob.id}</strong></p>
            <p className="m-0">Status: <strong>{activeJob.status}</strong></p>
            <p className="m-0">Attempts: <strong>{activeJob.attempts}</strong></p>
            <p className="m-0">Queued: <strong>{activeJob.queued_at ? new Date(activeJob.queued_at).toLocaleString() : '-'}</strong></p>
            <p className="m-0 md:col-span-2">Idempotency: <code>{activeJob.idempotency_key}</code></p>
            {activeJob.error_message ? <p className="m-0 md:col-span-2 text-red-700">Error: {activeJob.error_message}</p> : null}
          </div>
        ) : (
          <p className="m-0 mt-2 text-sm text-[var(--zen-muted)]">No generation jobs yet.</p>
        )}
      </article>

      <article className="rounded-lg border border-[var(--zen-border)] bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-base">Draft Fields (Minimal)</h3>
          <Button onClick={() => void saveDraft()} disabled={saving}>{saving ? 'Saving...' : 'Save Draft'}</Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {repogenFieldEditorConfig.map((spec) => (
            <label key={spec.key} className="flex flex-col gap-1 text-sm">
              {spec.label}
              <input
                className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
                type={spec.type === 'date' ? 'date' : spec.type === 'number' ? 'number' : 'text'}
                value={fieldDrafts[spec.key] ?? ''}
                onChange={(event) => onFieldChange(spec.key, event.target.value)}
                placeholder={spec.key}
              />
              <span className="text-xs text-[var(--zen-muted)]">{spec.key}</span>
            </label>
          ))}
        </div>
        {context?.computed_preview ? (
          <div className="mt-3 grid gap-2 rounded-lg border border-[var(--zen-border)] bg-slate-50 p-3 text-sm md:grid-cols-4">
            <p className="m-0">FMV: <strong>{context.computed_preview.fmv}</strong></p>
            <p className="m-0">Realisable: <strong>{context.computed_preview.realizable}</strong></p>
            <p className="m-0">Distress: <strong>{context.computed_preview.distress}</strong></p>
            <p className="m-0">Depreciation %: <strong>{context.computed_preview.depreciation_pct ?? '-'}</strong></p>
          </div>
        ) : null}
      </article>

      <article className="rounded-lg border border-[var(--zen-border)] bg-white p-3 space-y-3">
        <h3 className="m-0 text-base">Evidence Attachment (Reuse Assignment Documents)</h3>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Assignment Document
            <select
              className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
              value={selectedDocumentId}
              onChange={(event) => setSelectedDocumentId(event.target.value)}
            >
              <option value="">Select document</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.metadata.original_filename ?? doc.id} ({doc.purpose})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Evidence Section
            <select
              className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
              value={evidenceSectionKey}
              onChange={(event) => setEvidenceSectionKey(event.target.value as (typeof repogenEvidenceSections)[number])}
            >
              {repogenEvidenceSections.map((section) => (
                <option key={section} value={section}>{section}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Field Key (optional)
            <input
              className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
              value={evidenceFieldKey}
              onChange={(event) => setEvidenceFieldKey(event.target.value)}
              placeholder="geo.lat or guideline_value_total"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Label (optional)
            <input
              className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
              value={evidenceLabel}
              onChange={(event) => setEvidenceLabel(event.target.value)}
              placeholder="Front elevation / GPS overlay / guideline screenshot"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={replaceForTarget} onChange={(event) => setReplaceForTarget(event.target.checked)} />
            Replace existing links for same section/field target
          </label>
          <Button onClick={() => void attachEvidence()} disabled={attaching || !selectedDocumentId}>
            {attaching ? 'Attaching...' : 'Attach Evidence'}
          </Button>
        </div>

        <ul className="m-0 list-none space-y-2 p-0">
          {(context?.evidence_links ?? []).map((row) => (
            <li key={row.id} className="rounded-lg border border-[var(--zen-border)] px-3 py-2 text-sm">
              <p className="m-0">
                <strong>{row.section_key ?? row.field_key ?? 'evidence'}</strong>
                {row.field_key ? ` · ${row.field_key}` : ''}
                {row.label ? ` · ${row.label}` : ''}
              </p>
              <p className="m-0 text-xs text-[var(--zen-muted)]">
                {row.document.original_filename ?? row.document.id} · {row.document.content_type ?? 'unknown'} · {row.document.size_bytes ?? 0} bytes
              </p>
            </li>
          ))}
        </ul>
        {(context?.evidence_links.length ?? 0) === 0 ? <p className="m-0 text-sm text-[var(--zen-muted)]">No evidence links attached yet.</p> : null}
      </article>

      <article className="rounded-lg border border-[var(--zen-border)] bg-white p-3">
        <h3 className="m-0 text-base">Warnings</h3>
        <ul className="mt-2 m-0 list-none space-y-2 p-0">
          {(context?.warnings ?? []).map((warning, index) => (
            <li
              key={`${warning.code}-${index}`}
              className={`rounded-lg border px-3 py-2 text-sm ${
                warning.severity === 'error'
                  ? 'border-red-300 bg-red-50 text-red-900'
                  : warning.severity === 'warn'
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-slate-300 bg-slate-50 text-slate-800'
              }`}
            >
              <strong>{warning.code}</strong> · {warning.message}
            </li>
          ))}
        </ul>
        {(context?.warnings.length ?? 0) === 0 ? <p className="m-0 mt-2 text-sm text-[var(--zen-muted)]">No warnings.</p> : null}
      </article>

      <article className="rounded-lg border border-[var(--zen-border)] bg-white p-3">
        <h3 className="m-0 text-base">Generated Report Packs</h3>
        <ul className="mt-2 m-0 list-none space-y-2 p-0">
          {packs.map((pack) => (
            <li key={pack.id} className="rounded-lg border border-[var(--zen-border)] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="m-0">
                  <strong>v{pack.version}</strong> · {pack.status} · {pack.template_key}
                </p>
                <span className="text-xs text-[var(--zen-muted)]">{new Date(pack.created_at).toLocaleString()}</span>
              </div>
              <ul className="m-0 mt-2 list-none space-y-1 p-0">
                {pack.artifacts.map((artifact) => (
                  <li key={artifact.id} className="text-xs text-[var(--zen-muted)]">
                    {artifact.kind} · {artifact.filename} · {artifact.size_bytes} bytes
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {packs.length === 0 ? <p className="m-0 mt-2 text-sm text-[var(--zen-muted)]">No generated packs yet.</p> : null}
      </article>
    </section>
  );
}

function EmployeesPage({ token }: { token: string }) {
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<EmployeeRole>('operations');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!token) {
      setRows([]);
      setError('Paste a bearer token to load employees.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<EmployeeRow[]>(token, '/employees');
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load employees');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const createEmployee = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      setError('Paste a bearer token first.');
      return;
    }

    setError('');
    try {
      await apiRequest<EmployeeRow>(token, '/employees', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email: email || undefined,
          phone: phone || undefined,
          role
        })
      });
      setName('');
      setEmail('');
      setPhone('');
      setRole('operations');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create employee');
    }
  };

  return (
    <section className="space-y-4">
      <header className="card">
        <p className="m-0 text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">People Directory</p>
        <h1 className="m-0 text-3xl font-bold">Employees</h1>
        <p className="text-sm text-[var(--zen-muted)]">Internal tenant directory and role foundation for attendance/payroll routing.</p>
      </header>

      <section className="card">
        <h2 className="mt-0 text-lg">Add Employee</h2>
        <form className="grid gap-2 md:grid-cols-4" onSubmit={createEmployee}>
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} required />
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Email (optional)" value={email} onChange={(event) => setEmail(event.target.value)} />
          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Phone (optional)" value={phone} onChange={(event) => setPhone(event.target.value)} />
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={role} onChange={(event) => setRole(event.target.value as EmployeeRole)}>
            {employeeRoleOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <div className="md:col-span-4">
            <Button type="submit">Create Employee</Button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-lg">Directory</h2>
          <Button onClick={() => void load()} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</Button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-[var(--zen-border)] p-2 text-left">Name</th>
                <th className="border-b border-[var(--zen-border)] p-2 text-left">Role</th>
                <th className="border-b border-[var(--zen-border)] p-2 text-left">Email</th>
                <th className="border-b border-[var(--zen-border)] p-2 text-left">Phone</th>
                <th className="border-b border-[var(--zen-border)] p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="border-b border-[var(--zen-border)] p-2">{row.name}</td>
                  <td className="border-b border-[var(--zen-border)] p-2">{row.role}</td>
                  <td className="border-b border-[var(--zen-border)] p-2">{row.email ?? '-'}</td>
                  <td className="border-b border-[var(--zen-border)] p-2">{row.phone ?? '-'}</td>
                  <td className="border-b border-[var(--zen-border)] p-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No employees yet.</p> : null}
      </section>
    </section>
  );
}

function AnalyticsPage({ token }: { token: string }) {
  const [stats, setStats] = useState<AnalyticsOverview>(EMPTY_ANALYTICS_OVERVIEW);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!token) {
      setError('Paste a bearer token to load analytics.');
      setStats(EMPTY_ANALYTICS_OVERVIEW);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<AnalyticsOverview>(token, '/analytics/overview');
      setStats(data);
    } catch (err) {
      setStats(EMPTY_ANALYTICS_OVERVIEW);
      setError(err instanceof Error ? `Failed to load analytics: ${err.message}` : 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  return (
    <section className="space-y-4">
      <header className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="m-0 text-2xl font-bold">Analytics</h1>
            <p className="m-0 text-sm text-[var(--zen-muted)]">Ops counters with safe zero fallback when no data exists.</p>
          </div>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading...' : 'Retry'}
          </Button>
        </div>
      </header>

      {error ? <section className="card text-sm text-red-700">{error}</section> : null}

      <section className="grid gap-3 md:grid-cols-3">
        <article className="card">
          <p className="m-0 text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Assignments</p>
          <h2 className="m-0 text-2xl">{stats.assignments_total}</h2>
          <p className="m-0 text-sm text-[var(--zen-muted)]">Open: {stats.assignments_open}</p>
        </article>
        <article className="card">
          <p className="m-0 text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Tasks</p>
          <h2 className="m-0 text-2xl">{stats.tasks_open}</h2>
          <p className="m-0 text-sm text-[var(--zen-muted)]">Overdue: {stats.tasks_overdue}</p>
        </article>
        <article className="card">
          <p className="m-0 text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Referral Channel Requests</p>
          <h2 className="m-0 text-2xl">{stats.channel_requests_submitted}</h2>
          <p className="m-0 text-sm text-[var(--zen-muted)]">Awaiting review</p>
        </article>
        <article className="card">
          <p className="m-0 text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Outbox Failed</p>
          <h2 className="m-0 text-2xl">{stats.outbox_failed}</h2>
        </article>
        <article className="card">
          <p className="m-0 text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Outbox Dead</p>
          <h2 className="m-0 text-2xl">{stats.outbox_dead}</h2>
        </article>
      </section>
    </section>
  );
}

function ServiceInvoicesPage({ token }: { token: string }) {
  const [rows, setRows] = useState<ServiceInvoiceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [payProvider, setPayProvider] = useState<'stripe' | 'razorpay'>('razorpay');
  const [payLinks, setPayLinks] = useState<Record<string, string>>({});

  const [accountIdFilter, setAccountIdFilter] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [newDescription, setNewDescription] = useState('Commissioned work');
  const [newAmount, setNewAmount] = useState('1000');
  const [newDueDate, setNewDueDate] = useState('');

  const load = async () => {
    if (!token) {
      setError('Paste a bearer token to load invoices.');
      setRows([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = accountIdFilter.trim() ? `?account_id=${encodeURIComponent(accountIdFilter.trim())}` : '';
      const data = await apiRequest<ServiceInvoiceSummary[]>(token, `/service-invoices${query}`);
      setRows(data);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Unable to load invoices.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const withReload = async (label: string, action: () => Promise<void>) => {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await action();
      await load();
      setNotice(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setWorking(false);
    }
  };

  const createDraft = async () => {
    const amount = Number.parseFloat(newAmount);
    if (!newAccountId.trim()) {
      setError('account_id is required.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number.');
      return;
    }

    await withReload('Invoice draft created.', async () => {
      await apiRequest(token, '/service-invoices', {
        method: 'POST',
        body: JSON.stringify({
          account_id: newAccountId.trim(),
          due_date: newDueDate || undefined,
          notes: 'Created from tenant web invoices lane',
          items: [
            {
              description: newDescription || 'Commissioned work',
              quantity: 1,
              unit_price: amount,
              order_index: 0
            }
          ]
        })
      });
    });
  };

  const issueInvoice = async (invoiceId: string) => {
    await withReload(`Issued ${invoiceId}.`, async () => {
      await apiRequest(token, `/service-invoices/${invoiceId}/issue`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `web:invoice_issue:${invoiceId}`
        },
        body: JSON.stringify({})
      });
    });
  };

  const markPaid = async (invoiceId: string, amountDue: number) => {
    const amount = Number.isFinite(amountDue) && amountDue > 0 ? amountDue : undefined;
    await withReload(`Marked ${invoiceId} as paid.`, async () => {
      await apiRequest(token, `/service-invoices/${invoiceId}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({
          ...(amount ? { amount } : {}),
          mode: 'manual',
          notes: 'Marked paid from tenant web invoices lane'
        })
      });
    });
  };

  const createPayNowLink = async (invoice: ServiceInvoiceSummary) => {
    const amount = invoice.amount_due > 0 ? invoice.amount_due : invoice.total_amount;
    await withReload(`Checkout created for ${invoice.invoice_number ?? invoice.id}.`, async () => {
      const created = await apiRequest<PaymentOrderHandle>(token, '/payments/checkout-link', {
        method: 'POST',
        body: JSON.stringify({
          account_id: invoice.account_id,
          amount,
          currency: invoice.currency,
          purpose: 'invoice',
          provider: payProvider,
          ref_type: 'service_invoice',
          ref_id: invoice.id,
          service_invoice_id: invoice.id,
          idempotency_key: `web:invoice_checkout:${invoice.id}:${payProvider}`
        })
      });
      if (created.checkout_url) {
        setPayLinks((current) => ({
          ...current,
          [invoice.id]: created.checkout_url as string
        }));
        window.open(created.checkout_url, '_blank', 'noopener,noreferrer');
      }
    });
  };

  return (
    <section className="space-y-4">
      <header className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="m-0 text-2xl font-bold">Service Invoices</h1>
            <p className="m-0 text-sm text-[var(--zen-muted)]">Postpaid safety net in V2 (draft → issue → paid).</p>
          </div>
          <Button disabled={loading || working} onClick={() => void load()}>
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <input
            className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
            placeholder="Filter by account_id"
            value={accountIdFilter}
            onChange={(event) => setAccountIdFilter(event.target.value)}
          />
          <div className="flex gap-2">
            <select
              className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
              value={payProvider}
              onChange={(event) => setPayProvider(event.target.value as 'stripe' | 'razorpay')}
            >
              <option value="razorpay">Razorpay</option>
              <option value="stripe">Stripe</option>
            </select>
            <Button disabled={loading || working} onClick={() => void load()}>
              Apply Filter
            </Button>
          </div>
        </div>
      </header>

      <section className="card">
        <p className="m-0 text-sm font-semibold">Create Draft</p>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <input
            className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
            placeholder="billing account_id"
            value={newAccountId}
            onChange={(event) => setNewAccountId(event.target.value)}
          />
          <input
            className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
            placeholder="description"
            value={newDescription}
            onChange={(event) => setNewDescription(event.target.value)}
          />
          <input
            className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
            type="number"
            min={1}
            step="0.01"
            placeholder="amount"
            value={newAmount}
            onChange={(event) => setNewAmount(event.target.value)}
          />
          <input
            className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
            type="date"
            value={newDueDate}
            onChange={(event) => setNewDueDate(event.target.value)}
          />
        </div>
        <div className="mt-2">
          <Button disabled={working || loading || !token} onClick={() => void createDraft()}>
            Create Draft
          </Button>
        </div>
      </section>

      {error ? <section className="card text-sm text-red-700">{error}</section> : null}
      {notice ? <section className="card text-sm text-emerald-700">{notice}</section> : null}

      <section className="card overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Invoice</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Account</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Status</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Amount</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Due</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-[var(--zen-border)] p-2">
                  <p className="m-0 font-semibold">{row.invoice_number ?? row.id}</p>
                  <p className="m-0 text-xs text-[var(--zen-muted)]">{new Date(row.created_at).toLocaleString()}</p>
                </td>
                <td className="border-b border-[var(--zen-border)] p-2">
                  <p className="m-0">{row.account_display_name ?? '-'}</p>
                  <p className="m-0 text-xs text-[var(--zen-muted)]">{row.account_id}</p>
                </td>
                <td className="border-b border-[var(--zen-border)] p-2">{row.status}</td>
                <td className="border-b border-[var(--zen-border)] p-2">
                  {row.total_amount.toFixed(2)} {row.currency} · due {row.amount_due.toFixed(2)}
                </td>
                <td className="border-b border-[var(--zen-border)] p-2">{row.due_date ?? '-'}</td>
                <td className="border-b border-[var(--zen-border)] p-2 text-right">
                  <div className="inline-flex gap-2">
                    {row.status === 'DRAFT' ? (
                      <Button disabled={working} onClick={() => void issueInvoice(row.id)}>
                        Issue
                      </Button>
                    ) : null}
                    {row.status !== 'PAID' && row.status !== 'VOID' ? (
                      <Button disabled={working} onClick={() => void markPaid(row.id, row.amount_due)}>
                        Mark Paid
                      </Button>
                    ) : null}
                    {row.status !== 'PAID' && row.status !== 'VOID' ? (
                      <Button disabled={working} onClick={() => void createPayNowLink(row)}>
                        Pay Now
                      </Button>
                    ) : null}
                    {payLinks[row.id] ? (
                      <a className="inline-flex items-center rounded-lg border border-[var(--zen-border)] px-3 py-1 text-sm" href={payLinks[row.id]} target="_blank" rel="noreferrer">
                        Open Link
                      </a>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No invoices found.</p> : null}
      </section>
    </section>
  );
}

function AppShell({ token, setToken }: { token: string; setToken: (token: string) => void }) {
  useEffect(() => {
    localStorage.setItem('zenops_web_token', token);
  }, [token]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="card mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="m-0 text-xs uppercase tracking-[0.2em] text-[var(--zen-muted)]">Tenant #1 Internal Lane</p>
          <h1 className="m-0 text-3xl font-bold">ZenOps Assignment Spine V2</h1>
        </div>
        <div className="w-full max-w-xl">
          <label className="text-xs uppercase tracking-[0.15em] text-[var(--zen-muted)]">Bearer Token</label>
          <input className="mt-1 w-full rounded-lg border border-[var(--zen-border)] bg-white px-3 py-2" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste web token" />
        </div>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2">
        <NavLink className={({ isActive }) => `rounded-lg border px-3 py-1 text-sm ${isActive ? 'border-[var(--zen-primary)] bg-white font-semibold' : 'border-[var(--zen-border)]'}`} to="/assignments">Assignments</NavLink>
        <NavLink className={({ isActive }) => `rounded-lg border px-3 py-1 text-sm ${isActive ? 'border-[var(--zen-primary)] bg-white font-semibold' : 'border-[var(--zen-border)]'}`} to="/assignments/new">New</NavLink>
        <NavLink className={({ isActive }) => `rounded-lg border px-3 py-1 text-sm ${isActive ? 'border-[var(--zen-primary)] bg-white font-semibold' : 'border-[var(--zen-border)]'}`} to="/invoices">Invoices</NavLink>
        <NavLink className={({ isActive }) => `rounded-lg border px-3 py-1 text-sm ${isActive ? 'border-[var(--zen-primary)] bg-white font-semibold' : 'border-[var(--zen-border)]'}`} to="/analytics">Analytics</NavLink>
        <NavLink className={({ isActive }) => `rounded-lg border px-3 py-1 text-sm ${isActive ? 'border-[var(--zen-primary)] bg-white font-semibold' : 'border-[var(--zen-border)]'}`} to="/employees">Employees</NavLink>
      </nav>

      <Routes>
        <Route path="/assignments" element={<AssignmentListPage token={token} />} />
        <Route path="/assignments/new" element={<NewAssignmentPage token={token} />} />
        <Route path="/assignments/:id" element={<AssignmentDetailPage token={token} />} />
        <Route path="/invoices" element={<ServiceInvoicesPage token={token} />} />
        <Route path="/analytics" element={<AnalyticsPage token={token} />} />
        <Route path="/employees" element={<EmployeesPage token={token} />} />
        <Route path="*" element={<Navigate to="/assignments" replace />} />
      </Routes>
    </main>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('zenops_web_token') ?? '');

  return (
    <BrowserRouter>
      <AppShell token={token} setToken={setToken} />
    </BrowserRouter>
  );
}
