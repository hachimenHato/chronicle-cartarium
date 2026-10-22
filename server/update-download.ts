import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { open, unlink } from 'node:fs/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';

const JSON_LIMIT = 1024 * 1024;
const FILE_LIMIT = 128 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const SIGNED_ASSET_HOSTS = new Set([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
}

function ipv4In(address: number, network: string, bits: number): boolean {
  return (
    Math.floor(address / 2 ** (32 - bits)) === Math.floor(ipv4Number(network) / 2 ** (32 - bits))
  );
}

function ipv6Number(address: string): bigint {
  let input = address.toLowerCase();
  if (input.includes('.')) {
    const colon = input.lastIndexOf(':');
    const ipv4 = ipv4Number(input.slice(colon + 1));
    input = `${input.slice(0, colon)}:${Math.floor(ipv4 / 65536).toString(16)}:${(ipv4 % 65536).toString(16)}`;
  }
  const [left, right] = input.split('::');
  const first = left ? left.split(':') : [];
  const last = right ? right.split(':') : [];
  const words = input.includes('::')
    ? [...first, ...Array(8 - first.length - last.length).fill('0'), ...last]
    : first;
  return words.reduce((value, word) => (value << 16n) + BigInt(`0x${word}`), 0n);
}

function ipv6In(address: bigint, network: string, bits: number): boolean {
  return address >> BigInt(128 - bits) === ipv6Number(network) >> BigInt(128 - bits);
}

/** Accept only globally routable unicast addresses, including checked IPv4-mapped IPv6. */
export function isPublicUpdateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const number = ipv4Number(address);
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([network, bits]) => ipv4In(number, network as string, bits as number));
  }
  if (version !== 6 || address.includes('%')) return false;
  const number = ipv6Number(address);
  if (number >> 32n === 0xffffn) {
    const ipv4 = Number(number & 0xffffffffn);
    return isPublicUpdateAddress([24, 16, 8, 0].map((shift) => (ipv4 >>> shift) & 255).join('.'));
  }
  // IPv6 global unicast only. Special-purpose transition, benchmarking and
  // documentation allocations are deliberately excluded, even if reachable.
  return (
    ipv6In(number, '2000::', 3) &&
    !ipv6In(number, '2001::', 23) &&
    !ipv6In(number, '2001:db8::', 32) &&
    !ipv6In(number, '2002::', 16) &&
    !ipv6In(number, '3fff::', 20)
  );
}

/** Validate syntax before DNS resolution; each resolved address is checked separately. */
export function validateUpdateUrl(raw: string): URL {
  if (
    typeof raw !== 'string' ||
    !raw ||
    !/^https:\/\/[^/?#]/i.test(raw) ||
    raw.length > 16384 ||
    raw !== raw.trim() ||
    /[\\\u0000-\u0020\u007f]/u.test(raw)
  )
    throw new Error('更新地址格式不正确');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('更新地址格式不正确');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'https:' ||
    !host ||
    url.username ||
    url.password ||
    /^https:\/\/[^/?#]*@/i.test(raw) ||
    raw.includes('#') ||
    (raw.includes('?') && !SIGNED_ASSET_HOSTS.has(host)) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.includes('%') ||
    (isIP(host) && !isPublicUpdateAddress(host))
  )
    throw new Error('更新地址必须使用不含凭据的公开 HTTPS 地址');
  return url;
}

interface Address {
  address: string;
  family: number;
}

/** Dependency injection is for isolated tests; it never relaxes URL/IP checks. */
export interface UpdateDownloadOptions {
  fileLimit?: number;
  lookup?: (hostname: string) => Promise<readonly Address[]>;
  request?: (
    options: https.RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => ClientRequest;
  timeouts?: { headersMs?: number; idleMs?: number; totalMs?: number };
}

function abortError(): Error {
  const error = new Error('更新下载已取消');
  error.name = 'AbortError';
  return error;
}

function contentLength(response: IncomingMessage): number | undefined {
  const raw = response.headers['content-length'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw))
    throw new Error('更新服务器返回了无效的文件大小');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error('更新服务器返回了无效的文件大小');
  return value;
}

export function createUpdateDownloader(options: UpdateDownloadOptions = {}) {
  const fileLimit = options.fileLimit ?? FILE_LIMIT;
  if (!Number.isSafeInteger(fileLimit) || fileLimit < 1 || fileLimit > 512 * 1024 ** 2)
    throw new Error('更新下载容量上限无效');
  const lookup =
    options.lookup ?? ((hostname) => dnsLookup(hostname, { all: true, verbatim: true }));
  const request = options.request ?? ((settings, callback) => https.request(settings, callback));
  const headersMs = options.timeouts?.headersMs ?? 20000;
  const idleMs = options.timeouts?.idleMs ?? 30000;
  const totalMs = options.timeouts?.totalMs ?? 600000;

  async function consume<T>(
    raw: string,
    signal: AbortSignal | undefined,
    receive: (response: IncomingMessage) => Promise<T>,
  ): Promise<T> {
    let activeRequest: ClientRequest | undefined;
    let activeResponse: IncomingMessage | undefined;
    let failure: Error | undefined;
    let failWait: ((error: Error) => void) | undefined;
    let headerTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      // Destroy without an error argument: rejection is delivered through the
      // operation promise, including before a stream consumer has attached.
      activeResponse?.destroy();
      activeRequest?.destroy();
      failWait?.(error);
    };
    const totalTimer = setTimeout(() => fail(new Error('更新下载超过总时限')), totalMs);
    const cancel = () => fail(abortError());
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const wait = async <V>(operation: Promise<V>): Promise<V> => {
      if (failure) throw failure;
      return Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          failWait = reject;
        }),
      ]).finally(() => {
        failWait = undefined;
      });
    };
    try {
      let url = validateUpdateUrl(raw);
      for (let redirects = 0; ; redirects++) {
        if (failure) throw failure;
        clearTimeout(headerTimer);
        headerTimer = setTimeout(() => fail(new Error('更新服务器连接或响应超时')), headersMs);
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(hostname)
          ? [{ address: hostname, family: isIP(hostname) }]
          : await wait(lookup(hostname));
        if (
          !addresses.length ||
          addresses.some(
            ({ address, family }) => !isPublicUpdateAddress(address) || family !== isIP(address),
          )
        )
          throw new Error('更新服务器解析到了非公开网络地址');
        const chosen = addresses[0];
        const response = await wait(
          new Promise<IncomingMessage>((resolve, reject) => {
            activeRequest = request(
              {
                protocol: 'https:',
                hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: 'GET',
                agent: false,
                servername: isIP(hostname) ? undefined : hostname,
                rejectUnauthorized: true,
                headers: {
                  Accept: 'application/octet-stream, application/json',
                  'Accept-Encoding': 'identity',
                  'User-Agent': 'Chronicle-Cartarium-Updater',
                },
                // Do not resolve again in the transport: every returned DNS IP was
                // checked above, and the selected IP is pinned through TLS setup.
                lookup: ((_host: string, settings: { all?: boolean }, callback: Function) => {
                  if (settings?.all) callback(null, [chosen]);
                  else callback(null, chosen.address, chosen.family);
                }) as https.RequestOptions['lookup'],
              },
              (incoming) => {
                activeResponse = incoming;
                // Guard the gap between receiving headers and attaching pipeline.
                incoming.on('error', () => {});
                if (failure) {
                  incoming.destroy();
                  reject(failure);
                } else resolve(incoming);
              },
            );
            activeRequest.on('error', reject);
            activeRequest.end();
          }),
        );
        clearTimeout(headerTimer);
        if (REDIRECTS.has(response.statusCode ?? 0)) {
          const location = response.headers.location;
          response.destroy();
          activeRequest?.destroy();
          if (redirects >= 5) throw new Error('更新下载重定向次数过多');
          if (!location) throw new Error('更新服务器重定向缺少地址');
          let next: URL;
          try {
            next = new URL(location, url);
          } catch {
            throw new Error('更新服务器重定向地址无效');
          }
          // Check the raw header as well: WHATWG URL normalizes backslashes and
          // control characters, which should never turn invalid input into trust.
          if (/[\\\u0000-\u0020\u007f]/u.test(location))
            throw new Error('更新服务器重定向地址无效');
          url = validateUpdateUrl(next.href);
          continue;
        }
        if (response.statusCode !== 200) {
          response.destroy();
          activeRequest?.destroy();
          throw new Error(`更新服务器返回 HTTP ${response.statusCode ?? '未知'}`);
        }
        if (
          response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity'
        )
          throw new Error('更新服务器返回了不支持的压缩传输');
        const refreshIdle = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => fail(new Error('更新下载等待数据超时')), idleMs);
        };
        response.on('data', refreshIdle);
        refreshIdle();
        const receiving = receive(response);
        try {
          return await wait(receiving);
        } catch (error) {
          // A cancellation must finish destroying the pipeline before the caller
          // closes or removes its file. DNS/header waits do not need this drain.
          await receiving.catch(() => {});
          throw error;
        }
      }
    } finally {
      clearTimeout(totalTimer);
      clearTimeout(headerTimer);
      clearTimeout(idleTimer);
      signal?.removeEventListener('abort', cancel);
      activeResponse?.destroy();
      activeRequest?.destroy();
    }
  }

  async function readUpdateJson(url: string, signal?: AbortSignal): Promise<unknown> {
    return consume(url, signal, async (response) => {
      const declared = contentLength(response);
      if (declared !== undefined && declared > JSON_LIMIT) throw new Error('更新信息过大');
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of response) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > JSON_LIMIT) throw new Error('更新信息过大');
        chunks.push(buffer);
      }
      if (declared !== undefined && declared !== bytes) throw new Error('更新信息传输不完整');
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new Error('更新服务器返回了无效的 JSON 信息');
      }
    });
  }

  async function downloadUpdateFile(
    url: string,
    file: string,
    expected: { bytes: number; sha256: string },
    progress: (received: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(expected.bytes) ||
      expected.bytes <= 0 ||
      expected.bytes > fileLimit ||
      !/^[a-fA-F0-9]{64}$/.test(expected.sha256)
    )
      throw new Error('更新包大小或校验信息无效');
    validateUpdateUrl(url);
    if (signal?.aborted) throw abortError();
    const handle = await open(file, 'wx', 0o600);
    try {
      await consume(url, signal, async (response) => {
        const declared = contentLength(response);
        if (declared !== undefined && declared !== expected.bytes)
          throw new Error('更新包声明的大小与发行信息不一致');
        let received = 0;
        const hash = createHash('sha256');
        progress(0);
        const verify = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length;
            if (received > expected.bytes || received > fileLimit) {
              callback(new Error('更新包实际大小超过发行信息'));
              return;
            }
            hash.update(chunk);
            try {
              progress(received);
            } catch (error) {
              callback(error as Error);
              return;
            }
            callback(null, chunk);
          },
        });
        const output = new Writable({
          write(chunk: Buffer, _encoding, done) {
            void (async () => {
              let offset = 0;
              while (offset < chunk.length) {
                const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
                if (!bytesWritten) throw new Error('更新包写入未能完成');
                offset += bytesWritten;
              }
            })().then(() => done(), done);
          },
        });
        await pipeline(response, verify, output);
        if (received !== expected.bytes) throw new Error('更新包传输不完整');
        if (hash.digest('hex') !== expected.sha256.toLowerCase())
          throw new Error('更新包 SHA-256 校验失败');
        if (signal?.aborted) throw abortError();
        await handle.sync();
      });
      await handle.close();
    } catch (error) {
      await handle.close().catch(() => {});
      await unlink(file).catch(() => {});
      throw error;
    }
  }

  return { readUpdateJson, downloadUpdateFile };
}

const productionDownloader = createUpdateDownloader();
export const readUpdateJson = productionDownloader.readUpdateJson;
export const downloadUpdateFile = productionDownloader.downloadUpdateFile;
