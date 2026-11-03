import { lowercaseRepoInput, parseRepo } from './model';

export const MONITOR_LIMIT = 4;
export const MONITOR_REPOSITORIES_KEY = 'gitstream.monitor-repositories';
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function monitorRepository(value: string) {
  return parseRepo(lowercaseRepoInput(value));
}
export function normalizeMonitorRepositories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    try {
      names.add(monitorRepository(item));
    } catch {
      /* Ignore invalid saved addresses. */
    }
    if (names.size === MONITOR_LIMIT) break;
  }
  return [...names];
}
export function moveMonitorRepository(names: string[], repository: string, to: number): string[] {
  const from = names.indexOf(repository);
  if (from < 0 || !Number.isInteger(to)) return names;
  const target = Math.max(0, Math.min(names.length - 1, to));
  if (from === target) return names;
  const next = [...names];
  next.splice(from, 1);
  next.splice(target, 0, repository);
  return next;
}
type Options = {
  storage?: () => StorageAccess;
  publicRepositories: () => readonly string[];
  allowPrivate: () => boolean;
  canWrite: () => boolean;
};
// Only normalized names are saved. Known public visits supply the privacy boundary;
// unclassified names are conservatively removed when the applied PAT changes.
export class MonitorRepositories {
  private storage?: StorageAccess;
  private names: string[] = [];
  private snapshot: readonly string[] = [];
  private listeners = new Set<() => void>();
  constructor(private readonly options: Options) {
    try {
      this.storage = (options.storage ?? (() => localStorage))();
      this.reload();
    } catch {
      /* Monitoring still works without persistence. */
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private allowed() {
    const publicNames = new Set(this.options.publicRepositories());
    return this.options.allowPrivate()
      ? this.names
      : this.names.filter((name) => publicNames.has(name));
  }
  private publish() {
    const next = this.allowed();
    if (next.join('\0') === this.snapshot.join('\0')) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  reconcile = () => {
    if (this.options.canWrite())
      try {
        const names = this.allowed();
        if (names.length) this.storage?.setItem(MONITOR_REPOSITORIES_KEY, JSON.stringify(names));
        else this.storage?.removeItem(MONITOR_REPOSITORIES_KEY);
      } catch {
        /* Keep the selection in this tab. */
      }
    this.publish();
  };
  reload = () => {
    try {
      const raw = this.storage?.getItem(MONITOR_REPOSITORIES_KEY);
      let decoded: unknown;
      try {
        decoded = raw ? JSON.parse(raw) : [];
      } catch {
        decoded = [];
      }
      this.names = normalizeMonitorRepositories(decoded);
      if (raw && raw !== JSON.stringify(this.names) && this.options.canWrite()) this.reconcile();
      else this.publish();
    } catch {
      this.storage = undefined;
      this.publish();
    }
  };
  set = (names: readonly string[]) => {
    this.names = normalizeMonitorRepositories(names);
    this.reconcile();
  };
  authenticationChanged = (previous: string, next: string) => {
    if (previous === next && this.options.canWrite()) return;
    const publicNames = new Set(this.options.publicRepositories());
    this.names = this.names.filter((name) => publicNames.has(name));
    this.reconcile();
  };
}
