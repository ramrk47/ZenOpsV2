import { useState, ReactNode } from 'react';
import { clsx } from 'clsx';
import { Link } from 'react-router-dom';

export interface AssignmentWorkspaceLayoutProps {
    assignmentId: string;
    title: string;
    subtitle?: string;
    statusBadge: ReactNode;
    headerActions?: ReactNode;
    activeTab: 'overview' | 'evidence' | 'tasks' | 'timeline' | 'chat';
    onTabChange: (tab: 'overview' | 'evidence' | 'tasks' | 'timeline' | 'chat') => void;
    children: ReactNode;
}

export function AssignmentWorkspaceLayout({
    assignmentId,
    title,
    subtitle,
    statusBadge,
    headerActions,
    activeTab,
    onTabChange,
    children
}: AssignmentWorkspaceLayoutProps) {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
                <Link to="/workspace" className="text-sm text-[var(--zen-muted)] hover:text-slate-800 transition-colors">
                    ← Back to Workspace
                </Link>

                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div>
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                            <h1 className="text-3xl font-bold m-0">{title}</h1>
                            {statusBadge}
                        </div>
                        {subtitle && <p className="text-sm text-[var(--zen-muted)] m-0">{subtitle}</p>}
                        <p className="text-xs text-[var(--zen-muted)] m-0 mt-1 uppercase tracking-wider">ID: {assignmentId}</p>
                    </div>

                    {headerActions && (
                        <div className="flex flex-wrap items-center gap-2">
                            {headerActions}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex border-b border-[var(--zen-border)] overflow-x-auto">
                <button
                    onClick={() => onTabChange('overview')}
                    className={clsx(
                        'px-6 py-3 font-semibold text-sm transition-colors border-b-2 whitespace-nowrap',
                        activeTab === 'overview'
                            ? 'border-[var(--zen-primary)] text-[var(--zen-primary)]'
                            : 'border-transparent text-[var(--zen-muted)] hover:text-slate-800'
                    )}
                >
                    Overview
                </button>
                <button
                    onClick={() => onTabChange('evidence')}
                    className={clsx(
                        'px-6 py-3 font-semibold text-sm transition-colors border-b-2 whitespace-nowrap',
                        activeTab === 'evidence'
                            ? 'border-[var(--zen-primary)] text-[var(--zen-primary)]'
                            : 'border-transparent text-[var(--zen-muted)] hover:text-slate-800'
                    )}
                >
                    Evidence Inbox
                </button>
                <button
                    onClick={() => onTabChange('tasks')}
                    className={clsx(
                        'px-6 py-3 font-semibold text-sm transition-colors border-b-2 whitespace-nowrap',
                        activeTab === 'tasks'
                            ? 'border-[var(--zen-primary)] text-[var(--zen-primary)]'
                            : 'border-transparent text-[var(--zen-muted)] hover:text-slate-800'
                    )}
                >
                    Tasks
                </button>
                <button
                    onClick={() => onTabChange('timeline')}
                    className={clsx(
                        'px-6 py-3 font-semibold text-sm transition-colors border-b-2 whitespace-nowrap',
                        activeTab === 'timeline'
                            ? 'border-[var(--zen-primary)] text-[var(--zen-primary)]'
                            : 'border-transparent text-[var(--zen-muted)] hover:text-slate-800'
                    )}
                >
                    Timeline
                </button>
                <button
                    onClick={() => onTabChange('chat')}
                    className={clsx(
                        'px-6 py-3 font-semibold text-sm transition-colors border-b-2 whitespace-nowrap',
                        activeTab === 'chat'
                            ? 'border-[var(--zen-primary)] text-[var(--zen-primary)]'
                            : 'border-transparent text-[var(--zen-muted)] hover:text-slate-800'
                    )}
                >
                    Chat & Notes
                </button>
            </div>

            <div className="mt-2 min-h-[500px]">
                {children}
            </div>
        </div>
    );
}
