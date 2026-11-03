import { requestActivity } from './requestActivity';

// Local numeric diagnostics only. Never accept tokens, headers, error messages or response bodies.
export type ApiKind =
  | 'repository'
  | 'identity'
  | 'commits'
  | 'branches'
  | 'tags'
  | 'releases'
  | 'actions-runs'
  | 'actions-jobs'
  | 'tag-objects'
  | 'pulls'
  | 'activity'
  | 'other';
export type RefreshKind = 'initial' | 'manual' | 'auto';
export type Changes = {
  commitsAdded: number;
  commitsChanged: number;
  commitsRemoved: number;
  branchesAdded: number;
  branchesRemoved: number;
  branchesChanged: number;
  tagsChanged: number;
  releasesChanged: number;
  actionsChanged: number;
};
export const noChanges = (): Changes => ({
  commitsAdded: 0,
  commitsChanged: 0,
  commitsRemoved: 0,
  branchesAdded: 0,
  branchesRemoved: 0,
  branchesChanged: 0,
  tagsChanged: 0,
  releasesChanged: 0,
  actionsChanged: 0,
});
type Counts = {
  requests: number;
  conditional: number;
  notModified: number;
  memoryHits: number;
  shared: number;
  duplicates: number;
  failed: number;
  cancelled: number;
  queuedCancelled: number;
  totalMs: number;
  maxMs: number;
  types: Partial<Record<ApiKind, number>>;
  statuses: Record<string, number>;
};
const counts = (): Counts => ({
  requests: 0,
  conditional: 0,
  notModified: 0,
  memoryHits: 0,
  shared: 0,
  duplicates: 0,
  failed: 0,
  cancelled: 0,
  queuedCancelled: 0,
  totalMs: 0,
  maxMs: 0,
  types: {},
  statuses: {},
});
export type RequestSample = {
  kind: ApiKind;
  cycleId: string | null;
  status: number | null;
  outcome: 'success' | 'failed' | 'cancelled';
  ms: number;
  conditional: boolean;
};
export type TimingSample = { ms: number; cycleId: string | null };
export type CycleSample = Counts &
  Changes & {
    id: string;
    kind: RefreshKind;
    durationMs: number;
    outcome: 'running' | 'completed' | 'failed' | 'cancelled';
    layouts: number;
    layoutMs: number;
    renders: number;
    renderMs: number;
  };
export type DebugCycle = {
  sample: CycleSample;
  session: number;
  start: number;
  parts: Set<string>;
  changes: () => Changes;
  endedAt?: number;
  cancelled: boolean;
};
export type RateSample = {
  resource: string;
  limit: number | null;
  remaining: number | null;
  used: number | null;
  resetAt: number | null;
  observedUsedDelta: number | null;
};
export type GraphSample = {
  loaded: number;
  visible: number;
  drawn: number;
  branches: number;
  lanes: number;
};
export type DebugSnapshot = {
  api: Counts;
  rates: RateSample[];
  requests: RequestSample[];
  cycles: CycleSample[];
  layouts: TimingSample[];
  renders: TimingSample[];
  layoutCount: number;
  renderCount: number;
  graph: GraphSample;
  hidden: boolean;
};
const empty = (): DebugSnapshot => ({
  api: counts(),
  rates: [],
  requests: [],
  cycles: [],
  layouts: [],
  renders: [],
  layoutCount: 0,
  renderCount: 0,
  graph: { loaded: 0, visible: 0, drawn: 0, branches: 0, lanes: 0 },
  hidden: false,
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const bounded = <T>(items: T[], item: T) => {
  items.push(item);
  if (items.length > 20) items.shift();
};
const hash = (value: string) => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
};
export function apiKind(path: string): ApiKind {
  const route = path.split('?')[0];
  if (
    [
      'repository',
      'identity',
      'commits',
      'branches',
      'tags',
      'releases',
      'actions-runs',
      'actions-jobs',
      'tag-objects',
      'pulls',
      'activity',
      'other',
    ].includes(path)
  )
    return path as ApiKind;
  if (route === '/user') return 'identity';
  if (/\/actions\/.*\/jobs$/.test(route)) return 'actions-jobs';
  if (/\/actions\/runs(?:\/\d+)?$/.test(route)) return 'actions-runs';
  if (/\/git\/(?:ref|tags)/.test(route)) return 'tag-objects';
  for (const [pattern, kind] of [
    [/\/commits(?:\/|$)/, 'commits'],
    [/\/branches(?:\/|$)/, 'branches'],
    [/\/tags$/, 'tags'],
    [/\/releases(?:\/|$)/, 'releases'],
    [/\/pulls(?:\/|$)/, 'pulls'],
    [/\/activity$/, 'activity'],
  ] as const)
    if (pattern.test(route)) return kind;
  return /^\/repos\/[^/]+\/[^/]+$/.test(route) ? 'repository' : 'other';
}

export class DebugMetrics {
  private mode: 'off' | 'button' | 'panel' = 'off';
  private session = 0;
  private sequence = 0;
  private data = empty();
  private snapshot = empty();
  private modeListeners = new Set<() => void>();
  private metricListeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private completions = new Set<ReturnType<typeof setTimeout>>();
  private signals = new WeakMap<AbortSignal, DebugCycle>();
  private graphs = new WeakMap<object, DebugCycle>();
  private activePaths = new Map<number, number>();
  private rateWindows = new Map<string, { min: number; max: number }>();
  constructor(
    private readonly clock = () => performance.now(),
    private readonly log = (kind: string, value: unknown) =>
      console.debug(`[GitStream debug] ${kind}`, value),
  ) {}
  enabled = () => this.mode !== 'off';
  getMode = () => this.mode;
  subscribeMode = (listener: () => void) => {
    this.modeListeners.add(listener);
    return () => {
      this.modeListeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.metricListeners.add(listener);
    this.flush();
    return () => {
      this.metricListeners.delete(listener);
      if (!this.metricListeners.size) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  };
  setMode(mode: 'off' | 'button' | 'panel') {
    if (mode === this.mode) return;
    const wasEnabled = this.enabled();
    this.mode = mode;
    if (!this.enabled() || !wasEnabled) this.reset();
    for (const listener of this.modeListeners) listener();
  }
  toggle = () => this.setMode(this.mode === 'panel' ? 'button' : 'panel');
  reset = () => {
    this.session++;
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const timer of this.completions) clearTimeout(timer);
    this.completions.clear();
    this.activePaths.clear();
    this.rateWindows.clear();
    this.signals = new WeakMap();
    this.graphs = new WeakMap();
    this.data = empty();
    this.snapshot = empty();
    if (this.enabled()) for (const listener of this.metricListeners) listener();
  };
  setHidden(hidden: boolean) {
    if (!this.enabled() || hidden === this.data.hidden) return;
    this.data.hidden = hidden;
    if (hidden) {
      clearTimeout(this.timer);
      this.timer = undefined;
    } else this.touch();
  }
  private touch() {
    if (
      !this.enabled() ||
      this.data.hidden ||
      !this.metricListeners.size ||
      this.timer !== undefined
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 250);
  }
  private flush() {
    if (!this.enabled()) return;
    this.snapshot = clone(this.data);
    for (const listener of this.metricListeners) listener();
  }
  private valid(cycle?: DebugCycle) {
    return this.enabled() && cycle?.session === this.session;
  }
  forSignal(signal?: AbortSignal) {
    const cycle = this.enabled() && signal ? this.signals.get(signal) : undefined;
    return cycle && this.valid(cycle) && cycle.endedAt === undefined ? cycle : undefined;
  }
  bind(signal: AbortSignal, cycle?: DebugCycle) {
    if (this.valid(cycle) && !cycle!.cancelled && cycle!.endedAt === undefined)
      this.signals.set(signal, cycle!);
  }
  cancelSignal(signal: AbortSignal) {
    const cycle = this.forSignal(signal);
    if (cycle) cycle.cancelled = true;
  }
  bindGraph(commits: object, cycle?: DebugCycle) {
    if (this.valid(cycle) && !cycle!.cancelled && cycle!.endedAt === undefined)
      this.graphs.set(commits, cycle!);
  }
  private graphCycle(commits: object) {
    const cycle = this.graphs.get(commits);
    return this.valid(cycle) &&
      (cycle!.endedAt === undefined || this.clock() - cycle!.endedAt <= 100)
      ? cycle
      : undefined;
  }
  private targets(cycle?: DebugCycle) {
    return cycle && this.valid(cycle) && cycle.endedAt === undefined
      ? [this.data.api, cycle.sample]
      : [this.data.api];
  }
  beginCycle(
    kind: RefreshKind,
    changes: () => Changes = noChanges,
    parts = ['work'],
  ): DebugCycle | undefined {
    if (!this.enabled()) return;
    const sample: CycleSample = {
      ...counts(),
      ...noChanges(),
      id: `refresh-${++this.sequence}`,
      kind,
      durationMs: 0,
      outcome: 'running',
      layouts: 0,
      layoutMs: 0,
      renders: 0,
      renderMs: 0,
    };
    bounded(this.data.cycles, sample);
    this.touch();
    return {
      sample,
      session: this.session,
      start: this.clock(),
      parts: new Set(parts),
      changes,
      cancelled: false,
    };
  }
  finish(
    cycle: DebugCycle | undefined,
    part = 'work',
    outcome: CycleSample['outcome'] = 'completed',
  ) {
    if (!this.valid(cycle) || cycle!.endedAt !== undefined || !cycle!.parts.delete(part)) return;
    if (outcome !== 'completed') cycle!.sample.outcome = outcome;
    if (cycle!.parts.size) return;
    if (cycle!.sample.outcome === 'running') cycle!.sample.outcome = 'completed';
    cycle!.endedAt = this.clock();
    cycle!.sample.durationMs = cycle!.endedAt - cycle!.start;
    if (cycle!.cancelled) cycle!.sample.outcome = 'cancelled';
    Object.assign(cycle!.sample, cycle!.changes());
    this.touch();
    // Allow React's normal commit/effect work to contribute without extending the
    // measured network/work duration. Later frames remain separate timing samples.
    const timer = setTimeout(() => {
      this.completions.delete(timer);
      if (this.valid(cycle)) this.log('refresh', clone(cycle!.sample));
    }, 100);
    this.completions.add(timer);
  }
  cache(pathOrKind: string, cycle?: DebugCycle, kind: 'memory' | 'shared' = 'memory') {
    if (!this.enabled()) return;
    for (const target of this.targets(cycle)) target[kind === 'memory' ? 'memoryHits' : 'shared']++;
    this.log('cache', {
      kind,
      api: apiKind(pathOrKind),
      cycleId: this.valid(cycle) ? cycle!.sample.id : null,
    });
    this.touch();
  }
  queuedCancelled(cycle?: DebugCycle) {
    if (!this.enabled()) return;
    for (const target of this.targets(cycle)) target.queuedCancelled++;
    this.touch();
  }
  request(path: string, conditional: boolean, cycle?: DebugCycle, aborted = false) {
    if (!this.enabled()) return;
    if (aborted) {
      for (const target of this.targets(cycle)) target.cancelled++;
      this.touch();
      return;
    }
    if (cycle?.endedAt !== undefined) cycle = undefined;
    const session = this.session,
      start = this.clock(),
      kind = apiKind(path),
      key = hash(path),
      overlap = (this.activePaths.get(key) || 0) > 0;
    this.activePaths.set(key, (this.activePaths.get(key) || 0) + 1);
    for (const target of this.targets(cycle)) {
      target.requests++;
      target.types[kind] = (target.types[kind] || 0) + 1;
      if (conditional) target.conditional++;
      if (overlap) target.duplicates++;
    }
    this.touch();
    let status: number | null = null,
      finished = false;
    return {
      response: (response: Response) => {
        if (!this.enabled() || session !== this.session) return;
        status = response.status;
        this.rate(response.headers);
      },
      finish: (outcome: RequestSample['outcome']) => {
        if (finished) return;
        finished = true;
        if (!this.enabled() || session !== this.session) return;
        const count = (this.activePaths.get(key) || 1) - 1;
        if (count) this.activePaths.set(key, count);
        else this.activePaths.delete(key);
        const ms = Math.max(0, this.clock() - start);
        for (const target of this.targets(cycle)) {
          target.totalMs += ms;
          target.maxMs = Math.max(target.maxMs, ms);
          const code = String(status ?? 'network');
          target.statuses[code] = (target.statuses[code] || 0) + 1;
          if (status === 304) target.notModified++;
          if (outcome === 'failed') target.failed++;
          if (outcome === 'cancelled') target.cancelled++;
        }
        const sample: RequestSample = {
          kind,
          cycleId: this.valid(cycle) ? cycle!.sample.id : null,
          status,
          outcome,
          ms,
          conditional,
        };
        bounded(this.data.requests, sample);
        this.log('HTTP', clone(sample));
        this.touch();
      },
    };
  }
  private rate(headers: Headers) {
    const number = (name: string) => {
      const value = headers.get(name);
      return value !== null && /^\d+$/.test(value) ? Number(value) : null;
    };
    const limit = number('X-RateLimit-Limit'),
      remaining = number('X-RateLimit-Remaining'),
      used = number('X-RateLimit-Used'),
      reset = number('X-RateLimit-Reset');
    if (limit === null && remaining === null && used === null && reset === null) return;
    const raw = headers.get('X-RateLimit-Resource'),
      resource = ['core', 'search', 'graphql', 'code_search', 'integration_manifest'].includes(
        raw || '',
      )
        ? raw!
        : 'other';
    const key = `${resource}:${limit}:${reset}`;
    let observedUsedDelta: number | null = null;
    if (used !== null) {
      const window = this.rateWindows.get(key) || { min: used, max: used };
      window.min = Math.min(window.min, used);
      window.max = Math.max(window.max, used);
      this.rateWindows.set(key, window);
      observedUsedDelta = window.max - window.min;
    }
    if (this.rateWindows.size > 20) this.rateWindows.delete(this.rateWindows.keys().next().value!);
    const sample: RateSample = {
      resource,
      limit,
      remaining,
      used,
      resetAt: reset === null ? null : reset * 1000,
      observedUsedDelta,
    };
    const index = this.data.rates.findIndex((item) => item.resource === resource);
    if (index >= 0) this.data.rates[index] = sample;
    else bounded(this.data.rates, sample);
  }
  startTime() {
    return this.enabled() ? this.clock() : undefined;
  }
  layout(start: number | undefined, commits: object) {
    if (start === undefined || !this.enabled()) return;
    const ms = Math.max(0, this.clock() - start),
      cycle = this.graphCycle(commits);
    this.data.layoutCount++;
    if (cycle) {
      cycle.sample.layouts++;
      cycle.sample.layoutMs += ms;
    }
    const sample = { ms, cycleId: cycle?.sample.id || null };
    bounded(this.data.layouts, sample);
    this.log('layout', sample);
    this.touch();
  }
  render(start: number | undefined, commits: object, graph: GraphSample) {
    if (start === undefined || !this.enabled()) return;
    const ms = Math.max(0, this.clock() - start),
      cycle = this.graphCycle(commits);
    this.data.renderCount++;
    this.data.graph = graph;
    if (cycle) {
      cycle.sample.renders++;
      cycle.sample.renderMs += ms;
    }
    const sample = { ms, cycleId: cycle?.sample.id || null };
    bounded(this.data.renders, sample);
    this.log('canvas', { ...sample, ...graph });
    this.touch();
  }
  diagnostics = () =>
    JSON.stringify(
      {
        schema: 1,
        scope: 'local numeric diagnostics; no tokens, URLs, names, messages or raw responses',
        ...clone(this.data),
        activity: {
          active: requestActivity.getSnapshot(),
          queued: requestActivity.getQueuedSnapshot(),
        },
      },
      null,
      2,
    );
  print = () => {
    if (this.enabled()) this.log('snapshot', JSON.parse(this.diagnostics()));
  };
}
export const debug = new DebugMetrics();
