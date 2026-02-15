import { mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PresignUploadInput {
  key: string;
  contentType: string;
  contentLength: number;
  checksum?: string;
}

export interface PresignUploadOutput {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface PresignDownloadInput {
  key: string;
  expiresIn?: number;
}

export interface PresignDownloadOutput {
  url: string;
  expiresAt: string;
}

export interface DeleteObjectInput {
  key: string;
}

export interface StorageProvider {
  presignUpload(input: PresignUploadInput): Promise<PresignUploadOutput>;
  presignDownload(input: PresignDownloadInput): Promise<PresignDownloadOutput>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
}

export interface S3CompatibleProviderConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  publicBaseUrl?: string;
}

export class S3CompatibleProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly config: S3CompatibleProviderConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? false,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignUploadOutput> {
    const expiresIn = 900;
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
      ...(input.checksum ? { ChecksumSHA256: input.checksum } : {})
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const headers: Record<string, string> = {
      'content-type': input.contentType
    };

    if (input.checksum) {
      headers['x-amz-checksum-sha256'] = input.checksum;
    }

    return {
      url,
      method: 'PUT',
      headers,
      expiresAt
    };
  }

  async presignDownload(input: PresignDownloadInput): Promise<PresignDownloadOutput> {
    const expiresIn = input.expiresIn ?? 900;
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key
    });

    const signed = await getSignedUrl(this.client, command, { expiresIn });

    if (this.config.publicBaseUrl) {
      return {
        url: `${this.config.publicBaseUrl.replace(/\/$/, '')}/${input.key}`,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
      };
    }

    return {
      url: signed,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key
      })
    );
  }
}

export interface LocalDiskProviderConfig {
  rootDir: string;
  baseUrl?: string;
}

export class LocalDiskProvider implements StorageProvider {
  constructor(private readonly config: LocalDiskProviderConfig) {}

  async presignUpload(input: PresignUploadInput): Promise<PresignUploadOutput> {
    const filePath = join(this.config.rootDir, input.key);
    await mkdir(dirname(filePath), { recursive: true });

    const base = this.config.baseUrl ?? 'http://localhost:3000/local-storage';

    return {
      url: `${base.replace(/\/$/, '')}/${encodeURIComponent(input.key)}`,
      method: 'PUT',
      headers: {
        'content-type': input.contentType,
        'x-local-file-path': filePath
      },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };
  }

  async presignDownload(input: PresignDownloadInput): Promise<PresignDownloadOutput> {
    const base = this.config.baseUrl ?? 'http://localhost:3000/local-storage';

    return {
      url: `${base.replace(/\/$/, '')}/${encodeURIComponent(input.key)}`,
      expiresAt: new Date(Date.now() + (input.expiresIn ?? 900) * 1000).toISOString()
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    const filePath = join(this.config.rootDir, input.key);
    try {
      await unlink(filePath);
    } catch {
      // Keep delete idempotent.
    }
  }
}

export const buildStorageKey = (tenantId: string, entity: string, fileName: string): string => {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${tenantId}/${entity}/${randomUUID()}-${safeName}`;
};
