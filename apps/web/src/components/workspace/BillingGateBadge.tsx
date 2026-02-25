import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface BillingGateBadgeProps {
    mode: 'CREDIT' | 'POSTPAID' | null;
    reservationPresent: boolean;
    isPaid: boolean | null;
    releasable: boolean;
    className?: string;
}

export function BillingGateBadge({
    mode,
    reservationPresent,
    isPaid,
    releasable,
    className,
}: BillingGateBadgeProps) {
    if (!mode) return null;

    let label = '';
    let color = 'bg-slate-50 text-slate-700 border-slate-300';
    let icon = '';

    if (mode === 'CREDIT') {
        if (releasable || reservationPresent) {
            label = 'Credit OK';
            color = 'bg-emerald-50 text-emerald-700 border-emerald-300';
            icon = '✅';
        } else {
            label = 'Credit missing';
            color = 'bg-red-50 text-red-700 border-red-300';
            icon = '❗';
        }
    } else if (mode === 'POSTPAID') {
        if (releasable || isPaid) {
            label = 'Invoice paid';
            color = 'bg-emerald-50 text-emerald-700 border-emerald-300';
            icon = '✅';
        } else {
            label = 'Invoice unpaid';
            color = 'bg-red-50 text-red-700 border-red-300';
            icon = '❗';
        }
    }

    return (
        <span
            className={twMerge(
                clsx(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold',
                    color,
                    className
                )
            )}
            title="Billing Gate Status"
        >
            <span>{icon}</span> {label}
        </span>
    );
}
