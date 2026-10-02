import type { Persistence, RoomDocument } from './persistence';
import { CHECKPOINT_EVERY, CHECKPOINT_INTERVAL_MS, JournalIntegrityError } from './room-journal';
interface CheckpointContext {
  readonly integrityFailure: Error | null; readonly persistence: Persistence;
  readonly version: number; readonly loaded: boolean; readonly committedDocument: RoomDocument | null; readonly code: string;
  quarantine(error: Error): void;
}
/** Runs verified compaction beside, never inside, the room command queue. */
export class RoomCheckpoints {
  checkpointVersion = 0;
  private checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  private checkpointTask: Promise<void> | undefined;
  constructor(private readonly context: CheckpointContext) { }
  get idle() { return !this.checkpointTimer && !this.checkpointTask; }
  async drain() {
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
    this.checkpointTimer = undefined;
    await this.checkpointTask;
    await this.checkpoint();
  }
  schedule(): void {
    if (this.context.integrityFailure || !this.context.persistence.checkpointRoom || this.context.version <= this.checkpointVersion) return;
    if (this.context.version - this.checkpointVersion >= CHECKPOINT_EVERY && !this.checkpointTask) {
      void this.checkpoint();
    } else if (!this.checkpointTimer) {
      this.checkpointTimer = setTimeout(() => {
        this.checkpointTimer = undefined;
        void this.checkpoint();
      }, CHECKPOINT_INTERVAL_MS);
      this.checkpointTimer.unref?.();
    }
  }

  private async checkpoint(): Promise<void> {
    if (this.context.integrityFailure || !this.context.persistence.checkpointRoom || !this.context.loaded || !this.context.committedDocument ||
      this.context.version <= this.checkpointVersion || this.checkpointTask) return;
    const version = this.context.version;
    const document = this.context.committedDocument;
    this.checkpointTask = this.context.persistence.checkpointRoom(this.context.code, version, document)
      .then(() => { this.checkpointVersion = version; })
      .catch((error) => {
        console.error('[room] checkpoint verification failed; journal retained', error);
        if (error instanceof JournalIntegrityError) {
          this.context.quarantine(error);
          if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
          this.checkpointTimer = undefined;
        }
      })
      .finally(() => {
        this.checkpointTask = undefined;
        if (!this.context.integrityFailure && this.context.loaded && this.context.version > this.checkpointVersion && !this.checkpointTimer) {
          this.checkpointTimer = setTimeout(() => {
            this.checkpointTimer = undefined;
            void this.checkpoint();
          }, CHECKPOINT_INTERVAL_MS);
          this.checkpointTimer.unref?.();
        }
      });
    await this.checkpointTask;
  }

}
