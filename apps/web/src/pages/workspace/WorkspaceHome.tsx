import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { KpiStrip, KpiData } from '../../components/workspace/KpiStrip';
import { AssignmentsQueue } from './AssignmentsQueue';
import { RepogenQueue } from './RepogenQueue';

export function WorkspaceHome({ token }: { token: string }) {
    const [activeTab, setActiveTab] = useState<'assignments' | 'repogen'>('assignments');
    const [activeKpiFilter, setActiveKpiFilter] = useState<keyof KpiData | null>(null);
    const [counts, setCounts] = useState<KpiData>({
        open: 0,
        dueSoon: 0,
        overdue: 0,
        missingEvidence: 0,
        blockedRelease: 0
    });

    const handleCountsCalc = useCallback((newCounts: KpiData) => {
        setCounts(newCounts);
    }, []);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-3xl font-bold m-0 mb-4">Workspace</h1>
                <KpiStrip
                    data={counts}
                    activeFilter={activeKpiFilter}
                    onFilterChange={setActiveKpiFilter}
                />
            </div>

            <div className="flex border-b border-[var(--zen-border)]">
                <button
                    onClick={() => { setActiveTab('assignments'); setActiveKpiFilter(null); }}
                    className={clsx(
                        'px-6 py-3 font-semibold text-sm transition-colors border-b-2',
                        activeTab === 'assignments'
                            ? 'border-[var(--zen-primary)] text-[var(--zen-primary)]'
                            : 'border-transparent text-[var(--zen-muted)] hover:text-slate-800'
                    )}
                >
                    Assignments Queue
                </button>
                <button
                    onClick={() => { setActiveTab('repogen'); setActiveKpiFilter(null); }}
                    className={clsx(
                        'px-6 py-3 font-semibold text-sm transition-colors border-b-2',
                        activeTab === 'repogen'
                            ? 'border-[var(--zen-primary)] text-[var(--zen-primary)]'
                            : 'border-transparent text-[var(--zen-muted)] hover:text-slate-800'
                    )}
                >
                    Repogen Queue
                </button>
            </div>

            <div className="mt-2">
                {activeTab === 'assignments' && (
                    <AssignmentsQueue token={token} activeKpiFilter={activeKpiFilter} onCountsCalc={handleCountsCalc} />
                )}
                {activeTab === 'repogen' && (
                    <RepogenQueue token={token} activeKpiFilter={activeKpiFilter} onCountsCalc={handleCountsCalc} />
                )}
            </div>
        </div>
    );
}
