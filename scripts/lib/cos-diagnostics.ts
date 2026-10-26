// Only these fixed, non-sensitive diagnostics may cross the SDK/log boundary.
const stages = new Set([
  'ARCHIVE_DUPLICATE',
  'ARCHIVE_ENTRY',
  'ARCHIVE_PATH',
  'ARCHIVE_PRIVATE',
  'ARCHIVE_SIZE',
  'BUCKET_VERSIONING',
  'BUCKET',
  'CATALOG_COMMIT_UNCONFIRMED',
  'CATALOG_CONFIRM',
  'CATALOG_COUNT',
  'CATALOG_SIZE',
  'CATALOG',
  'CONCURRENT_PUBLISH',
  'COS_ACCELERATE',
  'COS_BUCKET',
  'COS_CONCURRENCY',
  'COS_HEAD',
  'COS_HEADERS',
  'COS_READ',
  'COS_MULTIPART_SDK',
  'COS_MULTIPART_FILE',
  'COS_MULTIPART_INIT',
  'COS_MULTIPART_UPLOAD_ID',
  'COS_MULTIPART_PART',
  'COS_MULTIPART_ETAG',
  'COS_MULTIPART_COMPLETE',
  'COS_MULTIPART_PERMISSION',
  'COS_MULTIPART_ABORT',
  'COS_WRITE',
  'COS_SDK',
  'CREDENTIALS',
  'DESKTOP_SIGNATURE',
  'DIRECTORY',
  'DUPLICATE_VERSION',
  'DUPLICATE',
  'EMPTY_RELEASE',
  'EXISTING_OBJECT_CHANGED',
  'EXISTING_VERSION_CHANGED',
  'EXTRA_DIRECTORY',
  'EXTRA_FILE',
  'FILE_HASH',
  'FILE',
  'LINK',
  'MANIFEST_FILES',
  'MANIFEST_HASH',
  'MANIFEST_SIZE',
  'MANIFEST_VERSION',
  'MANIFEST',
  'PLATFORM',
  'PREFIX',
  'PUBLIC_URL',
  'REGION',
  'REMOTE_CATALOG_SIZE',
  'SIGNATURE',
]);
const providerCodes = new Set([
  'AccessDenied',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'RequestTimeTooSkewed',
  'NoSuchBucket',
  'InvalidBucketName',
  'AllAccessDisabled',
  'ExpiredToken',
  'InvalidToken',
  'NoSuchKey',
  'NotFound',
  'NoSuchObject',
  'PreconditionFailed',
  'PermanentRedirect',
  'InvalidRequest',
  'BadDigest',
  'EntityTooLarge',
  'ObjectAlreadyExists',
  'SlowDown',
  'InternalError',
  'ServiceUnavailable',
  'RequestTimeout',
  'RequestTimeOut',
  'IncompleteBody',
  'EntitySizeNotMatch',
  'InvalidDigest',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'NoSuchUpload',
  'InvalidPart',
  'InvalidPartOrder',
]);

export class CosPublishError extends Error {
  readonly status?: number;
  readonly providerCode?: string;
  constructor(
    public readonly code: string,
    source?: unknown,
  ) {
    super(
      stages.has(code)
        ? `COS 镜像发布未完成（${code}）。请查看固定诊断代码，不要重置现有镜像或资料。`
        : 'COS 镜像发布未完成。请查看固定诊断代码，不要重置现有镜像或资料。',
    );
    // Do not keep the original SDK error, message, request, headers, URL or cause.
    if (source && typeof source === 'object') {
      const value = source as { statusCode?: unknown; code?: unknown; error?: { Code?: unknown } };
      if (
        typeof value.statusCode === 'number' &&
        Number.isInteger(value.statusCode) &&
        value.statusCode >= 100 &&
        value.statusCode <= 599
      )
        this.status = value.statusCode;
      const candidate = value.error?.Code ?? value.code;
      if (typeof candidate === 'string' && providerCodes.has(candidate))
        this.providerCode = candidate;
    }
  }
}

/** Never format arbitrary exceptions or their properties, even if they resemble SDK errors. */
export function formatCosDiagnostic(error: unknown): string | undefined {
  if (!(error instanceof CosPublishError) || !stages.has(error.code)) return undefined;
  return [error.code, error.status ? `HTTP_${error.status}` : undefined, error.providerCode]
    .filter(Boolean)
    .join(' / ');
}
