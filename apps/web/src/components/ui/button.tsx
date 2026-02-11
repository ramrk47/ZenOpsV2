import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../utils';

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-lg border border-[var(--zen-border)] px-4 text-sm font-semibold text-[var(--zen-text)] transition hover:-translate-y-0.5 hover:bg-[var(--zen-primary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
