import { lowercaseRepoInput, parseRepo } from './model';

export const RECENT_REPOSITORIES_KEY = 'commit-trail.recent-repositories';
export const RECENT_REPOSITORIES_LIMIT = 10;
export type RecentRepository = Readonly<{
  repository: string;
  visibility: 'public' | 'private';
  visitedAt: number;
}>;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Options = {
  storage?: () => StorageAccess;
  now?: () => number;
  allowPrivate?: () => boolean;
};
type Snapshot = { available: boolean; entries: readonly RecentRepository[] };

function repositoryName(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    return parseRepo(lowercaseRepoInput(value));
  } catch {
    return null;
  }
}
export function normalizeRecentRepositories(
  value: unknown,
): RecentRepository[] {
  if (!Array.isArray(value)) return [];
  const entries = new Map<string, RecentRepository>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const repository = repositoryName(item.repository);
    if (
      !repository ||
      !['public', 'private'].includes(item.visibility) ||
      !Number.isSafeInteger(item.visitedAt) ||
      item.visitedAt < 0
    )
      continue;
    const old = entries.get(repository);
    if (!old || item.visitedAt > old.visitedAt)
      entries.set(repository, {
        repository,
        visibility: item.visibility,
        visitedAt: item.visitedAt,
      });
  }
  return [...entries.values()]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, RECENT_REPOSITORIES_LIMIT);
}
export function matchingRecentRepositories(
  entries: readonly RecentRepository[],
  input: string,
  current?: string,
) {
  const query =
    current && input === current
      ? ''
      : lowercaseRepoInput(input.trim())
          .replace(/^https:\/\/github\.com\//, '')
          .replace(/\/$/, '')
          .replace(/\.git$/, '');
  return entries.filter((entry) => entry.repository.includes(query));
}
const sameEntries = (
  a: readonly RecentRepository[],
  b: readonly RecentRepository[],
) =>
  a.length === b.length &&
  a.every(
    (entry, i) =>
      entry.repository === b[i].repository &&
      entry.visibility === b[i].visibility &&
      entry.visitedAt === b[i].visitedAt,
  );

// Only the three public schema fields are persisted. Authentication remains owned by App.
export class RecentRepositories {
  private storage?: StorageAccess;
  private entries: RecentRepository[] = [];
  private state: Snapshot = { available: true, entries: [] };
  private listeners = new Set<() => void>();
  private now: () => number;
  private allowPrivate: () => boolean;
  constructor({
    storage = () => localStorage,
    now = Date.now,
    allowPrivate = () => true,
  }: Options = {}) {
    this.now = now;
    this.allowPrivate = allowPrivate;
    try {
      this.storage = storage();
      this.reload();
    } catch {
      this.unavailable();
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private privateAllowed() {
    try {
      return this.allowPrivate();
    } catch {
      return false;
    }
  }
  private publish(available = this.state.available) {
    const entries = available
      ? this.privateAllowed()
        ? this.entries
        : this.entries.filter((entry) => entry.visibility === 'public')
      : [];
    if (
      available === this.state.available &&
      sameEntries(entries, this.state.entries)
    )
      return;
    this.state = { available, entries };
    for (const listener of this.listeners) listener();
  }
  private unavailable() {
    // Quota failures often still allow removal. Never leave a stale private list after a failed write if it can be removed.
    try {
      this.storage?.removeItem(RECENT_REPOSITORIES_KEY);
    } catch {
      /* Storage may be entirely denied. */
    }
    this.entries = [];
    this.publish(false);
  }
  private persist() {
    try {
      if (this.entries.length)
        this.storage!.setItem(
          RECENT_REPOSITORIES_KEY,
          JSON.stringify(this.entries),
        );
      else this.storage!.removeItem(RECENT_REPOSITORIES_KEY);
      this.publish();
    } catch {
      this.unavailable();
    }
  }
  reload = () => {
    if (!this.state.available) return;
    try {
      const raw = this.storage!.getItem(RECENT_REPOSITORIES_KEY);
      let decoded: unknown;
      try {
        decoded = raw === null ? [] : JSON.parse(raw);
      } catch {
        decoded = [];
      }
      this.entries = normalizeRecentRepositories(decoded);
      if (raw !== null && raw !== JSON.stringify(this.entries)) this.persist();
      else this.publish();
    } catch {
      this.unavailable();
    }
  };
  record = (repository: string, isPrivate: boolean) => {
    this.reload();
    if (
      !this.state.available ||
      typeof isPrivate !== 'boolean' ||
      (isPrivate && !this.privateAllowed())
    )
      return;
    const name = repositoryName(repository),
      visitedAt = this.now();
    if (!name || !Number.isSafeInteger(visitedAt) || visitedAt < 0) return;
    const entry: RecentRepository = {
      repository: name,
      visibility: isPrivate ? 'private' : 'public',
      visitedAt,
    };
    this.entries = [
      entry,
      ...this.entries.filter((value) => value.repository !== name),
    ].slice(0, RECENT_REPOSITORIES_LIMIT);
    this.persist();
  };
  touch = (repository: string) => {
    this.reload();
    if (!this.state.available) return;
    const entry = this.entries.find(
      (entry) => entry.repository === repositoryName(repository),
    );
    if (entry) this.record(entry.repository, entry.visibility === 'private');
  };
  updateVisibility = (repository: string, isPrivate: boolean) => {
    this.reload();
    if (!this.state.available || typeof isPrivate !== 'boolean') return;
    const name = repositoryName(repository),
      entry = this.entries.find((entry) => entry.repository === name),
      visibility = isPrivate ? 'private' : 'public';
    if (!entry || entry.visibility === visibility) return;
    this.entries = this.entries.map((value) =>
      value === entry ? { ...entry, visibility } : value,
    );
    this.persist();
  };
  repositoryMetadata = (
    repository: string,
    isPrivate: boolean,
    visit: boolean,
  ) => {
    if (visit) this.record(repository, isPrivate);
    else this.updateVisibility(repository, isPrivate);
  };
  authenticationChanged = (previous: string, next: string) => {
    if (previous === next && this.privateAllowed()) return;
    this.reload();
    if (!this.state.available) return;
    const entries = this.entries.filter(
      (entry) => entry.visibility === 'public',
    );
    if (entries.length === this.entries.length) return;
    this.entries = entries;
    this.persist();
  };
  remove = (repository: string) => {
    this.reload();
    if (!this.state.available) return;
    const name = repositoryName(repository),
      entries = this.entries.filter((entry) => entry.repository !== name);
    if (entries.length === this.entries.length) return;
    this.entries = entries;
    this.persist();
  };
  clear = () => {
    this.reload();
    if (!this.state.available) return;
    this.entries = [];
    this.persist();
  };
}
