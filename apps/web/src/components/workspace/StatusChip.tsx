import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface StatusChipProps {
  domain: 'assignment' | 'repogen' | 'billing';
  value: string;
  className?: string;
}

export function StatusChip({ domain, value, className }: StatusChipProps) {
  let colors = 'bg-slate-100 text-slate-800 border-slate-300';
  const valInfo = value.toLowerCase();

  if (domain === 'assignment') {
    if (valInfo === 'delivered' || valInfo === 'finalized' || valInfo === 'closed') {
      colors = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    } else if (valInfo === 'in_progress' || valInfo === 'draft_in_progress') {
      colors = 'bg-blue-100 text-blue-800 border-blue-300';
    } else if (valInfo === 'awaiting_docs' || valInfo === 'under_review') {
      colors = 'bg-amber-100 text-amber-900 border-amber-300';
    } else if (valInfo === 'cancelled') {
      colors = 'bg-red-100 text-red-800 border-red-300';
    }
  } else if (domain === 'repogen') {
    if (valInfo === 'ready_for_render') {
      colors = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    } else if (valInfo === 'evidence_pending' || valInfo === 'data_pending') {
      colors = 'bg-amber-100 text-amber-900 border-amber-300';
    } else if (valInfo === 'cancelled') {
      colors = 'bg-red-100 text-red-800 border-red-300';
    }
  } else if (domain === 'billing') {
    if (valInfo === 'paid' || valInfo === 'credit_consumed' || valInfo === 'credit_ok') {
      colors = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    } else if (valInfo === 'blocked' || valInfo === 'invoice_unpaid' || valInfo === 'credit_missing') {
      colors = 'bg-red-100 text-red-800 border-red-300';
    }
  }

  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wider',
          colors,
          className
        )
      )}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}
