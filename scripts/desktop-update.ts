import { readFile } from 'node:fs/promises';
import { DesktopUpdateService, desktopRequestSchema } from '../server/desktop-update';
const controller = new AbortController();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (String(chunk).includes('cancel')) controller.abort();
});
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
try {
  const [action, filename] = process.argv.slice(2);
  if (!['check', 'stage'].includes(action)) throw new Error('未知桌面更新操作');
  const input = desktopRequestSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
  const service = new DesktopUpdateService(input.currentVersion, input.settings);
  const candidate = await service.check(controller.signal);
  if (action === 'check') emit({ kind: 'result', candidate });
  else {
    if (!candidate || candidate.version !== input.version)
      throw new Error('桌面版本清单已改变，请重新检查');
    const result = await service.stage(
      input.base,
      candidate,
      controller.signal,
      (received, total, phase) => emit({ kind: 'progress', received, total, phase }),
    );
    emit({ kind: 'result', prepared: result });
  }
} catch {
  emit({
    kind: 'error',
    message: controller.signal.aborted
      ? '下载已取消，原程序与资料保留。'
      : '桌面更新检查、下载或官方签名验证失败。请检查网络、磁盘空间，原程序与资料保留。',
  });
  process.exitCode = 1;
} finally {
  process.stdin.pause();
}
