import { ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ReadinessBadge } from './ReadinessBadge';
import { BillingGateBadge } from './BillingGateBadge';

export interface QuickPreviewSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle: string;
    details: { label: string; value: ReactNode }[];
    readiness?: {
        score: number | null;
        missingEvidenceCount: number;
        warningsCount: number;
    };
    billing?: {
        mode: 'CREDIT' | 'POSTPAID' | null;
        reservationPresent: boolean;
        isPaid: boolean | null;
        releasable: boolean;
    };
    nextAction?: {
        label: string;
        onClick: () => void;
    };
    secondaryActions?: {
        label: string;
        onClick: () => void;
    }[];
    badges?: {
        label: string;
        variant: 'red' | 'amber' | 'emerald' | 'slate';
    }[];
    links: { label: string; href: string }[];
}

export function QuickPreviewSidebar({
    isOpen,
    onClose,
    title,
    subtitle,
    details,
    readiness,
    billing,
    nextAction,
    secondaryActions,
    badges,
    links
}: QuickPreviewSidebarProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col border-l border-[var(--zen-border)] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--zen-border)] p-4">
                <h2 className="m-0 text-lg font-bold">Quick Preview</h2>
                <button
                    onClick={onClose}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Close"
                >
                    ✕
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                <div>
                    <h3 className="m-0 text-xl font-bold text-[var(--zen-primary)]">{title}</h3>
                    <p className="m-0 mt-1 text-sm text-[var(--zen-muted)]">{subtitle}</p>
                    {badges && badges.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {badges.map((badge, idx) => (
                                <span key={idx} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-${badge.variant}-100 text-${badge.variant}-800`}>
                                    {badge.label}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {(readiness || billing) && (
                    <div className="flex flex-col gap-2 rounded-lg border border-[var(--zen-border)] bg-slate-50 p-3 flex-wrap">
                        {readiness && (
                            <ReadinessBadge
                                score={readiness.score}
                                missingEvidenceCount={readiness.missingEvidenceCount}
                                warningsCount={readiness.warningsCount}
                            />
                        )}
                        {billing && (
                            <BillingGateBadge
                                mode={billing.mode}
                                reservationPresent={billing.reservationPresent}
                                isPaid={billing.isPaid}
                                releasable={billing.releasable}
                            />
                        )}
                    </div>
                )}

                {(nextAction || (secondaryActions && secondaryActions.length > 0)) && (
                    <div className="space-y-2">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--zen-muted)]">Actions</p>
                        {nextAction && (
                            <button
                                onClick={nextAction.onClick}
                                className="w-full rounded-lg bg-[var(--zen-primary)] px-4 py-2 text-sm font-bold text-white hover:bg-opacity-90 transition-colors"
                            >
                                {nextAction.label}
                            </button>
                        )}
                        {secondaryActions && secondaryActions.map((action, idx) => (
                            <button
                                key={idx}
                                onClick={action.onClick}
                                className="w-full rounded-lg border border-[var(--zen-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--zen-text)] hover:bg-slate-50 transition-colors"
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}

                <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--zen-muted)]">Key Details</p>
                    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        {details.map((detail, idx) => (
                            <div key={idx} className={detail.value && String(detail.value).length > 20 ? 'col-span-2' : ''}>
                                <dt className="text-[var(--zen-muted)]">{detail.label}</dt>
                                <dd className="m-0 font-medium">{detail.value ?? '-'}</dd>
                            </div>
                        ))}
                    </dl>
                </div>

                <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--zen-muted)]">Quick Links</p>
                    <div className="flex flex-col gap-2">
                        {links.map((link, idx) => (
                            <a
                                key={idx}
                                href={link.href}
                                className="inline-flex items-center text-sm font-medium text-[var(--zen-primary)] hover:underline"
                            >
                                {link.label} →
                            </a>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
