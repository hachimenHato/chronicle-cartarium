export type CosProgressStage =
  | 'verify'
  | 'bucket'
  | 'read-catalog'
  | 'file-start'
  | 'upload-progress'
  | 'file-readback'
  | 'file-verified'
  | 'commit-catalog'
  | 'done';

export interface CosProgressEvent {
  stage: CosProgressStage;
  fileIndex?: number;
  fileCount?: number;
  loaded?: number;
  bytes?: number;
}

const MIB = 1024 ** 2;
const MAX_FILE_BYTES = 512 * MIB;
const MAX_FILE_COUNT = 10000;
const INTERVAL = 15000;
const labels: Record<CosProgressStage, string> = {
  verify: '正在核验更新包的官方签名与完整内容。',
  bucket: '正在检查专用存储桶。',
  'read-catalog': '正在读取现有更新清单。',
  'file-start': '开始处理更新文件。',
  'upload-progress': '正在上传更新文件。',
  'file-readback': '正在匿名下载校验更新文件。',
  'file-verified': '更新文件已通过公开下载校验。',
  'commit-catalog': '正在发布更新清单。',
  done: '更新镜像发布完成。',
};

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function size(bytes: number): string {
  return bytes < MIB ? `${bytes} 字节` : `${(bytes / MIB).toFixed(2)} MiB`;
}

/**
 * Log only fixed text and bounded numeric progress, never events, SDK replies,
 * filenames, URLs, headers, credentials or arbitrary provider strings.
 */
export function createCosProgressLogger(
  write: (line: string) => void = (line) => console.log(line),
  now: () => number = Date.now,
): (event: CosProgressEvent) => void {
  const uploads = new Map<string, { time?: number; completed: boolean }>();
  return (event) => {
    // A progress callback must not interrupt publishing, even if an injected
    // clock/logger or a malformed event throws while being inspected.
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) return;
      const stage = event.stage;
      if (typeof stage !== 'string' || !Object.hasOwn(labels, stage)) return;
      const fileIndex = integer(event.fileIndex, 1, MAX_FILE_COUNT);
      const fileCount = integer(event.fileCount, 1, MAX_FILE_COUNT);
      const bytes = integer(event.bytes, 1, MAX_FILE_BYTES);
      const loaded = integer(event.loaded, 0, MAX_FILE_BYTES);
      const validPosition =
        fileIndex !== undefined && (fileCount === undefined || fileIndex <= fileCount);
      const position = validPosition
        ? fileCount === undefined
          ? `第 ${fileIndex} 个更新文件`
          : `第 ${fileIndex}/${fileCount} 个更新文件`
        : '更新文件';
      const identity = validPosition ? `${fileIndex}/${fileCount ?? ''}` : 'current';

      if (stage === 'verify') uploads.clear();
      if (stage === 'file-start') uploads.delete(identity);
      if (stage === 'upload-progress') {
        if (bytes === undefined || loaded === undefined || loaded > bytes) return;
        const time = integer(now(), 0, Number.MAX_SAFE_INTEGER);
        const previous = uploads.get(identity);
        const completed = loaded === bytes;
        const elapsed =
          time !== undefined && previous?.time !== undefined && time - previous.time >= INTERVAL;
        // Completion is final for this operation; stale or duplicate callbacks
        // add no information until file-start explicitly starts another one.
        if (previous?.completed) return;
        if (previous && !completed && !elapsed) return;
        uploads.set(identity, { time, completed });
        const progress =
          bytes < MIB
            ? `${loaded} / ${bytes} 字节`
            : `${(loaded / MIB).toFixed(2)} / ${(bytes / MIB).toFixed(2)} MiB`;
        const percentage = Math.floor((loaded / bytes) * 100);
        write(`${position}上传进度：${progress}（${percentage}%）。`);
      } else if (stage === 'file-start') {
        write(`开始处理${position}${bytes === undefined ? '' : `（${size(bytes)}）`}。`);
      } else if (stage === 'file-readback') {
        write(`正在匿名下载校验${position}。`);
      } else if (stage === 'file-verified') {
        write(`${position}已通过公开下载校验。`);
      } else {
        write(labels[stage]);
      }
    } catch {
      // Never render caught exceptions, event values or logger failures.
    }
  };
}
