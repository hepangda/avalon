import { sha256, viewContent, type RoomView, type ViewSnapshot, type ViewStamp } from '../stateIntegrity';

/** Serialize async digest checks; old sockets/effects can never overwrite a fresh view. */
export class ViewSynchronizer {
  private stamp: ViewStamp | null = null;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private recovering = false;
  private requesting = false;
  private attemptedRecovery = false;

  constructor(private readonly options: {
    code: string;
    read: () => RoomView | null;
    apply: (snapshot: ViewSnapshot, recovery: boolean) => void;
    invalidate: () => void;
    request: () => Promise<unknown>;
    hash?: (value: unknown) => Promise<string>;
  }) {}

  private hash(view: RoomView) {
    return (this.options.hash ?? sha256)(viewContent(view));
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => { if (!this.disposed) await fn(); })
      .catch(() => { if (!this.disposed) this.recover(); });
    return this.queue;
  }

  private recover() {
    if (this.disposed) return;
    this.recovering = true;
    this.options.invalidate();
    if (this.requesting || this.attemptedRecovery) return;
    this.requesting = true;
    this.attemptedRecovery = true;
    // A failed request is retried on the next heartbeat; never spin on a corrupt server response.
    void this.options.request().catch(() => {}).finally(() => { this.requesting = false; });
  }

  receive(snapshot: ViewSnapshot): Promise<void> {
    return this.enqueue(async () => {
      if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
        typeof snapshot.epoch !== 'string' || typeof snapshot.hash !== 'string' ||
        snapshot.view?.room?.code !== this.options.code) { this.recover(); return; }
      if (this.stamp && snapshot.epoch !== this.stamp.epoch) { this.recover(); return; }
      if (this.stamp && snapshot.revision < this.stamp.revision) return;
      const digest = await this.hash(snapshot.view);
      if (this.disposed) return;
      if (digest !== snapshot.hash) { this.recover(); return; }
      if (this.stamp?.revision === snapshot.revision && this.stamp.hash !== snapshot.hash) { this.recover(); return; }
      const recovery = !this.stamp || this.recovering || !!snapshot.recovery;
      this.stamp = { epoch: snapshot.epoch, revision: snapshot.revision, hash: digest };
      this.recovering = false;
      this.attemptedRecovery = false;
      this.options.apply(snapshot, recovery);
    });
  }

  check(remote: ViewStamp | null): Promise<void> {
    return this.enqueue(async () => {
      this.attemptedRecovery = false;
      if (!remote) return; // Join may still be committing; it will publish the first view.
      if (!this.stamp || remote.epoch !== this.stamp.epoch || remote.revision > this.stamp.revision) {
        this.recover(); return;
      }
      // A heartbeat may have been sent before a newer push; this is not corruption.
      if (remote.revision < this.stamp.revision) return;
      const local = this.options.read();
      if (!local || remote.hash !== this.stamp.hash || await this.hash(local) !== remote.hash) {
        if (!this.disposed) this.recover();
      } else if (this.recovering) this.recover();
    });
  }

  dispose() { this.disposed = true; }
}
