import { monitorRepository } from './MonitorRepositories';
import { branchName } from './branchName';

export const BRANCH_SELECTIONS_KEY = 'commit-trail.branch-selections';
type Entry = { repository: string; branch: string; visibility: 'public' | 'private' };
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Options = {
  storage?: () => StorageAccess;
  allowPrivate?: () => boolean;
  canWrite?: () => boolean;
};
export class BranchSelections {
  private storage?: StorageAccess;
  private entries: Entry[] = [];
  constructor(private readonly options: Options = {}) {
    try {
      this.storage = (options.storage ?? (() => localStorage))();
      this.reload();
    } catch {
      /* Branch selection still works without storage. */
    }
  }
  private allowed() {
    return this.options.allowPrivate?.() ?? true;
  }
  private writable() {
    return this.options.canWrite?.() ?? true;
  }
  reload = () => {
    try {
      const raw = this.storage?.getItem(BRANCH_SELECTIONS_KEY);
      let decoded: unknown;
      try {
        decoded = raw ? JSON.parse(raw) : [];
      } catch {
        decoded = [];
      }
      const entries = new Map<string, Entry>();
      if (Array.isArray(decoded))
        for (const item of decoded) {
          if (!item || !branchName(item.branch) || !['public', 'private'].includes(item.visibility))
            continue;
          try {
            const repository = monitorRepository(item.repository);
            entries.set(repository, {
              repository,
              branch: item.branch,
              visibility: item.visibility,
            });
          } catch {
            /* Ignore malformed addresses. */
          }
        }
      this.entries = [...entries.values()];
    } catch {
      this.entries = [];
      this.storage = undefined;
    }
  };
  private persist() {
    if (!this.writable()) return;
    try {
      if (this.entries.length)
        this.storage?.setItem(BRANCH_SELECTIONS_KEY, JSON.stringify(this.entries));
      else this.storage?.removeItem(BRANCH_SELECTIONS_KEY);
    } catch {
      try {
        this.storage?.removeItem(BRANCH_SELECTIONS_KEY);
      } catch {
        /* Storage may be denied entirely. */
      }
      this.entries = [];
      this.storage = undefined;
    }
  }
  get = (repository: string) => {
    this.reload();
    try {
      repository = monitorRepository(repository);
    } catch {
      return;
    }
    const entry = this.entries.find((entry) => entry.repository === repository);
    return entry && (entry.visibility === 'public' || this.allowed()) ? entry.branch : undefined;
  };
  record = (repository: string, branch: string, isPrivate: boolean) => {
    this.reload();
    if (
      !this.writable() ||
      !branchName(branch) ||
      typeof isPrivate !== 'boolean' ||
      (isPrivate && !this.allowed())
    )
      return;
    try {
      repository = monitorRepository(repository);
    } catch {
      return;
    }
    this.entries = [
      ...this.entries.filter((entry) => entry.repository !== repository),
      { repository, branch, visibility: isPrivate ? 'private' : 'public' },
    ];
    this.persist();
  };
  forget = (repository: string, branch: string) => {
    this.reload();
    this.entries = this.entries.filter(
      (entry) => entry.repository !== repository || entry.branch !== branch,
    );
    this.persist();
  };
  repositoryMetadata = (repository: string, isPrivate: boolean) => {
    this.reload();
    const entry = this.entries.find((entry) => entry.repository === repository);
    if (!entry || entry.visibility === (isPrivate ? 'private' : 'public')) return;
    entry.visibility = isPrivate ? 'private' : 'public';
    this.persist();
  };
  authenticationChanged = (previous: string, next: string) => {
    if (previous === next && this.writable()) return;
    this.reload();
    this.entries = this.entries.filter((entry) => entry.visibility === 'public');
    this.persist();
  };
}
