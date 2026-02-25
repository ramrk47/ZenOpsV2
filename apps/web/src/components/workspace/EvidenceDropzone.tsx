import { useState, useRef } from 'react';
import { Button } from '../ui/button';
import { clsx } from 'clsx';

export interface EvidenceDropzoneProps {
    assignmentId: string;
    token: string;
    onUploadComplete: () => void;
}

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

export function EvidenceDropzone({ assignmentId, token, onUploadComplete }: EvidenceDropzoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [category, setCategory] = useState('SITE_PHOTO');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const categories = [
        { value: 'SITE_PHOTO', label: 'Site Photo' },
        { value: 'AADHAAR', label: 'Aadhaar Card (KYC)' },
        { value: 'SALE_DEED', label: 'Sale Deed' },
        { value: 'TAX_RECEIPT', label: 'Tax Receipt' },
        { value: 'PLAN', label: 'Approval Plan' },
        { value: 'OTHER', label: 'Other Document' }
    ];

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const processFile = async (file: File) => {
        if (!file) return;
        setUploading(true);
        setError('');

        // Simulated direct upload to storage for V2 since V1 was multipart
        // In a real V2 implementation this would likely fetch a presigned URL first
        // For M5.6.2 we use the legacy assignment/documents endpoint to ensure V1 parity is maintained

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('purpose', category === 'SITE_PHOTO' ? 'photo' : 'evidence');
            formData.append('classification', category);
            formData.append('source', 'desktop_upload');

            const response = await fetch(`${API}/assignments/${assignmentId}/documents`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${await response.text()}`);
            }

            onUploadComplete();
        } catch (err: any) {
            setError(err.message || 'Failed to upload file');
        } finally {
            setUploading(false);
            setIsDragging(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            // Process first file for simplicity
            await processFile(e.dataTransfer.files[0]);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            await processFile(e.target.files[0]);
        }
    };

    return (
        <div className="card flex flex-col gap-4">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold m-0">Evidence Inbox</h2>
                    <p className="text-sm text-[var(--zen-muted)] m-0">Upload documents and photos to the workspace context.</p>
                </div>

                <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold text-[var(--zen-muted)]">Category</label>
                    <select
                        className="rounded-lg border border-[var(--zen-border)] px-3 py-1.5 text-sm bg-white"
                        value={category}
                        onChange={e => setCategory(e.target.value)}
                        disabled={uploading}
                    >
                        {categories.map(c => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {error && <div className="text-sm text-red-700 bg-red-50 p-3 rounded">{error}</div>}

            <div
                className={clsx(
                    "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-colors text-center cursor-pointer",
                    isDragging
                        ? "border-[var(--zen-primary)] bg-blue-50"
                        : "border-slate-300 hover:border-slate-400 hover:bg-slate-50",
                    uploading && "opacity-50 cursor-not-allowed pointer-events-none"
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleFileChange}
                    accept="image/*,application/pdf"
                />

                <div className="text-4xl mb-3 text-slate-400">
                    {uploading ? '⏳' : '📥'}
                </div>

                <p className="font-semibold m-0 mb-1">
                    {uploading ? 'Uploading to Evidence Inbox...' : 'Click to upload or drag and drop'}
                </p>

                {!uploading && (
                    <p className="text-sm text-[var(--zen-muted)] m-0">
                        PDFs or Images up to 20MB. Selected category: <span className="font-semibold">{categories.find(c => c.value === category)?.label}</span>
                    </p>
                )}
            </div>
        </div>
    );
}
