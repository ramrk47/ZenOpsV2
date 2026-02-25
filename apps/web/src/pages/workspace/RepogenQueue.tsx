import { useEffect, useState } from 'react';
import { StatusChip } from '../../components/workspace/StatusChip';
import { KpiData } from '../../components/workspace/KpiStrip';
import { QuickPreviewSidebar } from '../../components/workspace/QuickPreviewSidebar';
import { ReadinessBadge } from '../../components/workspace/ReadinessBadge';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

export interface RepogenQueueProps {
    token: string;
    activeKpiFilter: keyof KpiData | null;
    onCountsCalc: (counts: KpiData) => void;
}

export function RepogenQueue({ token, activeKpiFilter, onCountsCalc }: RepogenQueueProps) {
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

    const load = async () => {
        if (!token) return;
        setLoading(true);
        setError('');
        try {
            const response = await fetch(`${API}/repogen/work-orders`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Failed to load repogen queue');
            const data = await response.json();
            setRows(data.items || []);
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
        // Calculate KPI counts for repogen work orders
        const counts = {
            open: 0,
            dueSoon: 0,
            overdue: 0, // Need due dates for repogen, assume 0 for now if not available
            missingEvidence: 0,
            blockedRelease: 0
        };

        rows.forEach(row => {
            const isClosed = ['CLOSED', 'CANCELLED'].includes(row.status);
            if (!isClosed) counts.open++;

            if (row.status === 'EVIDENCE_PENDING') {
                counts.missingEvidence++;
            }

            if (row.status === 'READY_FOR_RENDER' && !row.report_pack_id) {
                // Pack needs to be created
            }

            // We don't have block release state easily visible from list API without joins, 
            // but if we had it we'd increment blockedRelease here.
        });

        onCountsCalc(counts);
    }, [rows, onCountsCalc]);

    // Apply active KPI filter
    const filteredRows = rows.filter(row => {
        if (!activeKpiFilter) return true;
        const isClosed = ['CLOSED', 'CANCELLED'].includes(row.status);

        if (activeKpiFilter === 'open' && !isClosed) return true;
        if (activeKpiFilter === 'missingEvidence' && row.status === 'EVIDENCE_PENDING') return true;
        // Overdue/dueSoon/blockedRelease logic not fully present in base list row, ignore filter or match none
        return false;
    });

    const selectedRow = rows.find(r => r.id === selectedRowId);

    const getNextAction = (row: any) => {
        if (!row) return undefined;
        if (row.status === 'EVIDENCE_PENDING' || row.status === 'DATA_PENDING') {
            return { label: 'Complete Data', onClick: () => { window.location.href = `/repogen?id=${row.id}`; } };
        }
        if (row.status === 'READY_FOR_RENDER' && !row.report_pack_id) {
            return { label: 'Create Pack', onClick: () => { window.location.href = `/repogen?id=${row.id}`; } };
        }
        if (row.status === 'READY_FOR_RENDER' && row.report_pack_id) {
            return { label: 'Release Deliverables', onClick: () => { window.location.href = `/repogen?id=${row.id}`; } };
        }
        return { label: 'Open Detail', onClick: () => { window.location.href = `/repogen?id=${row.id}`; } };
    };

    return (
        <div className="flex flex-col gap-4">
            {error && <div className="text-red-700 text-sm">{error}</div>}

            <div className="overflow-x-auto card">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">ID</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Report Type</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Bank</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Status</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Readiness</th>
                            <th className="border-b border-[var(--zen-border)] p-2 text-left">Template Selector</th>
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
                                    <div className="font-semibold text-[var(--zen-primary)]">{row.id.split('-')[0]}</div>
                                    <div className="text-xs text-[var(--zen-muted)]">{new Date(row.created_at).toLocaleDateString()}</div>
                                </td>
                                <td className="border-b border-[var(--zen-border)] p-2">
                                    {row.report_type} <span className="text-[var(--zen-muted)]">({row.value_slab})</span>
                                </td>
                                <td className="border-b border-[var(--zen-border)] p-2">{row.bank_name}</td>
                                <td className="border-b border-[var(--zen-border)] p-2">
                                    <StatusChip domain="repogen" value={row.status} />
                                </td>
                                <td className="border-b border-[var(--zen-border)] p-2">
                                    <ReadinessBadge
                                        score={row.readiness_score}
                                        missingEvidenceCount={row.status === 'EVIDENCE_PENDING' ? 1 : 0}
                                    />
                                </td>
                                <td className="border-b border-[var(--zen-border)] p-2 text-xs">
                                    {row.template_selector || '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredRows.length === 0 && !loading && (
                    <p className="text-sm text-[var(--zen-muted)] py-4">No repogen work orders found.</p>
                )}
            </div>

            <QuickPreviewSidebar
                isOpen={selectedRow != null}
                onClose={() => setSelectedRowId(null)}
                title={`Work Order ${selectedRow?.id?.split('-')[0]}`}
                subtitle={selectedRow?.bank_name}
                readiness={{
                    score: selectedRow?.readiness_score ?? null,
                    missingEvidenceCount: selectedRow?.status === 'EVIDENCE_PENDING' ? 1 : 0,
                    warningsCount: 0
                }}
                details={[
                    { label: 'Status', value: selectedRow?.status },
                    { label: 'Report Type', value: selectedRow?.report_type },
                    { label: 'Value Slab', value: selectedRow?.value_slab },
                    { label: 'Template Selector', value: selectedRow?.template_selector ?? 'Waiting for rules' },
                    { label: 'Evidence Attached', value: selectedRow?.evidence_count ?? 0 },
                ]}
                nextAction={getNextAction(selectedRow)}
                links={[
                    { label: 'Open in Repogen Studio', href: `/repogen?id=${selectedRow?.id}` }
                ]}
            />
        </div>
    );
}
