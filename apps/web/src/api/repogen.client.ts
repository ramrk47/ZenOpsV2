export interface ArtifactInfo {
    id: string;
    kind: 'docx' | 'pdf' | 'zip';
    filename: string;
    mime_type: string;
    size_bytes: number;
    checksum_sha256: string | null;
    metadata_json: Record<string, unknown>;
    created_at: string;
}

export interface PackArtifactsResponse {
    pack_id: string;
    artifacts: ArtifactInfo[];
}

export interface PresignedUrlResponse {
    url: string;
    expiresAt: string;
}

export class RepogenClient {
    constructor(private readonly baseUrl: string, private readonly token: string) { }

    private get headers() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        };
    }

    async listPackArtifacts(assignmentId: string, packId: string): Promise<PackArtifactsResponse> {
        const res = await fetch(`${this.baseUrl}/assignments/${assignmentId}/report-generation/packs/${packId}/artifacts`, {
            headers: this.headers
        });
        if (!res.ok) throw new Error('Failed to fetch pack artifacts');
        return res.json();
    }

    async finalizePack(assignmentId: string, packId: string, notes?: string): Promise<any> {
        const res = await fetch(`${this.baseUrl}/assignments/${assignmentId}/report-generation/packs/${packId}/finalize`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({ notes })
        });
        if (!res.ok) throw new Error('Failed to finalize pack');
        return res.json();
    }

    async getPresignedUrl(artifactId: string): Promise<PresignedUrlResponse> {
        const res = await fetch(`${this.baseUrl}/report-generation/artifacts/${artifactId}/presigned`, {
            headers: this.headers
        });
        if (!res.ok) throw new Error(`Failed to get presigned URL for artifact ${artifactId}`);
        return res.json();
    }
}
