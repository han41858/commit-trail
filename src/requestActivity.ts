// Count HTTP work from dispatch through response-body parsing, excluding queued jobs.
let active = 0,
  queued = 0;
const repositories = new Map<string, number>();
const queueListeners = new Set<() => void>();
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};
export const requestActivity = {
  getSnapshot: (repository?: string) =>
    repository === undefined ? active : (repositories.get(repository.toLowerCase()) ?? 0),
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
  begin(signal?: AbortSignal, repository?: string) {
    if (signal?.aborted) return () => {};
    const scope = repository?.toLowerCase();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', finish);
      active--;
      if (scope) {
        const remaining = repositories.get(scope)! - 1;
        if (remaining) repositories.set(scope, remaining);
        else repositories.delete(scope);
      }
      publish();
    };
    active++;
    if (scope) repositories.set(scope, (repositories.get(scope) ?? 0) + 1);
    signal?.addEventListener('abort', finish, { once: true });
    publish();
    return finish;
  },
};
