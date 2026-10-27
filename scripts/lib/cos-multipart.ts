import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { CosPublishError } from './cos-diagnostics';

export const COS_MULTIPART_THRESHOLD = 8 * 1024 ** 2;
// Keep requests short on slow cross-border links; COS permits 1 MiB parts.
export const COS_MULTIPART_PART_BYTES = 1024 ** 2;

export interface CosMultipartClient {
  multipartInit(params: Record<string, unknown>): Promise<any>;
  multipartUpload(params: Record<string, unknown>): Promise<any>;
  multipartComplete(params: Record<string, unknown>): Promise<any>;
  multipartAbort(params: Record<string, unknown>): Promise<any>;
}

interface MultipartInput {
  key: string;
  file: string;
  bytes: number;
  sha256: string;
  onProgress?: (progress: { loaded?: unknown }) => void;
  onPartRetry?: (attempt: number, partNumber: number, partCount: number) => void;
  onCleanupFailure?: () => void;
}

function requireValue(value: unknown, code: string): asserts value {
  if (!value) throw new CosPublishError(code);
}

function failure(stage: string, error: unknown): CosPublishError {
  if (error instanceof CosPublishError) return error;
  const status = (error as { statusCode?: unknown } | undefined)?.statusCode;
  return new CosPublishError(status === 403 ? 'COS_MULTIPART_PERMISSION' : stage, error);
}

function noSuchUpload(error: unknown): boolean {
  const value = error as { statusCode?: unknown; code?: unknown; error?: { Code?: unknown } };
  return value?.statusCode === 404 && (value.error?.Code ?? value.code) === 'NoSuchUpload';
}

function retryablePart(error: unknown, retryable: (error: unknown) => boolean): boolean {
  if (retryable(error)) return true;
  if (!error || typeof error !== 'object' || error instanceof CosPublishError) return false;
  const value = error as { statusCode?: unknown; code?: unknown; error?: { Code?: unknown } };
  const code = value.error?.Code ?? value.code;
  // The fixed SDK uses literal "400" when no COS Error/Code was returned.
  // Replaying identical bytes under our own UploadId + PartNumber is safe even
  // after a lost reply. Never extend this exception to Init, Complete, a whole
  // object PUT or a catalog write, or swallow an explicit provider error.
  return value.statusCode === 400 && (code === undefined || code === '400');
}

/**
 * Upload only this invocation's private multipart session. Completed objects are
 * never deleted or overwritten; the caller still performs anonymous full SHA
 * verification before it can publish a catalog. No cloud session is adopted by
 * key, and no List/cleanup operation scans another publisher's sessions.
 */
export async function uploadCosMultipart({
  client,
  base,
  input,
  head,
  retryable,
  wait = delay,
  openFile = open,
}: {
  client: Partial<CosMultipartClient>;
  base: { Bucket: string; Region: string };
  input: MultipartInput;
  head: (key: string) => Promise<{ bytes: number } | undefined>;
  retryable: (error: unknown) => boolean;
  wait?: (milliseconds: number) => Promise<unknown>;
  openFile?: typeof open;
}): Promise<void> {
  const { multipartInit, multipartUpload, multipartComplete, multipartAbort } = client;
  requireValue(
    typeof multipartInit === 'function' &&
      typeof multipartUpload === 'function' &&
      typeof multipartComplete === 'function' &&
      typeof multipartAbort === 'function',
    'COS_MULTIPART_SDK',
  );
  requireValue(
    Number.isSafeInteger(input.bytes) &&
      input.bytes >= COS_MULTIPART_THRESHOLD &&
      input.bytes <= 512 * 1024 ** 2 &&
      /^[a-f0-9]{64}$/.test(input.sha256),
    'COS_MULTIPART_FILE',
  );
  const partCount = Math.ceil(input.bytes / COS_MULTIPART_PART_BYTES);
  let handle;
  try {
    handle = await openFile(input.file, 'r');
    const stat = await handle.stat();
    requireValue(stat.isFile() && stat.size === input.bytes, 'COS_MULTIPART_FILE');
  } catch (error) {
    await handle?.close().catch(() => undefined);
    throw failure('COS_MULTIPART_FILE', error);
  }
  let uploadId: string | undefined;
  let committed = false;
  let cleanupRecoveredSession = false;
  let primaryFailure: unknown;
  try {
    // The publisher checked HEAD before choosing a write. Check once more at
    // this boundary so a completed object is reused instead of creating chunks.
    const existing = await head(input.key);
    if (existing) {
      requireValue(existing.bytes === input.bytes, 'EXISTING_OBJECT_CHANGED');
      committed = true;
      return;
    }
    let started;
    try {
      started = await multipartInit.call(client, {
        ...base,
        Key: input.key,
        ContentType: input.key.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : 'application/octet-stream',
        CacheControl: 'public, max-age=31536000, immutable',
        Headers: {
          'x-cos-meta-sha256': input.sha256,
          'x-cos-forbid-overwrite': 'true',
        },
      });
    } catch (error) {
      // Do not repeatedly create sessions after an ambiguous initialization.
      throw failure('COS_MULTIPART_INIT', error);
    }
    requireValue(
      typeof started?.UploadId === 'string' &&
        started.UploadId.length > 0 &&
        started.UploadId.length <= 2048 &&
        !/[\x00-\x20\x7f]/.test(started.UploadId),
      'COS_MULTIPART_UPLOAD_ID',
    );
    uploadId = started.UploadId;
    const parts: { PartNumber: number; ETag: string }[] = [];
    const fullHash = createHash('sha256');
    let offset = 0;
    while (offset < input.bytes) {
      const partOffset = offset;
      const partNumber = parts.length + 1;
      const length = Math.min(COS_MULTIPART_PART_BYTES, input.bytes - offset);
      const chunk = Buffer.allocUnsafe(length);
      let read = 0;
      while (read < length) {
        let result;
        try {
          result = await handle.read(chunk, read, length - read, offset + read);
        } catch (error) {
          throw failure('COS_MULTIPART_FILE', error);
        }
        requireValue(result.bytesRead > 0, 'COS_MULTIPART_FILE');
        read += result.bytesRead;
      }
      fullHash.update(chunk);
      const md5 = createHash('md5').update(chunk).digest('base64');
      let etag: string | undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        // Each attempt owns fresh bytes/stream. A stream also prevents the SDK's
        // opaque four-attempt replay path from multiplying our part retry bound.
        const stream = Readable.from(Buffer.from(chunk));
        stream.on('error', () => {});
        try {
          const uploaded = await multipartUpload.call(client, {
            ...base,
            Key: input.key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: stream,
            ContentLength: length,
            ContentMD5: md5,
            ...(input.onProgress
              ? {
                  onProgress: (progress: { loaded?: unknown }) => {
                    if (typeof progress?.loaded === 'number' && Number.isFinite(progress.loaded))
                      input.onProgress?.({
                        loaded: partOffset + Math.max(0, Math.min(length, progress.loaded)),
                      });
                  },
                }
              : {}),
          });
          requireValue(
            typeof uploaded?.ETag === 'string' &&
              /^(?:"[a-fA-F0-9]{32}"|[a-fA-F0-9]{32})$/.test(uploaded.ETag),
            'COS_MULTIPART_ETAG',
          );
          etag = uploaded.ETag;
          break;
        } catch (error) {
          stream.destroy();
          if (!retryablePart(error, retryable) || attempt === 3)
            throw failure('COS_MULTIPART_PART', error);
          await wait(attempt * 3000);
          input.onPartRetry?.(attempt + 1, partNumber, partCount);
        } finally {
          stream.destroy();
        }
      }
      requireValue(etag, 'COS_MULTIPART_ETAG');
      parts.push({ PartNumber: partNumber, ETag: etag });
      offset += length;
      input.onProgress?.({ loaded: offset });
    }
    requireValue(fullHash.digest('hex') === input.sha256, 'FILE_HASH');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await multipartComplete.call(client, {
          ...base,
          Key: input.key,
          UploadId: uploadId,
          Parts: parts.map((part) => ({ ...part })),
          // Explicit low-level Headers are essential: the SDK's high-level
          // sliceUploadFile completion drops this no-overwrite safeguard.
          Headers: { 'x-cos-forbid-overwrite': 'true' },
        });
        committed = true;
        return;
      } catch (error) {
        // A valid object may exist even when completion's reply was lost or an
        // SDK internal replay received NoSuchUpload. HEAD is only a recovery
        // hint: anonymous full SHA remains mandatory in publishCosMirror.
        const present = await head(input.key);
        if (present) {
          requireValue(present.bytes === input.bytes, 'EXISTING_OBJECT_CHANGED');
          committed = true;
          // A guarded collision may belong to another completed write while
          // our private session still has chunks. Abort only our known ID;
          // after our own successful completion COS returns NoSuchUpload.
          cleanupRecoveredSession = true;
          return;
        }
        if (!retryable(error) || attempt === 3) throw failure('COS_MULTIPART_COMPLETE', error);
        await wait(attempt * 3000);
      }
    }
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    let cleanupFailure: CosPublishError | undefined;
    try {
      await handle.close();
    } catch (error) {
      cleanupFailure = failure('COS_MULTIPART_FILE', error);
    }
    if (uploadId && (!committed || cleanupRecoveredSession)) {
      try {
        await multipartAbort.call(client, { ...base, Key: input.key, UploadId: uploadId });
      } catch (error) {
        if (!noSuchUpload(error)) {
          input.onCleanupFailure?.();
          // Keep the original failure for diagnostics. Abort is restricted to
          // our exact session, and failure must never become DeleteObject.
          cleanupFailure ||= failure('COS_MULTIPART_ABORT', error);
        }
      }
    }
    if (!primaryFailure && cleanupFailure) throw cleanupFailure;
  }
}
