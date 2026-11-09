import { History, type HistoryRefresh } from './history';
import { CommitInfoStore } from './CommitInfoStore';
import { measureRefresh } from './measuredOperations';
import type { RefreshResult } from './RefreshLoop';
import { normalizeMonitorRepositories } from './MonitorRepositories';
import type { BranchSelections } from './BranchSelections';

export type MonitorEntry = {
  repository: string;
  history: History;
  info: CommitInfoStore;
  primary: boolean;
  branch?: string;
};
type Snapshot = {
  active: boolean;
  settled: boolean;
  entries: readonly MonitorEntry[];
  running: ReadonlySet<MonitorEntry>;
  retryAt: number;
};
export class MonitorSession {
  private state: Snapshot = {
    active: false,
    settled: false,
    entries: [],
    running: new Set(),
    retryAt: 0,
  };
  private listeners = new Set<() => void>();
  private subscriptions: (() => void)[] = [];
  private tasks = new Map<MonitorEntry, Promise<RefreshResult>>();
  private primaryPending: Promise<RefreshResult> | null = null;
  private authentication = 0;
  private token = '';
  constructor(
    private readonly history: History,
    private readonly info: CommitInfoStore,
    private readonly metadata: (repository: string, isPrivate: boolean, visit: boolean) => void,
    private readonly branchSelections?: BranchSelections,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private isSettled(state: Snapshot) {
    return (
      state.active &&
      state.entries.length > 0 &&
      !state.running.size &&
      state.entries.every((entry) => {
        const history = entry.history.getSnapshot(),
          metadata = entry.info.getSnapshot();
        return (
          history.repo === entry.repository &&
          !history.busy &&
          !history.pendingSources.length &&
          (!history.meta ||
            (!metadata.busy && (!entry.primary || metadata.repo === entry.repository)))
        );
      })
    );
  }
  private publish(patch: Partial<Snapshot> = {}) {
    const state = { ...this.state, ...patch };
    state.settled = this.isSettled(state);
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  canRequest = () => this.state.retryAt <= Date.now();
  authenticationChanged = (previous: string, next: string) => {
    if (previous !== next) {
      this.authentication++;
      this.stop();
      this.primaryPending = null;
      if (this.state.retryAt) this.publish({ retryAt: 0 });
    }
  };
  private observe = () => {
    const retryAt = Math.max(
      this.state.retryAt,
      ...this.state.entries.flatMap((entry) => [
        entry.history.getSnapshot().retryAt || 0,
        entry.info.getSnapshot().retryAt,
      ]),
    );
    if (retryAt > this.state.retryAt || this.isSettled(this.state) !== this.state.settled)
      this.publish({ retryAt });
  };
  // Anonymous automatic cycles read tags, releases and Actions only after the
  // repository reports a push. The policy is the same for single and split views.
  private metadataAfter(
    history: History,
    kind: 'manual' | 'auto',
    task: Promise<HistoryRefresh>,
    refresh: (idle: boolean) => Promise<RefreshResult>,
  ) {
    if (kind !== 'auto' || !history.anonymous) return refresh(false);
    return task.then(
      (result) => refresh(result.repository !== 'changed'),
      () => refresh(true),
    );
  }
  private combined(entry: MonitorEntry): RefreshResult {
    const state = entry.history.getSnapshot(),
      extras = entry.info.getSnapshot();
    return {
      error: state.error || Object.values(extras.errors).join(' · ') || undefined,
      retryAt: Math.max(state.retryAt || 0, extras.retryAt),
    };
  }
  private captureResult = (result: RefreshResult) => {
    if (result.retryAt && result.retryAt > this.state.retryAt)
      this.publish({ retryAt: result.retryAt });
    return result;
  };
  private run(entry: MonitorEntry, work: () => Promise<RefreshResult>) {
    if (this.tasks.has(entry)) return;
    const task = Promise.resolve()
      .then<RefreshResult>(() =>
        this.state.active && this.state.entries.includes(entry) ? work() : {},
      )
      .catch((): RefreshResult => ({ error: 'Repository update failed.' }))
      .then((result) => {
        if (this.tasks.get(entry) === task && result.retryAt && result.retryAt > this.state.retryAt)
          this.publish({ retryAt: result.retryAt });
        return result;
      })
      .finally(() => {
        if (this.tasks.get(entry) === task) {
          this.tasks.delete(entry);
          this.publish({ running: new Set(this.tasks.keys()) });
        }
      });
    this.tasks.set(entry, task);
    this.publish({ running: new Set(this.tasks.keys()) });
    return task;
  }
  private async settle(tasks: Promise<RefreshResult>[]) {
    const results = await Promise.allSettled(tasks);
    return results.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  }
  private openEntry(entry: MonitorEntry) {
    return measureRefresh('initial', entry.history, entry.info, async (cycle) => {
      let metadata: Promise<void> | undefined;
      // Match the single-repository flow: initialize metadata before commits arrive,
      // so opening its store cannot erase the renderer's first visible-SHA watch.
      const openMetadata = () => {
        if (
          metadata ||
          !entry.history.getSnapshot().meta ||
          !this.state.active ||
          !this.state.entries.includes(entry) ||
          !this.canRequest()
        )
          return;
        metadata = entry.info.open(entry.repository, this.token, cycle);
      };
      const unsubscribe = entry.history.subscribe(openMetadata);
      try {
        await entry.history.open(entry.repository, this.token, cycle, entry.branch);
        if (!this.state.active || !this.state.entries.includes(entry)) {
          if (cycle) cycle.cancelled = true;
          return {};
        }
        await metadata;
        return this.combined(entry);
      } finally {
        unsubscribe();
      }
    });
  }
  start = (
    repositories: readonly string[],
    token: string,
    branches: readonly (string | undefined)[] = [],
    restorePrimary = false,
  ) => {
    this.stop();
    this.token = token;
    const entries = normalizeMonitorRepositories(repositories).map((repository) => {
      const current = this.history.getSnapshot(),
        primary = current.repo === repository && (!!current.meta || current.busy);
      const index = repositories.findIndex(
        (value) => normalizeMonitorRepositories([value])[0] === repository,
      );
      return {
        repository,
        primary,
        branch: branches[index],
        history: primary ? this.history : new History(this.metadata, this.branchSelections),
        info: primary ? this.info : new CommitInfoStore(),
      };
    });
    if (!entries.length) return;
    this.publish({ active: true, entries, running: new Set() });
    for (const entry of entries) {
      this.subscriptions.push(
        entry.history.subscribe(this.observe),
        entry.info.subscribe(this.observe),
      );
      if (!entry.primary) this.run(entry, () => this.openEntry(entry));
      else if (restorePrimary)
        this.run(entry, async () => {
          await entry.history.restoreBase(entry.branch);
          return this.combined(entry);
        });
      else if (this.primaryPending) {
        const pending = this.primaryPending;
        this.run(entry, () => pending);
      }
    }
    this.observe();
  };
  stop = () => {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    for (const entry of this.state.entries)
      if (!entry.primary) {
        entry.history.cancel();
        entry.info.cancel();
      }
    this.tasks.clear();
    if (this.state.active) this.publish({ active: false, entries: [], running: new Set() });
  };
  reorder = (repositories: readonly string[]) => {
    if (!this.state.active) return false;
    const names = normalizeMonitorRepositories(repositories);
    const byRepository = new Map(this.state.entries.map((entry) => [entry.repository, entry]));
    if (names.length !== this.state.entries.length || names.some((name) => !byRepository.has(name)))
      return false;
    const entries = names.map((name) => byRepository.get(name)!);
    if (entries.some((entry, index) => entry !== this.state.entries[index]))
      this.publish({ entries });
    return true;
  };
  refreshPrimary = (kind: 'manual' | 'auto'): Promise<RefreshResult> => {
    if (this.primaryPending) return this.primaryPending;
    if (!this.canRequest())
      return Promise.resolve({
        error: 'GitHub API rate limit reached. Waiting to retry.',
        retryAt: this.state.retryAt,
        completion: null,
      });
    const authentication = this.authentication,
      observe = (result: RefreshResult) =>
        authentication === this.authentication ? this.captureResult(result) : result;
    const task = measureRefresh(kind, this.history, this.info, async (cycle) => {
      const history: Promise<HistoryRefresh> = this.history.getSnapshot().error
        ? this.history.retry().then(() => {
            const state = this.history.getSnapshot();
            return { error: state.error || undefined, retryAt: state.retryAt || undefined };
          })
        : this.history.refresh(cycle, kind);
      const results = await this.settle([
        history.then(observe),
        this.metadataAfter(this.history, kind, history, (idle) =>
          this.info.refresh(false, undefined, cycle, idle),
        ).then(observe),
      ]);
      return {
        error:
          results
            .map((result) => result.error)
            .filter(Boolean)
            .join(' · ') || undefined,
        retryAt: Math.max(0, ...results.map((result) => result.retryAt || 0)),
      };
    }).finally(() => {
      if (this.primaryPending === task) this.primaryPending = null;
    });
    this.primaryPending = task;
    return task;
  };
  // The existing RefreshLoop owns the only deadline. Dispatch without awaiting the
  // slowest repository, so other columns can finish and refresh on the next tick.
  // Only this dispatch's newly started tasks determine its completion timestamp.
  refreshAll = (kind: 'manual' | 'auto'): Promise<RefreshResult> => {
    this.observe();
    if (!this.canRequest())
      return Promise.resolve({
        error: 'GitHub API rate limit reached. Waiting to retry.',
        retryAt: this.state.retryAt,
        completion: null,
      });
    if (this.state.retryAt) this.publish({ retryAt: 0 });
    const entries = this.state.entries,
      started: Promise<RefreshResult>[] = [];
    for (const entry of entries) {
      const state = entry.history.getSnapshot();
      if (this.tasks.has(entry) || state.busy || entry.info.getSnapshot().busy) continue;
      const task = this.run(entry, () =>
        !state.meta
          ? entry.primary
            ? entry.history.retry().then(() => this.combined(entry))
            : this.openEntry(entry)
          : entry.primary
            ? this.refreshPrimary(kind)
            : measureRefresh(kind, entry.history, entry.info, async (cycle) => {
                const history: Promise<HistoryRefresh> = state.error
                  ? entry.history.retry().then(() => this.combined(entry))
                  : entry.history.refresh(cycle, kind);
                const metadata =
                  entry.info.getSnapshot().repo === entry.repository
                    ? this.metadataAfter(entry.history, kind, history, (idle) =>
                        entry.info.refresh(false, undefined, cycle, idle),
                      )
                    : entry.info
                        .open(entry.repository, this.token, cycle)
                        .then(() => this.combined(entry));
                const observe = (result: RefreshResult) =>
                  this.state.active && this.state.entries.includes(entry)
                    ? this.captureResult(result)
                    : result;
                const results = await this.settle([history.then(observe), metadata.then(observe)]);
                return {
                  error:
                    results
                      .map((result) => result.error)
                      .filter(Boolean)
                      .join(' · ') || undefined,
                  retryAt: Math.max(0, ...results.map((result) => result.retryAt || 0)),
                };
              }),
      );
      if (task) started.push(task);
    }
    return Promise.resolve({
      completion: started.length
        ? Promise.allSettled(started).then(
            () => this.state.active && this.state.entries === entries,
          )
        : null,
    });
  };
}
