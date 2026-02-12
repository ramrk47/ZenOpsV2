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
const documentPurposeOptions = ['evidence', 'reference', 'photo', 'annexure', 'other'] as const;
const employeeRoleOptions = ['admin', 'manager', 'assistant_valuer', 'field_valuer', 'hr', 'finance', 'operations'] as const;

type AssignmentStatus = (typeof statusOptions)[number];
type AssignmentPriority = (typeof priorityOptions)[number];
type TaskStatus = (typeof taskStatusOptions)[number];
type EmployeeRole = (typeof employeeRoleOptions)[number];

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
  due_date: string | null;
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
  due_date: string | null;
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
}

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
  const [priority, setPriority] = useState<AssignmentPriority | ''>('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AssignmentSummary[]>([]);
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
    if (priority) query.set('priority', priority);
    if (assigneeUserId) query.set('assignee_user_id', assigneeUserId);
    if (dueDate) query.set('due_date', dueDate);
    if (search) query.set('search', search);

    try {
      const data = await apiRequest<AssignmentSummary[]>(token, `/assignments?${query.toString()}`);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load assignments.');
      setRows([]);
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

        <div className="grid gap-2 md:grid-cols-5">
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={status} onChange={(event) => setStatus(event.target.value as AssignmentStatus | '')}>
            <option value="">All Statuses</option>
            {statusOptions.map((option) => (
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
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Title</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Status</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Priority</th>
              <th className="border-b border-[var(--zen-border)] p-2 text-left">Due</th>
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
                <td className="border-b border-[var(--zen-border)] p-2">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${statusChipClass(row.status)}`}>{row.status}</span>
                </td>
                <td className="border-b border-[var(--zen-border)] p-2">{row.priority}</td>
                <td className="border-b border-[var(--zen-border)] p-2">{row.due_date ?? '-'}</td>
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
  const [priority, setPriority] = useState<AssignmentPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
          priority,
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
      <p className="text-sm text-[var(--zen-muted)]">Create a tenant assignment or convert a portal work order into assignment spine.</p>

      <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
        <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Assignment title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        <textarea className="min-h-24 rounded-lg border border-[var(--zen-border)] px-3 py-2" placeholder="Summary" value={summary} onChange={(event) => setSummary(event.target.value)} />

        <div className="grid gap-2 md:grid-cols-3">
          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={source} onChange={(event) => setSource(event.target.value as 'tenant' | 'external_portal' | 'partner')}>
            <option value="tenant">tenant</option>
            <option value="external_portal">external_portal</option>
            <option value="partner">partner</option>
          </select>

          <select className="rounded-lg border border-[var(--zen-border)] px-3 py-2" value={priority} onChange={(event) => setPriority(event.target.value as AssignmentPriority)}>
            {priorityOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <input className="rounded-lg border border-[var(--zen-border)] px-3 py-2" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
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
  const [tab, setTab] = useState<'overview' | 'tasks' | 'messages' | 'documents' | 'activity'>('overview');
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusDraft, setStatusDraft] = useState<AssignmentStatus>('requested');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [attachDocumentId, setAttachDocumentId] = useState('');
  const [attachPurpose, setAttachPurpose] = useState<(typeof documentPurposeOptions)[number]>('reference');

  const load = async () => {
    if (!token || !id) {
      setAssignment(null);
      setError('Token and assignment id are required.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<AssignmentDetail>(token, `/assignments/${id}`);
      setAssignment(data);
      setStatusDraft(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load assignment.');
      setAssignment(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token, id]);

  const tasksByFloor = useMemo(() => {
    if (!assignment) return [] as Array<{ floor: string; tasks: AssignmentDetail['tasks'] }>;
    const groups = new Map<string, AssignmentDetail['tasks']>();
    for (const task of assignment.tasks) {
      const key = task.floor?.name ?? 'Unassigned Floor';
      const current = groups.get(key) ?? [];
      current.push(task);
      groups.set(key, current);
    }
    return Array.from(groups.entries()).map(([floor, tasks]) => ({ floor, tasks }));
  }, [assignment]);

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

  const createTask = async () => {
    if (!taskTitle || !token || !id) return;
    try {
      await apiRequest(token, `/assignments/${id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title: taskTitle, ...(taskDueDate ? { due_date: taskDueDate } : {}) })
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
      await apiRequest(token, `/assignments/${id}/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus })
      });
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
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(['overview', 'tasks', 'messages', 'documents', 'activity'] as const).map((next) => (
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
            <p className="m-0 text-sm">Priority: <strong>{assignment.priority}</strong></p>
            <p className="m-0 text-sm">Due Date: <strong>{assignment.due_date ?? '-'}</strong></p>
            <p className="m-0 text-sm">Work Order: <strong>{assignment.work_order_id ?? '-'}</strong></p>
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
                        <p className="m-0 text-xs text-[var(--zen-muted)]">Due: {task.due_date ?? '-'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select className="rounded-lg border border-[var(--zen-border)] px-2 py-1" value={task.status} onChange={(event) => void updateTaskStatus(task.id, event.target.value as TaskStatus)}>
                          {taskStatusOptions.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${statusChipClass(task.status)}`}>{task.status}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {assignment.tasks.length === 0 ? <p className="text-sm text-[var(--zen-muted)]">No tasks yet.</p> : null}
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
        <NavLink className={({ isActive }) => `rounded-lg border px-3 py-1 text-sm ${isActive ? 'border-[var(--zen-primary)] bg-white font-semibold' : 'border-[var(--zen-border)]'}`} to="/employees">Employees</NavLink>
      </nav>

      <Routes>
        <Route path="/assignments" element={<AssignmentListPage token={token} />} />
        <Route path="/assignments/new" element={<NewAssignmentPage token={token} />} />
        <Route path="/assignments/:id" element={<AssignmentDetailPage token={token} />} />
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
