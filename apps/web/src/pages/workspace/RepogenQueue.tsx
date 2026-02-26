import { useEffect, useState, useMemo } from 'react';
import { StatusChip } from '../../components/workspace/StatusChip';
import { KpiData } from '../../components/workspace/KpiStrip';
import { QuickPreviewSidebar } from '../../components/workspace/QuickPreviewSidebar';
import { ReadinessBadge } from '../../components/workspace/ReadinessBadge';
import { RepogenClient, type ArtifactInfo } from '../../api/repogen.client';

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

    const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
    const [artifactsLoading, setArtifactsLoading] = useState(false);

    const client = useMemo(() => new RepogenClient(API, token), [token]);

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

    // Load artifacts for selected row if exists
    useEffect(() => {
        if (!selectedRow || !selectedRow.report_pack_id) {
            setArtifacts([]);
            return;
        }

        let isMounted = true;
        setArtifactsLoading(true);

        client.listPackArtifacts(selectedRow.id, selectedRow.report_pack_id)
            .then(res => {
                if (isMounted) setArtifacts(res.artifacts || []);
            })
            .catch(err => {
                console.error("Failed to load artifacts", err);
                if (isMounted) setArtifacts([]);
            })
            .finally(() => {
                if (isMounted) setArtifactsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [selectedRowId, selectedRow?.report_pack_id, client]);

    const handleDownloadArtifact = async (artifactId: string) => {
        try {
            const res = await client.getPresignedUrl(artifactId);
            window.open(res.url, '_blank');
        } catch (err) {
            console.error(err);
            alert('Failed to get download URL.');
        }
    };

    const handleFinalize = async (packId: string) => {
        if (!confirm('This will mark the current draft outputs as FINAL. Are you sure?')) return;
        try {
            await client.finalizePack(selectedRow!.id, packId);
            // Reload the queue to grab new status
            load();
            setArtifacts([]);
        } catch (err) {
            console.error(err);
            alert('Failed to finalize pack.');
        }
    };

    const getSidebarProps = () => {
        if (!selectedRow) return null;

        const isPackFinal = selectedRow.report_pack_status === 'finalized';
        const docxDraft = artifacts.find(a => a.kind === 'docx');
        const pdfDraft = artifacts.find(a => a.kind === 'pdf');
        const zipFinal = artifacts.find(a => a.kind === 'zip');

        let pdfHasError = false;
        if (pdfDraft?.metadata_json?.error) pdfHasError = true;

        let pdfHasWarning = false;
        if (pdfDraft?.metadata_json?.skipped) pdfHasWarning = true;

        let nextAction;
        let secondaryActions: { label: string; onClick: () => void }[] = [];
        let badges: { label: string; variant: 'red' | 'amber' | 'emerald' | 'slate' }[] = [];

        const links: { label: string; href: string }[] = [
            { label: 'Open in Repogen Studio', href: `/repogen?id=${selectedRow.id}` }
        ];

        if (selectedRow.status === 'EVIDENCE_PENDING' || selectedRow.status === 'DATA_PENDING') {
            nextAction = { label: 'Complete Data', onClick: () => { window.location.href = `/repogen?id=${selectedRow.id}`; } };
        } else if (selectedRow.status === 'READY_FOR_RENDER' && !selectedRow.report_pack_id) {
            nextAction = { label: 'Create Pack', onClick: () => { window.location.href = `/repogen?id=${selectedRow.id}`; } };
        } else if (selectedRow.report_pack_id) {
            // Document Review Gap Workflow
            if (!isPackFinal) {
                // DRAFT MODE
                nextAction = {
                    label: 'Make Final',
                    onClick: () => handleFinalize(selectedRow.report_pack_id)
                };

                if (pdfDraft && !pdfHasError && !pdfHasWarning) {
                    secondaryActions.push({
                        label: 'View Draft (PDF)',
                        onClick: () => handleDownloadArtifact(pdfDraft.id)
                    });
                } else if (docxDraft) {
                    secondaryActions.push({
                        label: 'View Draft (DOCX)',
                        onClick: () => handleDownloadArtifact(docxDraft.id)
                    });
                }

                if (pdfHasError) {
                    badges.push({ label: 'PDF Failed', variant: 'red' });
                } else if (pdfHasWarning) {
                    badges.push({ label: 'PDF Skipped', variant: 'amber' });
                }

            } else {
                // FINAL MODE
                if (zipFinal) {
                    nextAction = {
                        label: 'Download Pack (Final ZIP)',
                        onClick: () => handleDownloadArtifact(zipFinal.id)
                    };
                }

                if (pdfDraft) {
                    secondaryActions.push({
                        label: 'View Final (PDF)',
                        onClick: () => handleDownloadArtifact(pdfDraft.id)
                    });
                } else if (docxDraft) {
                    secondaryActions.push({
                        label: 'View Final (DOCX)',
                        onClick: () => handleDownloadArtifact(docxDraft.id)
                    });
                }
            }
        } else {
            nextAction = { label: 'Open Detail', onClick: () => { window.location.href = `/repogen?id=${selectedRow.id}`; } };
        }

        const details = [
            { label: 'Status', value: selectedRow.status },
            { label: 'Report Type', value: selectedRow.report_type },
            { label: 'Value Slab', value: selectedRow.value_slab },
            { label: 'Template Selector', value: selectedRow.template_selector ?? 'Waiting for rules' },
            { label: 'Evidence Attached', value: selectedRow.evidence_count ?? 0 },
            { label: 'Pack Status', value: selectedRow.report_pack_status ?? '-' },
        ];

        return { nextAction, secondaryActions, badges, links, details };
    };

    const sidebarProps = getSidebarProps();

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
                badges={sidebarProps?.badges}
                readiness={{
                    score: selectedRow?.readiness_score ?? null,
                    missingEvidenceCount: selectedRow?.status === 'EVIDENCE_PENDING' ? 1 : 0,
                    warningsCount: 0
                }}
                details={sidebarProps?.details ?? []}
                nextAction={sidebarProps?.nextAction}
                secondaryActions={sidebarProps?.secondaryActions}
                links={sidebarProps?.links ?? []}
            />
        </div>
    );
}
