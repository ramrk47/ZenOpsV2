import { useState, FormEvent, useEffect } from 'react';
import { Button } from '../ui/button';

export interface OverviewPanelProps {
    assignment: any;
    token: string;
    onRefresh: () => void;
}

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

export function OverviewPanel({ assignment, token, onRefresh }: OverviewPanelProps) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Form State
    const [title, setTitle] = useState(assignment?.title ?? '');
    const [summary, setSummary] = useState(assignment?.summary ?? '');
    const [priority, setPriority] = useState(assignment?.priority ?? 'normal');
    const [dueDate, setDueDate] = useState(assignment?.due_date ?? '');

    // We would normally fetch and populate these from master data APIs, 
    // keeping it simple for the M5.6.2 extraction.
    const [bankId, setBankId] = useState(assignment?.bank_id ?? '');
    const [propertyId, setPropertyId] = useState(assignment?.property_id ?? '');

    // Reset form when assignment changes
    useEffect(() => {
        setTitle(assignment?.title ?? '');
        setSummary(assignment?.summary ?? '');
        setPriority(assignment?.priority ?? 'normal');
        setDueDate(assignment?.due_date ?? '');
        setBankId(assignment?.bank_id ?? '');
        setPropertyId(assignment?.property_id ?? '');
    }, [assignment]);

    if (!assignment) return null;

    const handleSave = async (e: FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError('');

        try {
            const response = await fetch(`${API}/assignments/${assignment.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    title,
                    summary,
                    priority,
                    due_date: dueDate || null,
                    bank_id: bankId || null,
                    property_id: propertyId || null
                })
            });

            if (!response.ok) {
                throw new Error('Failed to update assignment overview');
            }

            setEditing(false);
            onRefresh();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="card">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold m-0">Master Data</h2>
                    {!editing ? (
                        <Button className="border border-[var(--zen-border)] bg-transparent text-[var(--zen-primary)] hover:bg-slate-50" onClick={() => setEditing(true)}>Edit</Button>
                    ) : (
                        <div className="flex gap-2">
                            <Button className="bg-transparent text-[var(--zen-muted)] hover:bg-slate-100" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                            <Button onClick={(e) => void handleSave(e)} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
                        </div>
                    )}
                </div>

                {error && <div className="text-red-700 text-sm mb-4">{error}</div>}

                {!editing ? (
                    <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 m-0 text-sm">
                        <div>
                            <dt className="text-[var(--zen-muted)] mb-1 text-xs uppercase font-semibold">Title</dt>
                            <dd className="m-0 font-medium">{assignment.title}</dd>
                        </div>
                        <div>
                            <dt className="text-[var(--zen-muted)] mb-1 text-xs uppercase font-semibold">Priority</dt>
                            <dd className="m-0 font-medium capitalize">{assignment.priority}</dd>
                        </div>
                        <div>
                            <dt className="text-[var(--zen-muted)] mb-1 text-xs uppercase font-semibold">Due Date</dt>
                            <dd className="m-0 font-medium">{assignment.due_date ?? '-'}</dd>
                        </div>
                        <div className="md:col-span-2 lg:col-span-3">
                            <dt className="text-[var(--zen-muted)] mb-1 text-xs uppercase font-semibold">Summary</dt>
                            <dd className="m-0 text-slate-700 whitespace-pre-wrap">{assignment.summary ?? 'No summary provided.'}</dd>
                        </div>
                        <div className="border-t border-[var(--zen-border)] lg:col-span-3 pt-4 mt-2" />

                        <div>
                            <dt className="text-[var(--zen-muted)] mb-1 text-xs uppercase font-semibold">Source Type</dt>
                            <dd className="m-0 font-medium capitalize">{assignment.source_type ?? '-'}</dd>
                        </div>
                        <div>
                            <dt className="text-[var(--zen-muted)] mb-1 text-xs uppercase font-semibold">Bank</dt>
                            <dd className="m-0 font-medium">{assignment.bank_name ?? assignment.bank_id ?? '-'}</dd>
                        </div>
                        <div>
                            <dt className="text-[var(--zen-muted)] mb-1 text-xs uppercase font-semibold">Property</dt>
                            <dd className="m-0 font-medium">{assignment.property_name ?? assignment.property_id ?? '-'}</dd>
                        </div>
                    </dl>
                ) : (
                    <form id="overview-form" onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="flex flex-col gap-1 md:col-span-2">
                            <label className="text-[var(--zen-muted)] font-semibold text-xs">Title</label>
                            <input
                                className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                required
                            />
                        </div>
                        <div className="flex flex-col gap-1 md:col-span-2">
                            <label className="text-[var(--zen-muted)] font-semibold text-xs">Summary</label>
                            <textarea
                                className="rounded-lg border border-[var(--zen-border)] px-3 py-2 min-h-24"
                                value={summary}
                                onChange={e => setSummary(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[var(--zen-muted)] font-semibold text-xs">Priority</label>
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
                        <div className="flex flex-col gap-1">
                            <label className="text-[var(--zen-muted)] font-semibold text-xs">Due Date</label>
                            <input
                                type="date"
                                className="rounded-lg border border-[var(--zen-border)] px-3 py-2"
                                value={dueDate}
                                onChange={e => setDueDate(e.target.value)}
                            />
                        </div>
                    </form>
                )}
            </div>

            {assignment.floors && assignment.floors.length > 0 && (
                <div className="card">
                    <h2 className="text-xl font-bold m-0 mb-4">Property Structure</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="border-b border-[var(--zen-border)] p-2 text-left font-semibold">Floor</th>
                                    <th className="border-b border-[var(--zen-border)] p-2 text-left font-semibold">Area (sqft)</th>
                                    <th className="border-b border-[var(--zen-border)] p-2 text-left font-semibold">Usage</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assignment.floors.map((floor: any) => (
                                    <tr key={floor.id} className="border-b border-[var(--zen-border)] hover:bg-slate-50">
                                        <td className="p-2">{floor.name}</td>
                                        <td className="p-2">{floor.area_sqft ?? '-'}</td>
                                        <td className="p-2">{floor.usage_type ?? '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
