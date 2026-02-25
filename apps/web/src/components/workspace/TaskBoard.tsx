import { useState, FormEvent } from 'react';
import { Button } from '../ui/button';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface TaskBoardProps {
    assignmentId: string;
    tasks: any[];
    token: string;
    onRefresh: () => void;
}

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

export function TaskBoard({ assignmentId, tasks, token, onRefresh }: TaskBoardProps) {
    const [addingTask, setAddingTask] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // New task state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [priority, setPriority] = useState('normal');

    const handleCreateTask = async (e: FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;

        setSaving(true);
        setError('');

        try {
            const response = await fetch(`${API}/tasks`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    assignment_id: assignmentId,
                    title,
                    description: description || undefined,
                    due_date: dueDate || undefined,
                    priority
                })
            });

            if (!response.ok) {
                throw new Error('Failed to create task');
            }

            setAddingTask(false);
            setTitle('');
            setDescription('');
            setDueDate('');
            setPriority('normal');
            onRefresh();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleStatusChange = async (taskId: string, newStatus: string) => {
        try {
            const response = await fetch(`${API}/tasks/${taskId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ status: newStatus })
            });

            if (!response.ok) {
                throw new Error('Failed to update task status');
            }

            onRefresh();
        } catch (err: any) {
            console.error('Error updating task status:', err);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'todo': return 'bg-slate-100 text-slate-800 border-slate-300';
            case 'doing': return 'bg-blue-100 text-blue-800 border-blue-300';
            case 'done': return 'bg-emerald-100 text-emerald-800 border-emerald-300';
            case 'blocked': return 'bg-red-100 text-red-800 border-red-300';
            default: return 'bg-slate-100 text-slate-800 border-slate-300';
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex justify-between items-center bg-white rounded-lg p-4 border border-[var(--zen-border)]">
                <div>
                    <h2 className="text-xl font-bold m-0">Tasks & Checklist</h2>
                    <p className="text-sm text-[var(--zen-muted)] m-0">Track outstanding items required to complete this assignment.</p>
                </div>
                {!addingTask && (
                    <Button onClick={() => setAddingTask(true)}>+ Add Task</Button>
                )}
            </div>

            {addingTask && (
                <form onSubmit={handleCreateTask} className="card grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50">
                    <div className="flex flex-col gap-1 lg:col-span-4">
                        <h3 className="m-0 text-lg font-bold">New Task</h3>
                        {error && <p className="m-0 text-sm text-red-600">{error}</p>}
                    </div>

                    <div className="flex flex-col gap-1 lg:col-span-2">
                        <label className="text-xs font-semibold text-[var(--zen-muted)]">Title</label>
                        <input
                            className="rounded-lg border border-[var(--zen-border)] px-3 py-2 bg-white"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            required
                            autoFocus
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-[var(--zen-muted)]">Due Date</label>
                        <input
                            type="date"
                            className="rounded-lg border border-[var(--zen-border)] px-3 py-2 bg-white"
                            value={dueDate}
                            onChange={e => setDueDate(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-[var(--zen-muted)]">Priority</label>
                        <select
                            className="rounded-lg border border-[var(--zen-border)] px-3 py-2 bg-white"
                            value={priority}
                            onChange={e => setPriority(e.target.value)}
                        >
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-1 lg:col-span-4">
                        <label className="text-xs font-semibold text-[var(--zen-muted)]">Notes (optional)</label>
                        <input
                            className="rounded-lg border border-[var(--zen-border)] px-3 py-2 bg-white"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />
                    </div>

                    <div className="flex gap-2 lg:col-span-4 justify-end mt-2">
                        <Button className="bg-transparent text-[var(--zen-muted)] hover:bg-slate-100" onClick={() => setAddingTask(false)} type="button">Cancel</Button>
                        <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Task'}</Button>
                    </div>
                </form>
            )}

            <div className="grid grid-cols-1 gap-3">
                {tasks.map(task => (
                    <div key={task.id} className="card p-4 flex flex-col md:flex-row gap-4 justify-between md:items-center">
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <span className={clsx("inline-flex border rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider", getStatusColor(task.status))}>
                                    {task.status}
                                </span>
                                <span className={clsx("text-xs font-semibold px-2 py-0.5 rounded border",
                                    task.priority === 'urgent' || task.priority === 'high' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'
                                )}>
                                    P: {task.priority}
                                </span>
                                <h3 className="m-0 text-base ml-1">{task.title}</h3>
                            </div>

                            {task.description && (
                                <p className="m-0 text-sm text-[var(--zen-muted)] mt-1">{task.description}</p>
                            )}

                            <div className="flex items-center gap-3 mt-2 text-xs text-[var(--zen-muted)] font-medium">
                                <span>{task.due_date ? `Due: ${task.due_date}` : 'No due date'}</span>
                                {task.user && <span>• Assignee: {task.user.name}</span>}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2 md:self-stretch items-center pt-3 md:pt-0 border-t md:border-t-0 border-[var(--zen-border)]">
                            {task.status !== 'todo' && (
                                <button
                                    onClick={() => handleStatusChange(task.id, 'todo')}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition"
                                >
                                    Todo
                                </button>
                            )}
                            {task.status !== 'doing' && (
                                <button
                                    onClick={() => handleStatusChange(task.id, 'doing')}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 bg-white hover:bg-blue-50 text-blue-700 transition"
                                >
                                    Doing
                                </button>
                            )}
                            {task.status !== 'done' && (
                                <button
                                    onClick={() => handleStatusChange(task.id, 'done')}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-200 bg-white hover:bg-emerald-50 text-emerald-700 transition"
                                >
                                    Done
                                </button>
                            )}
                            {task.status !== 'blocked' && (
                                <button
                                    onClick={() => handleStatusChange(task.id, 'blocked')}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-700 transition"
                                >
                                    Block
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                {tasks.length === 0 && (
                    <div className="text-center p-12 border-2 border-dashed border-[var(--zen-border)] rounded-xl text-[var(--zen-muted)] bg-slate-50">
                        <h3 className="text-lg font-bold mb-1 m-0">No open tasks</h3>
                        <p className="text-sm m-0">The task tracking board is empty for this assignment.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
