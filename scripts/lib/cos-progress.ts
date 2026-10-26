export type CosProgressStage =
  | 'verify'
  | 'bucket'
  | 'read-catalog'
  | 'file-start'
  | 'upload-progress'
  | 'upload-retry'
  | 'part-retry'
  | 'multipart-abort-unconfirmed'
  | 'file-failed'
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
  attempt?: number;
  partNumber?: number;
  partCount?: number;
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
  'upload-retry': '网络传输中断，正在重新上传更新文件。',
  'part-retry': '当前分块传输中断，正在重试当前分块。',
  'multipart-abort-unconfirmed': '当前分块会话的清理结果尚未确认，已保留固定失败诊断。',
  'file-failed': '更新文件处理失败，停止领取新文件并等待在途任务结束。',
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
      const attempt = integer(event.attempt, 2, 3);
      const partNumber = integer(event.partNumber, 1, 10000);
      const partCount = integer(event.partCount, 1, 10000);
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
      if (stage === 'upload-retry') uploads.delete(identity);
      if (stage === 'part-retry') uploads.delete(identity);
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
      } else if (stage === 'upload-retry') {
        write(
          `${position}传输中断，已确认对象尚未提交${attempt === undefined ? '' : `；开始第 ${attempt}/3 次上传`}。`,
        );
      } else if (stage === 'file-failed') {
        write(`${position}处理失败；停止领取新文件，等待其他在途任务结束。`);
      } else if (stage === 'part-retry') {
        if (
          partNumber === undefined ||
          partCount === undefined ||
          partNumber > partCount ||
          attempt === undefined
        )
          return;
        write(
          `${position}第 ${partNumber}/${partCount} 块传输中断；开始第 ${attempt}/3 次分块上传，已完成分块保留。`,
        );
      } else if (stage === 'multipart-abort-unconfirmed') {
        write(`${position}的本次分块会话清理尚未确认；未删除任何已完成对象。`);
      } else {
        write(labels[stage]);
      }
    } catch {
      // Never render caught exceptions, event values or logger failures.
    }
  };
}
