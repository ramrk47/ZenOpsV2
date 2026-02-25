import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { StatusChip } from '../../components/workspace/StatusChip';
import { KpiStrip, KpiData } from '../../components/workspace/KpiStrip';
import { QuickPreviewSidebar } from '../../components/workspace/QuickPreviewSidebar';
import { ReadinessBadge } from '../../components/workspace/ReadinessBadge';

// Types extracted from App.tsx (or shared)
const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

export interface AssignmentsQueueProps {
    token: string;
    activeKpiFilter: keyof KpiData | null;
    onCountsCalc: (counts: KpiData) => void;
}

export function AssignmentsQueue({ token, activeKpiFilter, onCountsCalc }: AssignmentsQueueProps) {
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

    const load = async () => {
        if (!token) return;
        setLoading(true);
        setError('');
        try {
            const response = await fetch(`${API}/assignments`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Failed to load assignments');
            const data = await response.json();
            setRows(data);
        } catch (err: any) {
            setError(err.message);
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [token]);

    useEffect(() => {
        // Calculate KPI counts for assignments
        const counts = {
            open: 0,
            dueSoon: 0,
            overdue: 0,
            missingEvidence: 0,
            blockedRelease: 0
        };

        rows.forEach(row => {
            // open: not delivered/finalized/closed/cancelled
            const isClosed = ['delivered', 'finalized', 'closed', 'cancelled'].includes(row.status.toLowerCase());
            if (!isClosed) counts.open++;

            // Overdue basic logic
            if (row.due_date && new Date(row.due_date) < new Date() && !isClosed) {
                counts.overdue++;
            }

            // Due soon
            if (row.due_date && new Date(row.due_date) >= new Date() && new Date(row.due_date).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000 && !isClosed) {
                counts.dueSoon++;
            }

            // Missing docs / evidence
            if (row.status === 'awaiting_docs') {
                counts.missingEvidence++;
            }
        });

        onCountsCalc(counts);
    }, [rows, onCountsCalc]);

    // Apply active KPI filter locally
    const filteredRows = rows.filter(row => {
        if (!activeKpiFilter) return true;
        const isClosed = ['delivered', 'finalized', 'closed', 'cancelled'].includes(row.status.toLowerCase());
        if (activeKpiFilter === 'open' && !isClosed) return true;
        if (activeKpiFilter === 'overdue' && row.due_date && new Date(row.due_date) < new Date() && !isClosed) return true;
        if (activeKpiFilter === 'dueSoon' && row.due_date && new Date(row.due_date) >= new Date() && new Date(row.due_date).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000 && !isClosed) return true;
        if (activeKpiFilter === 'missingEvidence' && row.status === 'awaiting_docs') return true;
        return false;
    });

    const selectedRow = rows.find(r => r.id === selectedRowId);

    return (
        <div className="flex flex-col gap-4">
            {error && <div className="text-red-700 text-sm">{error}</div>}

            <div className="overflow-x-auto card">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Title</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Lifecycle</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Status</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Priority</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Due</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Assignees</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRows.map((row) => (
                            <tr
                                key={row.id}
                                className="hover:bg-slate-50 cursor-pointer transition-colors"
                                onClick={() => setSelectedRowId(row.id)}
                            >
                                <td className="border-b border-[var(--zen-border)] p-2">
                                    <div className="font-semibold text-[var(--zen-primary)]">{row.title}</div>
                                    <div className="text-xs text-[var(--zen-muted)]">{row.summary ?? 'No summary'}</div>
                                </td>
                                <td className="border-b border-[var(--zen-border)] p-2">{row.lifecycle_status}</td>
                                <td className="border-b border-[var(--zen-border)] p-2">
                                    <StatusChip domain="assignment" value={row.status} />
                                </td>
                                <td className="border-b border-[var(--zen-border)] p-2">{row.priority}</td>
                                <td className="border-b border-[var(--zen-border)] p-2">{row.due_date ?? '-'}</td>
                                <td className="border-b border-[var(--zen-border)] p-2">
                                    <div className="flex flex-wrap gap-1">
                                        {row.assignees?.length === 0 && <span className="text-xs text-[var(--zen-muted)]">Unassigned</span>}
                                        {row.assignees?.map((a: any) => (
                                            <span key={a.user_id} className="inline-flex rounded-full border border-[var(--zen-border)] bg-white px-2 py-0.5 text-xs">
                                                {a.user_name.slice(0, 2).toUpperCase()}
                                            </span>
                                        ))}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredRows.length === 0 && !loading && (
                    <p className="text-sm text-[var(--zen-muted)] py-4">No assignments found for this filter.</p>
                )}
            </div>

            <QuickPreviewSidebar
                isOpen={selectedRow != null}
                onClose={() => setSelectedRowId(null)}
                title={selectedRow?.title ?? ''}
                subtitle={selectedRow?.id ?? ''}
                readiness={selectedRow?.status === 'awaiting_docs' ? { score: null, missingEvidenceCount: 1, warningsCount: 0 } : undefined}
                details={[
                    { label: 'Status', value: selectedRow?.status },
                    { label: 'Lifecycle', value: selectedRow?.lifecycle_status },
                    { label: 'Priority', value: selectedRow?.priority },
                    { label: 'Due Date', value: selectedRow?.due_date ?? '-' },
                    { label: 'Summary', value: selectedRow?.summary ?? '-' },
                ]}
                nextAction={{
                    label: selectedRow?.status === 'awaiting_docs' ? 'Add evidence' : 'Open Assignment',
                    onClick: () => { window.location.href = `/assignments/${selectedRow?.id}`; }
                }}
                links={[
                    { label: 'Open in Assignment Tab', href: `/assignments/${selectedRow?.id}` }
                ]}
            />
        </div>
    );
}
