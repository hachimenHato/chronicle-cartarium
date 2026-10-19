/** One gate covers all persistent writers, including independently queued user changes. */
export class MaintenanceError extends Error {
  constructor() {
    super('正在备份或更新，暂时无法保存。请保留编辑内容，稍后重试。');
  }
}
export class DataProtectionError extends Error {}
export class MaintenanceGate {
  private active = 0;
  private locked = false;
  private drained?: () => void;
  private startupRelease?: () => void;
  get busy() {
    return this.locked;
  }
  async holdAtStartup() {
    this.startupRelease = await this.acquire();
  }
  releaseStartupHold() {
    this.startupRelease?.();
    this.startupRelease = undefined;
  }
  async write<T>(operation: () => Promise<T>): Promise<T> {
    if (this.locked) throw new MaintenanceError();
    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
      if (this.active === 0) this.drained?.();
    }
  }
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }
  async acquire(): Promise<() => void> {
    if (this.locked) throw new MaintenanceError();
    this.locked = true;
    if (this.active)
      await new Promise<void>((resolve) => {
        this.drained = resolve;
      });
    return () => {
      this.drained = undefined;
      this.locked = false;
    };
  }
}
