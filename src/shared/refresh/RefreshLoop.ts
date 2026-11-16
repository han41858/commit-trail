// Split dispatch finishes before its work. null means nothing started; false
// from completion means that the owning session was discarded.
export type RefreshResult = {
  error?: string;
  retryAt?: number;
  completion?: Promise<boolean> | null;
};
export type RefreshState = {
  running: boolean;
  waitingForInitialLoad: boolean;
  lastCompletedAt: number | null;
  error: string;
  retryAt: number;
  nextAt: number;
};
export type RefreshClock = {
  now: () => number;
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
};
// GitHub deletes a merged branch 1-4 seconds after the merge push; the extra
// time covers second-resolution timestamps and a late branch listing.
export const RECHECK_DELAY = 7000;
const systemClock: RefreshClock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
export class RefreshLoop {
  private state: RefreshState = {
    running: false,
    waitingForInitialLoad: false,
    lastCompletedAt: null,
    error: '',
    retryAt: 0,
    nextAt: 0,
  };
  private listeners = new Set<() => void>();
  private timer: unknown;
  private recheckTimer: unknown;
  private recheckDue: number | undefined;
  private enabled = false;
  private interval = 300000;
  private scope = '';
  private generation = 0;
  private pending: Promise<void> | null = null;
  private completions = new Set<Promise<boolean>>();
  constructor(
    private readonly update: (
      kind: 'manual' | 'auto',
    ) => Promise<RefreshResult>,
    private readonly active = () => true,
    private readonly clock: RefreshClock = systemClock,
    // Runs the targets that are due at `now` and returns the next due time, if
    // any. With `discard` it only forgets every target.
    private readonly recheck: (
      discard: boolean,
      now: number,
    ) => number | undefined = () => undefined,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<RefreshState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  configure(
    scope: string,
    enabled: boolean,
    interval: number,
    waitForInitialLoad = false,
  ) {
    if (scope !== this.scope) {
      this.cancelRecheck();
      this.generation++;
      this.pending = null;
      this.completions.clear();
      this.scope = scope;
      this.state = {
        running: false,
        waitingForInitialLoad: waitForInitialLoad,
        lastCompletedAt: null,
        error: '',
        retryAt: 0,
        nextAt: waitForInitialLoad ? 0 : this.clock.now() + interval,
      };
    }
    if (interval !== this.interval && !this.state.waitingForInitialLoad)
      this.state = { ...this.state, nextAt: this.clock.now() + interval };
    this.enabled = enabled;
    this.interval = interval;
    this.publish({});
    this.schedule();
  }
  loaded() {
    if (
      this.scope &&
      (this.state.waitingForInitialLoad ||
        this.state.lastCompletedAt === null) &&
      !this.pending &&
      !this.completions.size
    ) {
      this.publish({
        waitingForInitialLoad: false,
        lastCompletedAt: this.clock.now(),
        nextAt: this.clock.now() + this.interval,
      });
      this.schedule();
    }
  }
  private trackCompletion(completion: Promise<boolean>, generation: number) {
    this.completions.add(completion);
    const finish = (completed: boolean) => {
      this.completions.delete(completion);
      if (completed && generation === this.generation)
        this.publish({ lastCompletedAt: this.clock.now() });
    };
    void completion.then(finish, () => finish(true));
  }
  private schedule = () => {
    this.clock.clear(this.timer);
    if (
      !this.scope ||
      !this.enabled ||
      this.state.waitingForInitialLoad ||
      !this.active() ||
      this.pending
    )
      return;
    const due = Math.max(this.state.nextAt, this.state.retryAt);
    this.timer = this.clock.set(
      () => {
        void this.refresh('auto');
      },
      Math.max(0, due - this.clock.now()),
    );
  };
  visibilityChanged = () => {
    this.schedule();
    this.armRecheck();
  };
  private cancelRecheck() {
    this.clock.clear(this.recheckTimer);
    this.recheckTimer = undefined;
    if (this.recheckDue !== undefined) {
      this.recheckDue = undefined;
      this.recheck(true, this.clock.now());
    }
  }
  private armRecheck() {
    this.clock.clear(this.recheckTimer);
    this.recheckTimer = undefined;
    // A hidden page keeps its targets and runs them when it is visible again.
    if (this.recheckDue === undefined || !this.active()) return;
    this.recheckTimer = this.clock.set(
      this.runRecheck,
      Math.max(0, this.recheckDue - this.clock.now()),
    );
  }
  private runRecheck = () => {
    this.recheckTimer = undefined;
    if (this.recheckDue === undefined) return;
    if (!this.active()) return;
    const now = this.clock.now();
    // The retry deadline starts a regular refresh, which reads everything.
    if (this.state.retryAt > now) return this.cancelRecheck();
    this.recheckDue = undefined;
    // Not a cycle of its own: progress, completion time and deadline stay as
    // they are, and a regular refresh still in flight does not hold this back.
    const next = this.recheck(false, now);
    if (next !== undefined) this.recheckAt(next);
  };
  private recheckAt(due: number) {
    this.recheckDue =
      this.recheckDue === undefined ? due : Math.min(this.recheckDue, due);
    this.armRecheck();
  }
  // A branch head moved: returns when its repository should be read once more.
  recheckSoon = () => {
    const due = this.clock.now() + RECHECK_DELAY;
    if (this.scope) this.recheckAt(due);
    return due;
  };
  stop = () => {
    this.cancelRecheck();
    this.enabled = false;
    this.generation++;
    this.pending = null;
    this.completions.clear();
    this.clock.clear(this.timer);
    if (this.state.running) this.publish({ running: false });
  };
  refresh = (kind: 'manual' | 'auto' = 'manual') => {
    if (this.pending) return this.pending;
    if (
      kind === 'auto' &&
      (!this.enabled ||
        this.state.waitingForInitialLoad ||
        this.clock.now() < Math.max(this.state.nextAt, this.state.retryAt))
    ) {
      this.schedule();
      return Promise.resolve();
    }
    if (!this.scope || !this.active() || this.state.retryAt > this.clock.now())
      return Promise.resolve();
    const generation = this.generation;
    this.clock.clear(this.timer);
    const task = Promise.resolve()
      .then(() =>
        generation === this.generation
          ? this.update(kind)
          : ({} as RefreshResult),
      )
      .then((result) => {
        if (generation !== this.generation) return;
        this.publish({
          error: result.error || '',
          retryAt: result.retryAt || 0,
          ...(result.completion === undefined
            ? { lastCompletedAt: this.clock.now() }
            : {}),
          nextAt: this.state.waitingForInitialLoad
            ? 0
            : result.retryAt && result.retryAt > this.clock.now()
              ? result.retryAt
              : this.clock.now() + this.interval,
        });
        if (result.completion)
          this.trackCompletion(result.completion, generation);
      })
      .catch((error) => {
        if (generation === this.generation)
          this.publish({
            error: error instanceof Error ? error.message : 'Refresh failed.',
            lastCompletedAt: this.clock.now(),
            nextAt: this.state.waitingForInitialLoad
              ? 0
              : this.clock.now() + this.interval,
          });
      })
      .finally(() => {
        if (this.pending === task) {
          this.pending = null;
          this.publish({ running: false });
          this.schedule();
        }
      });
    this.pending = task;
    this.publish({ running: true });
    return task;
  };
}
