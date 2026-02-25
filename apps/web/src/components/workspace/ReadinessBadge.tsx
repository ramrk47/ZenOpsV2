import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ReadinessBadgeProps {
    score?: number | null;
    missingEvidenceCount?: number;
    warningsCount?: number;
    className?: string;
}

export function ReadinessBadge({
    score,
    missingEvidenceCount = 0,
    warningsCount = 0,
    className,
}: ReadinessBadgeProps) {
    let state: 'ready' | 'missing' | 'blocked' | 'unknown' = 'unknown';
    let label = 'Unknown';

    if (score !== undefined && score !== null) {
        if (score >= 100 && missingEvidenceCount === 0 && warningsCount === 0) {
            state = 'ready';
            label = 'Ready';
        } else if (missingEvidenceCount > 0) {
            state = 'missing';
            label = `Missing ${missingEvidenceCount} doc${missingEvidenceCount > 1 ? 's' : ''}`;
        } else if (warningsCount > 0 || score < 100) {
            state = 'blocked';
            label = `${score}% Data`;
        }
    } else if (missingEvidenceCount > 0) {
        state = 'missing';
        label = `Missing ${missingEvidenceCount} doc${missingEvidenceCount > 1 ? 's' : ''}`;
    }

    return (
        <span
            className={twMerge(
                clsx(
                    'inline-flex items-center gap-1 rounded bg-slate-50 px-2 py-1 text-xs border font-medium',
                    state === 'ready' && 'border-emerald-300 text-emerald-700',
                    state === 'missing' && 'border-amber-300 text-amber-700',
                    state === 'blocked' && 'border-red-300 text-red-700',
                    state === 'unknown' && 'border-slate-300 text-slate-600',
                    className
                )
            )}
        >
            {state === 'ready' && '✅'}
            {state === 'missing' && '⚠️'}
            {state === 'blocked' && '❗'}
            {label}
        </span>
    );
}
