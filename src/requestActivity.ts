// Count HTTP work from dispatch through response-body parsing, excluding queued jobs.
let active = 0,
  queued = 0;
const queueListeners = new Set<() => void>();
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};
export const requestActivity = {
  getSnapshot: () => active,
  getQueuedSnapshot: () => queued,
  subscribeQueue: (listener: () => void) => {
    queueListeners.add(listener);
    return () => {
      queueListeners.delete(listener);
    };
  },
  queue(delta: number) {
    queued += delta;
    for (const listener of queueListeners) listener();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  begin(signal?: AbortSignal) {
    if (signal?.aborted) return () => {};
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', finish);
      active--;
      publish();
    };
    active++;
    signal?.addEventListener('abort', finish, { once: true });
    publish();
    return finish;
  },
};
