import { debug, type DebugCycle } from './debug';
import { GitHubError } from './api';
import { GitHubReader } from './GitHubReader';
import {
  actionSummary,
  activeRun,
  attempt,
  newerRun,
  type TagInfo,
  type ReleaseInfo,
  type ActionRun,
  type ActionJob,
  type JobInfo,
  type CommitInfo,
} from './CommitInfo';
import type { RefreshResult } from './RefreshLoop';
type Kind = 'tags' | 'releases' | 'actions';
export type InfoSnapshot = {
  repo: string;
  selected: string;
  bySha: ReadonlyMap<string, CommitInfo>;
  jobs: ReadonlyMap<number, JobInfo>;
  checked: ReadonlySet<string>;
  errors: Record<string, string>;
  busy: boolean;
  more: boolean;
  retryAt: number;
};
const empty = (): InfoSnapshot => ({
  repo: '',
  selected: '',
  bySha: new Map(),
  jobs: new Map(),
  checked: new Set(),
  errors: {},
  busy: false,
  more: false,
  retryAt: 0,
});
export class CommitInfoStore {
  private state = empty();
  private listeners = new Set<() => void>();
  private reader = new GitHubReader('');
  private tags = new Map<string, TagInfo>();
  private releases = new Map<number, ReleaseInfo>();
  private runs = new Map<number, ActionRun>();
  private jobs = new Map<number, JobInfo>();
  private seenCatalog = {
    tags: new Set<string>(),
    releases: new Set<string>(),
  };
  private scanning = { tags: false, releases: false };
  private loadedPages = { tags: 1, releases: 1 };
  private recentRuns = new Set<number>();
  private releaseRefs = new Map<string, { revision: number; sha: string }>();
  private next: Record<Kind, number> = { tags: 1, releases: 1, actions: 1 };
  private selected = '';
  private visible: string[] = [];
  private batch: Promise<RefreshResult> | null = null;
  private lookups = new Map<string, Promise<void>>();
  private jobRequests = new Map<string, Promise<void>>();
  private checked = new Set<string>();
  private lookupNext = new Map<string, number>();
  private lookupSeen = new Map<string, Set<number>>();
  private fingerprint = '';
  private catalogPages = new Map<string, string>();
  private catalogRevision = 0;
  private resolvedRevision = -1;
  private triedTags = new Set<string>();
  private needsReleaseResolution() {
    return [...this.releases.values()].some(
      (release) =>
        !this.tags.has(release.tag_name) &&
        (this.resolvedRevision !== this.catalogRevision ||
          !this.triedTags.has(release.tag_name)),
    );
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  private publish() {
    const fingerprint = JSON.stringify([
      [...this.tags],
      [...this.releases],
      [...this.runs],
      [...this.jobs],
    ]);
    let bySha = this.state.bySha;
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      const map = new Map<string, CommitInfo>();
      const get = (sha: string) => {
        let value = map.get(sha);
        if (!value) {
          value = { tags: [], releases: [], runs: [], actions: null };
          map.set(sha, value);
        }
        return value;
      };
      for (const tag of this.tags.values()) get(tag.sha).tags.push(tag);
      for (const release of this.releases.values()) {
        const tag = this.tags.get(release.tag_name);
        if (tag) get(tag.sha).releases.push(release);
      }
      for (const run of this.runs.values()) get(run.head_sha).runs.push(run);
      for (const info of map.values())
        info.actions = actionSummary(info.runs, this.jobs);
      bySha = map;
    }
    const unresolved = this.needsReleaseResolution();
    const pendingJobs = [...this.runs.values()].some(
      (run) =>
        run.head_sha === this.selected &&
        activeRun(run) &&
        this.jobs.get(run.id)?.attempt === attempt(run) &&
        (this.jobs.get(run.id)?.next || 0) > 0,
    );
    this.state = {
      ...this.state,
      selected: this.selected,
      bySha,
      jobs: new Map(this.jobs),
      checked: new Set(this.checked),
      busy: !!this.batch || this.lookups.size > 0 || this.jobRequests.size > 0,
      more:
        !!this.state.repo &&
        (!!this.next.tags ||
          !!this.next.releases ||
          (!this.selected && !!this.next.actions) ||
          unresolved ||
          !!this.lookupNext.get(this.selected) ||
          pendingJobs),
      retryAt: this.reader.retryAt,
    };
    for (const fn of this.listeners) fn();
  }
  cancel = () => {
    this.reader.cancel();
  };
  open = async (repo: string, token: string, cycle?: DebugCycle) => {
    this.cancel();
    this.reader = new GitHubReader(token);
    this.tags.clear();
    this.releases.clear();
    this.runs.clear();
    this.jobs.clear();
    this.lookups.clear();
    this.jobRequests.clear();
    this.checked.clear();
    this.lookupNext.clear();
    this.lookupSeen.clear();
    this.selected = '';
    this.visible = [];
    this.batch = null;
    this.fingerprint = '';
    this.catalogPages.clear();
    this.catalogRevision = 0;
    this.resolvedRevision = -1;
    this.triedTags.clear();
    this.seenCatalog = { tags: new Set(), releases: new Set() };
    this.scanning = { tags: false, releases: false };
    this.loadedPages = { tags: 1, releases: 1 };
    this.recentRuns.clear();
    this.releaseRefs.clear();
    this.next = { tags: 1, releases: 1, actions: 1 };
    this.state = { ...empty(), repo };
    this.publish();
    if (repo) await this.refresh(false, undefined, cycle);
  };
  private async guard(
    kind: string,
    reader: GitHubReader,
    work: () => Promise<void>,
  ) {
    try {
      await work();
      if (reader === this.reader) {
        const errors = { ...this.state.errors };
        delete errors[kind];
        this.state = { ...this.state, errors };
      }
    } catch (error) {
      if (!reader.controller.signal.aborted && reader === this.reader)
        this.state = {
          ...this.state,
          errors: {
            ...this.state.errors,
            [kind]:
              error instanceof GitHubError &&
              error.status === 403 &&
              !error.retryAt
                ? `Needs ${kind === 'actions' || kind.startsWith('jobs:') || kind.startsWith('run:') ? 'Actions' : 'Contents'}: Read-only.`
                : (error as Error).message,
          },
        };
    }
    if (reader === this.reader) this.publish();
  }
  private changedPage(key: string, data: unknown) {
    const value = JSON.stringify(data);
    if (this.catalogPages.get(key) === value) return false;
    this.catalogPages.set(key, value);
    this.catalogRevision++;
    return true;
  }
  private catalog(
    kind: 'tags' | 'releases',
    page: number,
    keys: string[],
    next: boolean,
  ) {
    if (page === 1) {
      this.seenCatalog[kind].clear();
      this.scanning[kind] = true;
    }
    for (const key of keys) this.seenCatalog[kind].add(key);
    if (!next && this.scanning[kind]) {
      if (kind === 'tags') {
        for (const key of this.tags.keys())
          if (!this.seenCatalog.tags.has(key)) this.tags.delete(key);
      } else
        for (const key of this.releases.keys())
          if (!this.seenCatalog.releases.has(String(key)))
            this.releases.delete(key);
      this.scanning[kind] = false;
    }
  }
  private addTag(name: string, sha: string) {
    this.tags.set(name, {
      name,
      sha,
      url: `https://github.com/${this.state.repo}/tree/${encodeURIComponent(name)}`,
    });
  }
  private upsert(runs: ActionRun[]) {
    for (const run of runs) {
      const old = this.runs.get(run.id);
      if (!newerRun(old, run)) continue;
      if (old && attempt(old) !== attempt(run)) this.jobs.delete(run.id);
      if (run.status === 'completed') {
        const errors = { ...this.state.errors };
        delete errors[`jobs:${run.id}`];
        this.state = { ...this.state, errors };
      }
      const cached = this.jobs.get(run.id);
      if (
        run.status === 'completed' &&
        cached &&
        cached.jobs.some((job) => job.status !== 'completed')
      )
        this.jobs.set(run.id, { ...cached, complete: false });
      this.runs.set(run.id, run);
    }
  }
  private async page(
    kind: Kind,
    page: number,
    reader: GitHubReader,
    cycle?: DebugCycle,
  ) {
    const base = `/repos/${this.state.repo}`,
      path = kind === 'actions' ? `${base}/actions/runs` : `${base}/${kind}`;
    if (kind !== 'actions')
      this.loadedPages[kind] = Math.max(this.loadedPages[kind], page);
    if (kind === 'tags') {
      const result = await reader.get<
        { name: string; commit: { sha: string } }[]
      >(`${path}?per_page=100&page=${page}`, false, cycle);
      reader.controller.signal.throwIfAborted();
      if (!Array.isArray(result.data))
        throw new Error('Tag metadata is unavailable.');
      const changed = this.changedPage(`tags:${page}`, result.data);
      this.catalog(
        'tags',
        page,
        result.data.map((tag) => tag.name),
        result.next,
      );
      for (const tag of result.data) this.addTag(tag.name, tag.commit.sha);
      if (page > 1 || this.next.tags <= 1 || (page === 1 && changed))
        this.next.tags = result.next ? page + 1 : 0;
    } else if (kind === 'releases') {
      const result = await reader.get<ReleaseInfo[]>(
        `${path}?per_page=100&page=${page}`,
        false,
        cycle,
      );
      reader.controller.signal.throwIfAborted();
      if (!Array.isArray(result.data))
        throw new Error('Release metadata is unavailable.');
      const changed = this.changedPage(`releases:${page}`, result.data);
      this.catalog(
        'releases',
        page,
        result.data.map((release) => String(release.id)),
        result.next,
      );
      for (const release of result.data) this.releases.set(release.id, release);
      if (page > 1 || this.next.releases <= 1 || (page === 1 && changed))
        this.next.releases = result.next ? page + 1 : 0;
    } else {
      const result = await reader.get<{ workflow_runs: ActionRun[] }>(
        `${path}?per_page=100&page=${page}`,
        false,
        cycle,
      );
      reader.controller.signal.throwIfAborted();
      if (!Array.isArray(result.data.workflow_runs))
        throw new Error('Actions history is unavailable.');
      if (page === 1)
        this.recentRuns = new Set(
          result.data.workflow_runs.map((run) => run.id),
        );
      this.upsert(result.data.workflow_runs);
      if (page > 1 || this.next.actions <= 1)
        this.next.actions = result.next ? page + 1 : 0;
    }
  }
  private async versions(
    kind: 'tags' | 'releases',
    more: boolean,
    reader: GitHubReader,
    cycle?: DebugCycle,
  ) {
    if (more) {
      if (this.next[kind])
        await this.page(kind, this.next[kind], reader, cycle);
      return;
    }
    // Revalidate only catalog pages the user has loaded; details stay cached.
    for (let page = 1; page <= this.loadedPages[kind]; page++) {
      await this.page(kind, page, reader, cycle);
      if (!this.next[kind]) break;
    }
  }
  private async refreshActiveRuns(reader: GitHubReader, cycle?: DebugCycle) {
    if (this.state.errors.actions) return;
    const active = [...this.runs.values()].filter(
      (run) => activeRun(run) && !this.recentRuns.has(run.id),
    );
    await Promise.all(
      active.map((run) =>
        this.guard(`run:${run.id}`, reader, async () => {
          const result = await reader.get<ActionRun>(
            `/repos/${this.state.repo}/actions/runs/${run.id}`,
            false,
            cycle,
          );
          reader.controller.signal.throwIfAborted();
          if (result.data.id !== run.id)
            throw new Error('Workflow execution status is unavailable.');
          this.upsert([result.data]);
        }),
      ),
    );
  }
  private async resolveReleases(reader: GitHubReader, cycle?: DebugCycle) {
    if (this.resolvedRevision !== this.catalogRevision) {
      this.triedTags.clear();
      this.resolvedRevision = this.catalogRevision;
    }
    const names = [
        ...new Set(
          [...this.releases.values()].map((release) => release.tag_name),
        ),
      ]
        .filter(
          (name) =>
            !this.tags.has(name) &&
            (!this.triedTags.has(name) ||
              this.releaseRefs.get(name)?.revision === this.catalogRevision),
        )
        .slice(0, 8),
      base = `/repos/${this.state.repo}`;
    await Promise.all(
      names.map(async (name) => {
        try {
          const cached = this.releaseRefs.get(name);
          if (cached?.revision === this.catalogRevision) {
            debug.cache('tag-objects', cycle);
            this.addTag(name, cached.sha);
            return;
          }
          this.triedTags.add(name);
          let object = (
            await reader.get<{ object: { type: string; sha: string } }>(
              `${base}/git/ref/tags/${encodeURIComponent(name)}`,
              false,
              cycle,
            )
          ).data.object;
          const seen = new Set<string>();
          while (object.type === 'tag') {
            if (seen.has(object.sha) || seen.size >= 16)
              throw new Error('Annotated tag could not be resolved.');
            seen.add(object.sha);
            object = (
              await reader.get<{ object: { type: string; sha: string } }>(
                `${base}/git/tags/${object.sha}`,
                true,
                cycle,
              )
            ).data.object;
          }
          reader.controller.signal.throwIfAborted();
          if (object.type === 'commit') {
            this.addTag(name, object.sha);
            this.releaseRefs.set(name, {
              revision: this.catalogRevision,
              sha: object.sha,
            });
          }
        } catch (error) {
          if (error instanceof GitHubError && error.status === 404) return;
          if (reader === this.reader) this.triedTags.delete(name);
          throw error;
        }
      }),
    );
  }
  private fetchJobs(
    run: ActionRun,
    reader: GitHubReader,
    force: boolean,
    cycle?: DebugCycle,
  ) {
    const key = `${run.id}:${attempt(run)}`,
      pending = this.jobRequests.get(key);
    if (pending) {
      debug.cache('actions-jobs', cycle, 'shared');
      return pending;
    }
    const old = this.jobs.get(run.id);
    if (!force && old?.attempt === attempt(run) && old.complete) {
      debug.cache('actions-jobs', cycle);
      return Promise.resolve();
    }
    const task = this.guard(`jobs:${run.id}`, reader, async () => {
      const resume =
        old?.attempt === attempt(run) && !old.complete && old.next > 1;
      const all = new Map((resume ? old.jobs : []).map((job) => [job.id, job]));
      let page = resume ? old.next : 1,
        total = 0,
        next = true;
      for (let count = 0; count < 5 && next; count++) {
        const result = await reader.get<{
          total_count: number;
          jobs: ActionJob[];
        }>(
          `/repos/${this.state.repo}/actions/runs/${run.id}/attempts/${attempt(run)}/jobs?per_page=100&page=${page}`,
          false,
          cycle,
        );
        reader.controller.signal.throwIfAborted();
        if (attempt(this.runs.get(run.id) || run) !== attempt(run)) return;
        if (!Array.isArray(result.data.jobs))
          throw new Error('Workflow job information is unavailable.');
        total = result.data.total_count;
        for (const job of result.data.jobs)
          if (
            job.run_id === run.id &&
            (job.run_attempt === undefined || job.run_attempt === attempt(run))
          )
            all.set(job.id, job);
        next = result.next;
        page++;
      }
      this.jobs.set(run.id, {
        attempt: attempt(run),
        jobs: [...all.values()],
        total,
        complete: !next && all.size === total,
        next: next ? page : 0,
      });
    }).finally(() => {
      if (this.jobRequests.get(key) === task) {
        this.jobRequests.delete(key);
        this.publish();
      }
    });
    this.jobRequests.set(key, task);
    this.publish();
    return task;
  }
  private async ensureJobs(force = false, cycle?: DebugCycle) {
    const reader = this.reader,
      targets = [...new Set([this.selected, ...this.visible].filter(Boolean))],
      tasks: Promise<void>[] = [];
    if (this.state.errors.actions) return;
    for (const sha of targets) {
      const runs = [...this.runs.values()].filter(
        (run) => run.head_sha === sha,
      );
      if (!runs.some(activeRun)) continue;
      // An active commit needs every workflow's denominator. Completed snapshots
      // are filled once and then reused while only active jobs keep polling.
      for (const run of runs)
        if (activeRun(run) || run.status === 'completed')
          tasks.push(
            this.fetchJobs(run, reader, activeRun(run) && force, cycle),
          );
    }
    await Promise.all(tasks);
  }
  watch = (shas: string[]) => {
    const next = [...new Set(shas)].slice(0, 24);
    if (next.join(',') !== this.visible.join(',')) {
      this.visible = next;
      void this.ensureJobs();
    }
  };
  clearSelection = () => {
    if (this.selected) {
      this.selected = '';
      this.publish();
    }
  };
  inspect = (
    sha: string,
    force = false,
    withJobs = true,
    cycle?: DebugCycle,
  ) => {
    const changed = this.selected !== sha;
    this.selected = sha;
    const pending = this.lookups.get(sha);
    if (pending) {
      debug.cache('actions-runs', cycle, 'shared');
      if (changed) this.publish();
      return pending;
    }
    if (!force && this.checked.has(sha)) {
      debug.cache('actions-runs', cycle);
      if (changed) this.publish();
      return withJobs ? this.ensureJobs(false, cycle) : Promise.resolve();
    }
    const reader = this.reader,
      base = `/repos/${this.state.repo}`;
    const task = this.guard('actions', reader, async () => {
      if (force || !this.lookupSeen.has(sha))
        this.lookupSeen.set(sha, new Set());
      const seen = this.lookupSeen.get(sha)!;
      let next = true,
        page = force ? 1 : this.lookupNext.get(sha) || 1;
      for (let count = 0; count < 3 && next; count++, page++) {
        const result = await reader.get<{ workflow_runs: ActionRun[] }>(
          `${base}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100&page=${page}`,
          false,
          cycle,
        );
        reader.controller.signal.throwIfAborted();
        if (!Array.isArray(result.data.workflow_runs))
          throw new Error('Actions history is unavailable.');
        const runs = result.data.workflow_runs.filter(
          (run) => run.head_sha === sha,
        );
        for (const run of runs) seen.add(run.id);
        this.upsert(runs);
        next = result.next;
        this.lookupNext.set(sha, next ? page + 1 : 0);
      }
      if (!next) {
        this.checked.add(sha);
        for (const [id, run] of this.runs)
          if (run.head_sha === sha && !seen.has(id)) {
            this.runs.delete(id);
            this.jobs.delete(id);
          }
      }
    })
      .then(async () => {
        if (
          withJobs &&
          reader === this.reader &&
          !reader.controller.signal.aborted
        )
          await this.ensureJobs(false, cycle);
      })
      .finally(() => {
        if (this.lookups.get(sha) === task) {
          this.lookups.delete(sha);
          this.publish();
        }
      });
    this.lookups.set(sha, task);
    this.publish();
    return task;
  };
  loadMore = (sha: string) => this.refresh(true, sha);
  // idle: the repository reported no push, so only unfinished Actions can have changed.
  // A catalog whose last read failed is still retried until it succeeds.
  refresh = (
    more = false,
    sha = this.selected,
    cycle?: DebugCycle,
    idle = false,
  ): Promise<RefreshResult> => {
    const changed = more && this.selected !== sha;
    if (changed) this.selected = sha;
    if (this.batch) {
      debug.cache('other', cycle, 'shared');
      if (changed) this.publish();
      return this.batch;
    }
    if (!this.state.repo) return Promise.resolve({});
    const reader = this.reader;
    const task = Promise.resolve()
      .then(async () => {
        const quiet = idle && !more,
          skip = (kind: Kind) => quiet && !this.state.errors[kind];
        // Actions do not depend on tags; releases wait because they resolve against them.
        const actions = (
          skip('actions')
            ? [...this.runs.values()].some(activeRun)
            : !more || (!this.selected && this.next.actions)
        )
          ? this.guard('actions', reader, () =>
              this.page('actions', more ? this.next.actions : 1, reader, cycle),
            )
          : undefined;
        if (!skip('tags') && (!more || this.next.tags))
          await this.guard('tags', reader, () =>
            this.versions('tags', more, reader, cycle),
          );
        if (reader !== this.reader) return {};
        await Promise.all([
          ...(!skip('releases') &&
          (!more || this.next.releases || this.needsReleaseResolution())
            ? [
                this.guard('releases', reader, async () => {
                  await this.versions('releases', more, reader, cycle);
                  await this.resolveReleases(reader, cycle);
                }),
              ]
            : []),
          ...(actions ? [actions] : []),
        ]);
        if (reader !== this.reader) return {};
        if (!more) await this.refreshActiveRuns(reader, cycle);
        if (reader !== this.reader) return {};
        if (
          this.selected &&
          (!this.checked.has(this.selected) ||
            (!more &&
              [...this.runs.values()].some(
                (run) => run.head_sha === this.selected && activeRun(run),
              )))
        )
          await this.inspect(this.selected, !more, false, cycle);
        if (reader !== this.reader) return {};
        await this.ensureJobs(!more, cycle);
        return {
          error: Object.values(this.state.errors).join(' · ') || undefined,
          retryAt: reader.retryAt || undefined,
        };
      })
      .finally(() => {
        if (cycle && reader.controller.signal.aborted) cycle.cancelled = true;
        if (this.batch === task) {
          this.batch = null;
          this.publish();
        }
      });
    this.batch = task;
    this.publish();
    return task;
  };
}
