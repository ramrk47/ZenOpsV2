import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface KpiData {
    open: number;
    dueSoon: number;
    overdue: number;
    missingEvidence: number;
    blockedRelease: number;
}

export interface KpiStripProps {
    data: KpiData;
    activeFilter: keyof KpiData | null;
    onFilterChange: (filter: keyof KpiData | null) => void;
    className?: string;
}

export function KpiStrip({ data, activeFilter, onFilterChange, className }: KpiStripProps) {
    const cards = [
        { key: 'open', label: 'Open items', count: data.open, color: 'text-blue-700' },
        { key: 'dueSoon', label: 'Due soon', count: data.dueSoon, color: 'text-amber-600' },
        { key: 'overdue', label: 'Overdue', count: data.overdue, color: 'text-red-700' },
        { key: 'missingEvidence', label: 'Missing evidence', count: data.missingEvidence, color: 'text-amber-700' },
        { key: 'blockedRelease', label: 'Blocked release', count: data.blockedRelease, color: 'text-purple-700' },
    ] as const;

    return (
        <div className={twMerge('flex gap-3 overflow-x-auto pb-2', className)}>
            {cards.map((card) => {
                const isActive = activeFilter === card.key;
                return (
                    <button
                        key={card.key}
                        onClick={() => onFilterChange(isActive ? null : card.key)}
                        className={twMerge(
                            'flex min-w-[120px] flex-col rounded-lg border p-3 text-left transition-colors',
                            isActive
                                ? 'border-[var(--zen-primary)] bg-slate-50 ring-1 ring-[var(--zen-primary)]'
                                : 'border-[var(--zen-border)] bg-white hover:bg-slate-50'
                        )}
                    >
                        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--zen-muted)]">
                            {card.label}
                        </span>
                        <span className={twMerge('mt-1 text-2xl font-bold', card.color)}>{card.count}</span>
                    </button>
                );
            })}
        </div>
    );
}
