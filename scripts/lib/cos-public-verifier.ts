import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createUpdateDownloader, validateUpdateUrl } from '../../server/update-download';
import { CosPublishError } from './cos-diagnostics';

const MAX_FILE = 512 * 1024 ** 2;
const TOTAL_MS = 3 * 60 * 60 * 1000;
const ATTEMPTS = 3;
type Download = ReturnType<typeof createUpdateDownloader>['downloadUpdateFile'];
type Classification = {
  code: string;
  retryable: boolean;
  status?: number;
  providerCode?: string;
};
const stages = new Set([
  'COS_PUBLIC_READ',
  'COS_PUBLIC_READ_TIMEOUT',
  'COS_PUBLIC_READ_NETWORK',
  'COS_PUBLIC_READ_HTTP',
  'COS_PUBLIC_READ_HASH',
  'COS_PUBLIC_READ_SIZE',
  'COS_PUBLIC_READ_ADDRESS',
  'COS_PUBLIC_READ_TLS',
  'COS_PUBLIC_READ_DISK',
  'COS_PUBLIC_READ_CLEANUP',
]);
const networkCodes = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
]);
const timeoutMessages = new Set([
  '更新下载超过总时限',
  '更新服务器连接或响应超时',
  '更新下载等待数据超时',
]);
const sizeMessages = new Set([
  '更新包大小或校验信息无效',
  '更新服务器返回了无效的文件大小',
  '更新包声明的大小与发行信息不一致',
  '更新包实际大小超过发行信息',
]);
const addressMessages = new Set([
  '更新地址格式不正确',
  '更新地址必须使用不含凭据的公开 HTTPS 地址',
  '更新服务器解析到了非公开网络地址',
  '更新下载重定向次数过多',
  '更新服务器重定向缺少地址',
  '更新服务器重定向地址无效',
]);
const tlsCodes = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
]);
const diskCodes = new Set([
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EROFS',
  'EMFILE',
  'ENFILE',
  'EIO',
  'EBUSY',
  'EEXIST',
  'ENOENT',
]);

function classify(error: unknown): Classification {
  // Compare only known local downloader messages. Never retain or print them,
  // arbitrary SDK/transport objects, URLs, response headers or error causes.
  const value = error as { code?: unknown; message?: unknown } | undefined;
  const code = typeof value?.code === 'string' ? value.code : undefined;
  const message = typeof value?.message === 'string' ? value.message : undefined;
  if (message === '更新包 SHA-256 校验失败')
    return { code: 'COS_PUBLIC_READ_HASH', retryable: false };
  if (message && sizeMessages.has(message))
    return { code: 'COS_PUBLIC_READ_SIZE', retryable: false };
  if ((message && addressMessages.has(message)) || code === 'ENOTFOUND')
    return { code: 'COS_PUBLIC_READ_ADDRESS', retryable: false };
  if (code && (tlsCodes.has(code) || /^ERR_(?:TLS|SSL)_/.test(code)))
    return { code: 'COS_PUBLIC_READ_TLS', retryable: false };
  if ((code && diskCodes.has(code)) || message === '更新包写入未能完成')
    return { code: 'COS_PUBLIC_READ_DISK', retryable: false };
  if (message && timeoutMessages.has(message))
    return { code: 'COS_PUBLIC_READ_TIMEOUT', retryable: true };
  if (message === '更新包传输不完整') return { code: 'COS_PUBLIC_READ_NETWORK', retryable: true };
  const http = message?.match(/^更新服务器返回 HTTP ([1-5]\d{2})$/);
  if (http) {
    const status = Number(http[1]);
    return {
      code: 'COS_PUBLIC_READ_HTTP',
      status,
      retryable: status === 408 || status === 429 || status >= 500,
    };
  }
  if (code && networkCodes.has(code))
    return { code: 'COS_PUBLIC_READ_NETWORK', providerCode: code, retryable: true };
  return { code: 'COS_PUBLIC_READ', retryable: false };
}

function safeFailure(failure: Classification): CosPublishError {
  return new CosPublishError(failure.code, {
    statusCode: failure.status,
    code: failure.providerCode,
  });
}

/** Maintenance-only anonymous readback. It never writes to COS or changes app download policy. */
export function createPublicVerifier(
  options: {
    download?: Download;
    wait?: (ms: number) => Promise<unknown>;
    now?: () => number;
  } = {},
) {
  const wait = options.wait ?? delay;
  const now = options.now ?? Date.now;
  return async (
    file: { bytes: number; sha256: string },
    url: string,
    onRetry?: (attempt: number) => void,
  ): Promise<void> => {
    try {
      if (
        !Number.isSafeInteger(file.bytes) ||
        file.bytes <= 0 ||
        file.bytes > MAX_FILE ||
        !/^[a-fA-F0-9]{64}$/.test(file.sha256)
      )
        throw safeFailure({ code: 'COS_PUBLIC_READ_SIZE', retryable: false });
      validateUpdateUrl(url);
      const deadline = now() + TOTAL_MS;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        const remaining = deadline - now();
        if (remaining <= 0)
          throw safeFailure({ code: 'COS_PUBLIC_READ_TIMEOUT', retryable: false });
        if (attempt > 1) onRetry?.(attempt);
        let temporary: string;
        try {
          // A new, owned directory and wx download file for every attempt;
          // never resume partial bytes or touch the user's data directory.
          temporary = await mkdtemp(path.join(os.tmpdir(), 'chronicle-cos-public-'));
        } catch {
          throw safeFailure({ code: 'COS_PUBLIC_READ_DISK', retryable: false });
        }
        let failure: Classification | undefined;
        try {
          const download =
            options.download ??
            createUpdateDownloader({
              fileLimit: MAX_FILE,
              // All attempts share the original three-hour per-file budget.
              // Header (20s), idle (30s), TLS, DNS pinning and SHA stay intact.
              timeouts: { totalMs: Math.max(1, deadline - now()) },
            }).downloadUpdateFile;
          await download(
            url,
            path.join(temporary, 'download'),
            { bytes: file.bytes, sha256: file.sha256 },
            () => {},
          );
          if (now() >= deadline) failure = { code: 'COS_PUBLIC_READ_TIMEOUT', retryable: false };
        } catch (error) {
          failure = classify(error);
        }
        try {
          // Only this mkdtemp directory. A cleanup failure cannot become success.
          await rm(temporary, { recursive: true, force: true });
        } catch {
          throw safeFailure({ code: 'COS_PUBLIC_READ_CLEANUP', retryable: false });
        }
        if (!failure) return;
        if (!failure.retryable || attempt === ATTEMPTS) throw safeFailure(failure);
        const pause = attempt * 3000;
        if (deadline - now() <= pause)
          throw safeFailure({ code: 'COS_PUBLIC_READ_TIMEOUT', retryable: false });
        await wait(pause);
      }
    } catch (error) {
      if (error instanceof CosPublishError && stages.has(error.code))
        throw new CosPublishError(error.code, {
          statusCode: error.status,
          code: error.providerCode,
        });
      throw safeFailure(classify(error));
    }
  };
}
