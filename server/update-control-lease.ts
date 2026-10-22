import { MaintenanceError, type MaintenanceGate } from './maintenance';

interface Hold {
  lease?: string;
  release?: () => void;
  busy: boolean;
  releaseRequested: boolean;
}

/** Keep a runner's hold until its snapshot finishes, even if its HTTP connection disappears. */
export class UpdateControlLease {
  private hold?: Hold;
  constructor(private gate: MaintenanceGate) {}

  async backup<T>(
    lease: string | undefined,
    operation: () => Promise<T>,
    onHold?: (abandon: () => void) => void,
  ): Promise<T> {
    if (this.hold) throw new MaintenanceError();
    const hold: Hold = { lease, busy: true, releaseRequested: false };
    this.hold = hold;
    try {
      onHold?.(() => this.abandon(hold));
      hold.release = await this.gate.acquire();
      if (hold.releaseRequested) throw new MaintenanceError();
      return await operation();
    } catch (error) {
      hold.releaseRequested = true;
      throw error;
    } finally {
      hold.busy = false;
      if (hold.releaseRequested) this.finish(hold);
    }
  }

  release(lease?: string): 'absent' | 'mismatch' | 'pending' | 'released' {
    const hold = this.hold;
    if (!hold) return 'absent';
    if (hold.lease !== lease) return 'mismatch';
    hold.releaseRequested = true;
    if (hold.busy) return 'pending';
    this.finish(hold);
    return 'released';
  }

  private abandon(hold: Hold) {
    if (this.hold !== hold) return;
    hold.releaseRequested = true;
    if (!hold.busy) this.finish(hold);
  }

  private finish(hold: Hold) {
    if (this.hold !== hold) return;
    hold.release?.();
    this.hold = undefined;
  }
}
