import { requestActivity } from './requestActivity';
import { debug, type DebugCycle } from './debug';

// Bound HTTP concurrency without tying accepted work to the current viewport.
export class RequestPool {
  private active = 0;
  private pending: (() => void)[] = [];
  constructor(private readonly limit = 16) {}
  run<T>(signal: AbortSignal, task: () => Promise<T>, cycle?: DebugCycle): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let started = false,
        queued = false;
      const dequeue = () => {
        if (queued) {
          queued = false;
          requestActivity.queue(-1);
        }
      };
      const abort = () => {
        if (started) return;
        const index = this.pending.indexOf(start);
        if (index >= 0) this.pending.splice(index, 1);
        dequeue();
        debug.queuedCancelled(cycle ?? debug.forSignal(signal));
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const start = () => {
        dequeue();
        signal.removeEventListener('abort', abort);
        if (signal.aborted) {
          debug.queuedCancelled(cycle ?? debug.forSignal(signal));
          reject(signal.reason);
          return;
        }
        started = true;
        this.active++;
        Promise.resolve()
          .then(() => {
            if (signal.aborted) debug.queuedCancelled(cycle ?? debug.forSignal(signal));
            signal.throwIfAborted();
            return task();
          })
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.pump();
          });
      };
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      queued = true;
      requestActivity.queue(1);
      this.pending.push(start);
      this.pump();
    });
  }
  private pump() {
    while (this.active < this.limit && this.pending.length) this.pending.shift()!();
  }
}
