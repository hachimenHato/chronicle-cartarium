import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCosProgressLogger,
  type CosProgressEvent,
  type CosProgressStage,
} from '../scripts/lib/cos-progress';

const MIB = 1024 ** 2;

function fixture() {
  const lines: string[] = [];
  let time = 0;
  const log = createCosProgressLogger(
    (line) => lines.push(line),
    () => time,
  );
  return {
    lines,
    log,
    setTime(value: number) {
      time = value;
    },
  };
}

test('COS progress logger emits fixed Chinese stages and bounded file positions and sizes', () => {
  const f = fixture();
  for (const stage of [
    'verify',
    'bucket',
    'read-catalog',
    'file-start',
    'file-readback',
    'file-verified',
    'commit-catalog',
    'done',
  ] satisfies CosProgressStage[])
    f.log({ stage, fileIndex: 2, fileCount: 7, bytes: 83 * MIB });
  assert.deepEqual(f.lines, [
    '正在核验更新包的官方签名与完整内容。',
    '正在检查专用存储桶。',
    '正在读取现有更新清单。',
    '开始处理第 2/7 个更新文件（83.00 MiB）。',
    '正在匿名下载校验第 2/7 个更新文件。',
    '第 2/7 个更新文件已通过公开下载校验。',
    '正在发布更新清单。',
    '更新镜像发布完成。',
  ]);
});

test('COS upload progress prints first, each 15 seconds, and first completion without duplicate spam', () => {
  const f = fixture();
  const progress = (loaded: number) =>
    f.log({
      stage: 'upload-progress',
      fileIndex: 1,
      fileCount: 7,
      loaded,
      bytes: 100 * MIB,
    });
  progress(0);
  f.setTime(1000);
  progress(MIB);
  f.setTime(14999);
  progress(2 * MIB);
  assert.equal(f.lines.length, 1);
  f.setTime(15000);
  progress(3 * MIB);
  assert.equal(f.lines.length, 2);
  f.setTime(15001);
  progress(100 * MIB);
  assert.equal(f.lines.length, 3);
  f.setTime(30001);
  progress(100 * MIB);
  assert.equal(f.lines.length, 3);
  assert.equal(f.lines[0], '第 1/7 个更新文件上传进度：0.00 / 100.00 MiB（0%）。');
  assert.equal(f.lines[2], '第 1/7 个更新文件上传进度：100.00 / 100.00 MiB（100%）。');
});

test('COS progress throttles each file independently and resets at a new file operation or verification', () => {
  const f = fixture();
  const progress = (fileIndex: number) =>
    f.log({
      stage: 'upload-progress',
      fileIndex,
      fileCount: 7,
      loaded: 0,
      bytes: 997,
    });
  progress(1);
  progress(2);
  progress(2);
  assert.equal(f.lines.length, 2);
  assert.match(f.lines[0], /0 \/ 997 字节/);
  f.log({ stage: 'file-start', fileIndex: 2, fileCount: 7 });
  progress(2);
  assert.equal(f.lines.length, 4);
  f.log({ stage: 'verify' });
  progress(1);
  assert.equal(f.lines.length, 6);
});

test('COS progress rejects malformed stages and does not stringify fields or extra secret-bearing properties', () => {
  const f = fixture();
  const secret = 'FAKE_COS_SECRET_DO_NOT_RENDER';
  const forbidden = {
    toString() {
      assert.fail('arbitrary data must never be stringified');
    },
  };
  for (const event of [
    null,
    undefined,
    [],
    'upload-progress',
    {},
    { stage: secret },
    { stage: 'toString' },
    { stage: forbidden },
  ])
    f.log(event as CosProgressEvent);
  assert.equal(f.lines.length, 0);
  f.log({ stage: 'bucket', message: secret, credentials: forbidden } as CosProgressEvent);
  f.log({
    stage: 'file-start',
    fileIndex: forbidden,
    fileCount: secret,
    bytes: secret,
  } as unknown as CosProgressEvent);
  assert.deepEqual(f.lines, ['正在检查专用存储桶。', '开始处理更新文件。']);
  assert(!f.lines.join('\n').includes(secret));
});

test('COS progress ignores invalid numeric values, oversized files and impossible positions', () => {
  const f = fixture();
  for (const invalid of [NaN, Infinity, -Infinity, -1, 1.2, 513 * MIB, '1', {}, undefined]) {
    f.log({ stage: 'upload-progress', loaded: 0, bytes: invalid } as CosProgressEvent);
    f.log({ stage: 'upload-progress', loaded: invalid, bytes: MIB } as CosProgressEvent);
  }
  f.log({ stage: 'upload-progress', loaded: 2, bytes: 1 });
  f.log({ stage: 'upload-progress', loaded: 0, bytes: 0 });
  assert.equal(f.lines.length, 0);
  for (const invalid of [NaN, Infinity, -1, 0, 1.2, 10001, '1', {}])
    f.log({ stage: 'file-start', fileIndex: invalid, fileCount: invalid } as CosProgressEvent);
  f.log({ stage: 'file-start', fileIndex: 8, fileCount: 7, bytes: 997 });
  assert.equal(f.lines.at(-1), '开始处理更新文件（997 字节）。');
  assert(f.lines.every((line) => !/NaN|Infinity|undefined|\[object/.test(line)));
});

test('COS progress tolerates backwards and malformed clocks without flooding and still prints completion', () => {
  const f = fixture();
  const progress = (loaded: number) => f.log({ stage: 'upload-progress', loaded, bytes: 997 });
  f.setTime(10000);
  progress(0);
  f.setTime(9000);
  progress(1);
  f.setTime(NaN);
  progress(2);
  f.setTime(Infinity);
  progress(3);
  f.setTime(24999);
  progress(4);
  assert.equal(f.lines.length, 1);
  f.setTime(25000);
  progress(5);
  assert.equal(f.lines.length, 2);
  f.setTime(NaN);
  progress(997);
  assert.equal(f.lines.length, 3);
});

test('COS progress never interrupts publishing when malformed events, logger or clock throw', () => {
  const f = fixture();
  const getter = Object.defineProperty({}, 'stage', {
    get() {
      throw new Error('FAKE_SECRET');
    },
  });
  assert.doesNotThrow(() => f.log(getter as CosProgressEvent));
  assert.equal(f.lines.length, 0);
  const brokenLogger = createCosProgressLogger(() => {
    throw new Error('FAKE_SECRET');
  });
  assert.doesNotThrow(() => brokenLogger({ stage: 'bucket' }));
  const brokenClock = createCosProgressLogger(
    () => {},
    () => {
      throw new Error('FAKE_SECRET');
    },
  );
  assert.doesNotThrow(() => brokenClock({ stage: 'upload-progress', loaded: 0, bytes: 997 }));
});

test('COS retry progress resets an exhausted upload counter and identifies a failing file safely', () => {
  const f = fixture();
  const progress = { fileIndex: 2, fileCount: 7, bytes: 997 };
  f.log({ stage: 'upload-progress', ...progress, loaded: 997 });
  f.log({ stage: 'upload-retry', ...progress, attempt: 2 });
  f.log({ stage: 'upload-progress', ...progress, loaded: 0 });
  f.log({ stage: 'file-failed', ...progress });
  assert.deepEqual(f.lines, [
    '第 2/7 个更新文件上传进度：997 / 997 字节（100%）。',
    '第 2/7 个更新文件传输中断，已确认对象尚未提交；开始第 2/3 次上传。',
    '第 2/7 个更新文件上传进度：0 / 997 字节（0%）。',
    '第 2/7 个更新文件处理失败；停止领取新文件，等待其他在途任务结束。',
  ]);
  f.log({
    stage: 'upload-retry',
    ...progress,
    attempt: 'FAKE_SECRET',
  } as unknown as CosProgressEvent);
  assert.doesNotMatch(f.lines.join('\n'), /FAKE_SECRET/);
});
