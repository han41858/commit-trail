import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DebugMetrics, debug, apiKind, type DebugSnapshot } from './debug';
import { github } from './api';
import { GitHubReader } from './GitHubReader';
import { RequestPool } from './RequestPool';
import { requestActivity } from './requestActivity';
import { History } from './history';
import { CommitInfoStore } from './CommitInfoStore';
import { captureChanges, changeCounts } from './debugChanges';
import type { Commit } from './model';
import { measuredLayout } from './measuredLayout';
const snapshot = (metrics: DebugMetrics = debug): DebugSnapshot =>
  JSON.parse(metrics.diagnostics());
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const response = (data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { headers });
const commit = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents: parents.map((sha) => ({ sha })),
  commit: {
    message: 'PRIVATE message',
    author: { name: 'PRIVATE author', date: '2026-10-30T01:00:00Z' },
    committer: null,
  },
  html_url: 'https://github.com/private/repository',
});

test('disabled instrumentation does not read the clock, log, schedule updates or retain samples', (t) => {
  let clocks = 0,
    logs = 0,
    updates = 0;
  const metrics = new DebugMetrics(
    () => {
      clocks++;
      return 0;
    },
    () => {
      logs++;
    },
  );
  const timers = t.mock.method(globalThis, 'setTimeout');
  const unsubscribe = metrics.subscribe(() => {
    updates++;
  });
  assert.equal(metrics.request('/repos/private/repository', true), undefined);
  assert.equal(metrics.beginCycle('initial'), undefined);
  assert.equal(metrics.startTime(), undefined);
  metrics.cache('/private');
  metrics.queuedCancelled();
  metrics.layout(undefined, []);
  metrics.render(undefined, [], { loaded: 1, visible: 1, drawn: 1, branches: 1, lanes: 1 });
  metrics.print();
  assert.equal(clocks + logs + updates + timers.mock.callCount(), 0);
  assert.equal(snapshot(metrics).api.requests, 0);
  unsubscribe();
});

test('HTTP, conditional 304, failures, cancellations and observed quota are distinct', () => {
  let now = 0;
  const logs: unknown[] = [];
  const metrics = new DebugMetrics(
    () => now,
    (_kind, value) => logs.push(value),
  );
  metrics.setMode('button');
  const cycle = metrics.beginCycle('manual')!;
  const first = metrics.request('/repos/PRIVATE/repository/tags', true, cycle)!;
  now = 12;
  first.response(
    new Response(null, {
      status: 304,
      headers: {
        'X-RateLimit-Limit': '5000',
        'X-RateLimit-Remaining': '4990',
        'X-RateLimit-Used': '10',
        'X-RateLimit-Reset': '1800000000',
        'X-RateLimit-Resource': 'core',
        Authorization: 'PRIVATE',
      },
    }),
  );
  first.finish('success');
  first.finish('failed');
  const failure = metrics.request(
    '/repos/PRIVATE/repository/actions/runs?private=query',
    false,
    cycle,
  )!;
  now = 20;
  failure.response(
    new Response('{}', {
      status: 500,
      headers: {
        'X-RateLimit-Resource': 'core',
        'X-RateLimit-Used': '13',
        'X-RateLimit-Reset': '1800000000',
        'X-RateLimit-Limit': '5000',
      },
    }),
  );
  failure.finish('failed');
  const cancel = metrics.request('/repos/PRIVATE/repository/commits', false, cycle)!;
  now = 22;
  cancel.finish('cancelled');
  metrics.cache('commits', cycle);
  metrics.cache('actions-jobs', cycle, 'shared');
  metrics.queuedCancelled(cycle);
  metrics.finish(cycle);
  const data = snapshot(metrics);
  assert.equal(data.api.requests, 3);
  assert.equal(data.api.conditional, 1);
  assert.equal(data.api.notModified, 1);
  assert.equal(data.api.failed, 1);
  assert.equal(data.api.cancelled, 1);
  assert.equal(data.api.queuedCancelled, 1);
  assert.equal(data.api.memoryHits, 1);
  assert.equal(data.api.shared, 1);
  assert.equal(data.rates[0].observedUsedDelta, 3);
  assert.equal(data.rates[0].remaining, null);
  assert.deepEqual(data.api.statuses, { '304': 1, '500': 1, network: 1 });
  assert.equal(data.cycles[0].durationMs, 22);
  assert.ok(!JSON.stringify([data, logs]).includes('PRIVATE'));
  metrics.setMode('off');
});

test('each category retains only its latest 20 measurements and reset ignores old in-flight probes', () => {
  let now = 0;
  const metrics = new DebugMetrics(
    () => ++now,
    () => {},
  );
  metrics.setMode('button');
  const commits: unknown[] = [];
  for (let i = 0; i < 25; i++) {
    const cycle = metrics.beginCycle(i % 2 ? 'manual' : 'auto')!;
    metrics.bindGraph(commits, cycle);
    const probe = metrics.request('/repos/a/b/commits', false, cycle)!;
    probe.response(response([]));
    probe.finish('success');
    metrics.layout(metrics.startTime(), commits);
    metrics.render(metrics.startTime(), commits, {
      loaded: 100,
      visible: 20,
      drawn: 22,
      branches: 3,
      lanes: 2,
    });
    metrics.finish(cycle);
  }
  const data = snapshot(metrics);
  assert.deepEqual(
    [data.requests.length, data.cycles.length, data.layouts.length, data.renders.length],
    [20, 20, 20, 20],
  );
  assert.equal(data.cycles[0].id, 'refresh-6');
  assert.equal(data.layoutCount, 25);
  assert.equal(data.renderCount, 25);
  assert.equal(data.cycles.at(-1)!.layouts, 1);
  assert.equal(data.cycles.at(-1)!.renders, 1);
  const old = metrics.request('/repos/a/b', false)!;
  metrics.reset();
  old.response(response({}));
  old.finish('success');
  assert.equal(snapshot(metrics).requests.length, 0);
  assert.equal(snapshot(metrics).api.requests, 0);
  metrics.setMode('off');
});

test('concurrent refreshes are attributed by signal; duplicate candidates exclude shared cached work', () => {
  const metrics = new DebugMetrics(
    () => 0,
    () => {},
  );
  metrics.setMode('button');
  const a = metrics.beginCycle('initial')!,
    b = metrics.beginCycle('manual')!,
    controller = new AbortController();
  metrics.bind(controller.signal, a);
  assert.equal(metrics.forSignal(controller.signal), a);
  const one = metrics.request('/repos/a/b/commits?sha=1', false, a)!,
    two = metrics.request('/repos/a/b/commits?sha=1', false, b)!;
  metrics.cache('commits', a, 'shared');
  two.finish('success');
  one.finish('success');
  metrics.finish(a);
  metrics.finish(b);
  const data = snapshot(metrics);
  assert.equal(data.api.requests, 2);
  assert.equal(data.api.duplicates, 1);
  assert.equal(data.cycles[0].requests, 1);
  assert.equal(data.cycles[1].requests, 1);
  assert.equal(data.cycles[0].shared, 1);
  assert.equal(metrics.forSignal(controller.signal), undefined);
  metrics.setMode('off');
});

test('background tabs suppress metric notifications, returning flushes current values', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let updates = 0;
  const metrics = new DebugMetrics(
    () => 0,
    () => {},
  );
  metrics.setMode('panel');
  const unsubscribe = metrics.subscribe(() => updates++);
  updates = 0;
  metrics.setHidden(true);
  metrics.request('/repos/a/b', false)!.finish('success');
  t.mock.timers.tick(1000);
  assert.equal(updates, 0);
  metrics.setHidden(false);
  t.mock.timers.tick(250);
  assert.equal(updates, 1);
  assert.equal(metrics.getSnapshot().api.requests, 1);
  unsubscribe();
  metrics.setMode('off');
});

test('common API client and immutable reader cache count actual fetches and preserve authorization', async () => {
  const old = fetch,
    log = console.debug;
  let calls = 0;
  const reader = new GitHubReader('PRIVATE_PAT');
  try {
    console.debug = () => {};
    debug.setMode('button');
    globalThis.fetch = async (_input, init) => {
      calls++;
      assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer PRIVATE_PAT');
      await flush();
      return response(
        { object: { type: 'commit', sha: 'PRIVATE_SHA' } },
        { ETag: '"private-etag"' },
      );
    };
    const cycle = debug.beginCycle('manual')!;
    await Promise.all([
      reader.get('/repos/private/repository/git/tags/PRIVATE_TAG', true, cycle),
      reader.get('/repos/private/repository/git/tags/PRIVATE_TAG', true, cycle),
    ]);
    await reader.get('/repos/private/repository/git/tags/PRIVATE_TAG', true, cycle);
    debug.finish(cycle);
    assert.equal(calls, 1);
    const data = snapshot();
    assert.equal(data.api.requests, 1);
    assert.equal(data.api.memoryHits, 1);
    assert.equal(data.api.shared, 1);
    assert.equal(data.cycles[0].requests, 1);
    assert.ok(!debug.diagnostics().includes('PRIVATE'));
    assert.ok(!debug.diagnostics().includes('private/repository'));
  } finally {
    debug.setMode('off');
    reader.cancel();
    globalThis.fetch = old;
    console.debug = log;
  }
});

test('pool queues are separate from active HTTP; cancellation and failure return gauges to zero', async () => {
  const old = fetch,
    log = console.debug;
  const controllers = Array.from({ length: 4 }, () => new AbortController()),
    pool = new RequestPool(2);
  let release!: (value: Response) => void;
  try {
    console.debug = () => {};
    debug.setMode('button');
    globalThis.fetch = async (_input, init) =>
      new Promise<Response>((resolve, reject) => {
        release = resolve;
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      });
    const tasks = controllers.map((c) =>
      pool.run(c.signal, () => github('/repos/a/b', '', c.signal)),
    );
    const settled = Promise.allSettled(tasks);
    await flush();
    assert.equal(requestActivity.getSnapshot(), 2);
    assert.equal(requestActivity.getQueuedSnapshot(), 2);
    assert.equal(snapshot().api.requests, 2);
    controllers[2].abort();
    controllers[3].abort();
    controllers[0].abort();
    release(new Response('{}', { status: 500 }));
    await settled;
    await flush();
    assert.equal(requestActivity.getSnapshot(), 0);
    assert.equal(requestActivity.getQueuedSnapshot(), 0);
    const data = snapshot();
    assert.equal(data.api.queuedCancelled, 2);
    assert.equal(data.api.cancelled, 1);
    assert.equal(data.api.failed, 1);
  } finally {
    controllers.forEach((c) => c.abort());
    debug.setMode('off');
    globalThis.fetch = old;
    console.debug = log;
  }
});

test('initial, unchanged 304 and changed refreshes measure existing stores without extra requests', async () => {
  const old = fetch,
    log = console.debug,
    history = new History(),
    info = new CommitInfoStore();
  let phase = 0,
    calls = 0;
  const run = () => ({
    id: 1,
    workflow_id: 1,
    name: 'PRIVATE workflow',
    head_sha: 'a',
    status: phase >= 2 ? 'completed' : 'in_progress',
    conclusion: phase >= 2 ? 'success' : null,
    run_attempt: 1,
    updated_at: phase >= 2 ? '2026-10-30T02:00:00Z' : '2026-10-30T01:00:00Z',
    html_url: 'PRIVATE_URL',
  });
  try {
    console.debug = () => {};
    debug.setMode('button');
    globalThis.fetch = async (input, init) => {
      calls++;
      const url = new URL(String(input)),
        path = url.pathname,
        etag = '"' + (phase >= 2 ? 'changed' : 'first') + '"';
      if ((init?.headers as Record<string, string>)?.['If-None-Match'] === etag)
        return new Response(null, { status: 304 });
      const headers = { ETag: etag };
      if (path.endsWith('/branches'))
        return response(
          phase >= 2
            ? [
                { name: 'main', commit: { sha: 'b' } },
                { name: 'new', commit: { sha: 'b' } },
              ]
            : [
                { name: 'main', commit: { sha: 'a' } },
                { name: 'deleted', commit: { sha: 'a' } },
              ],
          headers,
        );
      if (path.endsWith('/commits'))
        return response(phase >= 2 ? [commit('b', 'a'), commit('a')] : [commit('a')], headers);
      if (path.endsWith('/tags'))
        return response([{ name: phase >= 2 ? 'new' : 'old', commit: { sha: 'a' } }], headers);
      if (path.endsWith('/releases'))
        return response(
          [
            {
              id: 1,
              tag_name: phase >= 2 ? 'new' : 'old',
              name: phase >= 2 ? 'updated' : 'first',
              created_at: '2026-10-30',
              published_at: null,
              draft: false,
              prerelease: false,
              html_url: 'PRIVATE_RELEASE',
            },
          ],
          headers,
        );
      if (path.endsWith('/actions/runs')) return response({ workflow_runs: [run()] }, headers);
      if (path.endsWith('/jobs'))
        return response(
          {
            total_count: 1,
            jobs: [
              {
                id: 1,
                run_id: 1,
                status: phase >= 2 ? 'completed' : 'in_progress',
                conclusion: phase >= 2 ? 'success' : null,
              },
            ],
          },
          headers,
        );
      if (path.endsWith('/activity')) return response([], headers);
      return response({ default_branch: 'main', stargazers_count: 0 }, headers);
    };
    const initial = debug.beginCycle('initial')!;
    await history.open('private/repository', '', initial);
    await info.open('private/repository', '', initial);
    debug.finish(initial);
    const initialCalls = calls;
    assert.equal(snapshot().cycles[0].requests, initialCalls);
    assert.ok(initialCalls > 0);
    // Prime History's existing revalidation reader, then all five calls return 304.
    await Promise.all([history.refresh(), info.refresh()]);
    phase = 1;
    let before = captureChanges(history.getSnapshot(), info.getSnapshot());
    const unchanged = debug.beginCycle('auto', () =>
      changeCounts(before, captureChanges(history.getSnapshot(), info.getSnapshot())),
    )!;
    const array = history.getSnapshot().commits,
      start = calls;
    await Promise.all([history.refresh(unchanged), info.refresh(false, undefined, unchanged)]);
    debug.finish(unchanged);
    let sample = snapshot().cycles.at(-1)!;
    assert.equal(sample.requests, calls - start);
    assert.equal(sample.requests, 5);
    assert.equal(sample.notModified, 5);
    assert.equal(
      sample.commitsAdded +
        sample.branchesChanged +
        sample.tagsChanged +
        sample.releasesChanged +
        sample.actionsChanged,
      0,
    );
    assert.equal(history.getSnapshot().commits, array);
    assert.equal(sample.layouts, 0);
    phase = 2;
    before = captureChanges(history.getSnapshot(), info.getSnapshot());
    const changed = debug.beginCycle('manual', () =>
      changeCounts(before, captureChanges(history.getSnapshot(), info.getSnapshot())),
    )!;
    await Promise.all([history.refresh(changed), info.refresh(false, undefined, changed)]);
    measuredLayout(history.getSnapshot().commits);
    debug.finish(changed);
    sample = snapshot().cycles.at(-1)!;
    assert.equal(sample.commitsAdded, 1);
    assert.equal(sample.branchesAdded, 1);
    assert.equal(sample.branchesRemoved, 1);
    assert.equal(sample.branchesChanged, 1);
    assert.equal(sample.tagsChanged, 2);
    assert.equal(sample.releasesChanged, 1);
    assert.equal(sample.actionsChanged, 1);
    assert.equal(sample.layouts, 1);
    assert.ok(sample.types.commits);
    assert.ok(!debug.diagnostics().includes('PRIVATE'));
    assert.equal(requestActivity.getSnapshot(), 0);
    assert.equal(requestActivity.getQueuedSnapshot(), 0);
  } finally {
    history.cancel();
    info.cancel();
    debug.setMode('off');
    globalThis.fetch = old;
    console.debug = log;
  }
});

test('API categories strip route details and recognize nested Actions jobs', () => {
  assert.equal(
    apiKind('/repos/private/name/actions/runs/1/attempts/2/jobs?page=1'),
    'actions-jobs',
  );
  assert.equal(apiKind('/repos/private/name/commits/sha'), 'commits');
  assert.equal(apiKind('/user'), 'identity');
  assert.equal(apiKind('/repos/private/name/git/ref/tags/private'), 'tag-objects');
});

test('completion logs once after React settling and distinguishes late Canvas frames', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const logs: { kind: string; value: unknown }[] = [];
  const metrics = new DebugMetrics(
    () => now,
    (kind, value) => logs.push({ kind, value }),
  );
  metrics.setMode('button');
  const cycle = metrics.beginCycle('auto')!,
    commits: unknown[] = [];
  metrics.bindGraph(commits, cycle);
  now = 20;
  metrics.finish(cycle);
  metrics.finish(cycle);
  now = 50;
  metrics.layout(45, commits);
  t.mock.timers.tick(100);
  const summaries = logs.filter((item) => item.kind === 'refresh');
  assert.equal(summaries.length, 1);
  assert.equal((summaries[0].value as { durationMs: number }).durationMs, 20);
  assert.equal((summaries[0].value as { layouts: number }).layouts, 1);
  now = 200;
  metrics.render(190, commits, { loaded: 20, visible: 10, drawn: 12, branches: 2, lanes: 2 });
  assert.equal(snapshot(metrics).renders[0].cycleId, null);
  assert.equal(snapshot(metrics).cycles[0].renders, 0);
  metrics.setMode('off');
});

test('quota deltas tolerate out-of-order responses and reset separately from HTTP counts', () => {
  const metrics = new DebugMetrics(
    () => 0,
    () => {},
  );
  metrics.setMode('button');
  for (const [used, reset] of [
    [12, 100],
    [10, 100],
    [14, 100],
    [1, 200],
  ]) {
    const probe = metrics.request('/repos/a/b', false)!;
    probe.response(
      response(
        {},
        {
          'X-RateLimit-Used': String(used),
          'X-RateLimit-Reset': String(reset),
          'X-RateLimit-Resource': 'core',
        },
      ),
    );
    probe.finish('success');
    if (used === 14) assert.equal(snapshot(metrics).rates[0].observedUsedDelta, 4);
  }
  const data = snapshot(metrics);
  assert.equal(data.api.requests, 4);
  assert.equal(data.rates[0].observedUsedDelta, 0);
  assert.equal(data.rates[0].remaining, null);
  assert.equal(data.rates[0].resetAt, 200000);
  metrics.setMode('off');
});

test('a slot cancelled before its task microtask starts never counts as HTTP work', async () => {
  const pool = new RequestPool(1),
    controller = new AbortController(),
    log = console.debug;
  let invoked = false;
  try {
    console.debug = () => {};
    debug.setMode('button');
    const task = pool.run(controller.signal, async () => {
      invoked = true;
    });
    controller.abort();
    await assert.rejects(task);
    await flush();
    assert.equal(invoked, false);
    assert.equal(snapshot().api.requests, 0);
    assert.equal(snapshot().api.queuedCancelled, 1);
    assert.equal(requestActivity.getQueuedSnapshot(), 0);
  } finally {
    debug.setMode('off');
    console.debug = log;
  }
});

test('a traversal cancelled before initial loading finishes closes that measurement without capturing the replacement', async () => {
  const original = fetch,
    log = console.debug,
    history = new History();
  let waiting!: (value?: unknown) => void;
  const started = new Promise((resolve) => {
    waiting = resolve;
  });
  try {
    console.debug = () => {};
    debug.setMode('button');
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/branches'))
        return response([
          { name: 'main', commit: { sha: 'a' } },
          { name: 'dev', commit: { sha: 'b' } },
        ]);
      if (url.pathname.endsWith('/activity')) return response([]);
      if (url.pathname.endsWith('/commits')) {
        if (url.searchParams.get('sha') === 'main') {
          waiting();
          return new Promise<Response>((_resolve, reject) =>
            init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {
              once: true,
            }),
          );
        }
        return response([commit('b')]);
      }
      return response({ default_branch: 'main', stargazers_count: 0 });
    };
    const cycle = debug.beginCycle('initial')!,
      initial = history.open('a/b', '', cycle);
    await started;
    const replacement = history.chooseBase('dev');
    await initial;
    debug.finish(cycle);
    await replacement;
    const sample = snapshot().cycles[0];
    assert.equal(sample.outcome, 'cancelled');
    assert.equal(sample.cancelled, 1);
    assert.equal(sample.types.commits, 1);
    assert.equal(history.getSnapshot().base, 'dev');
    assert.equal(history.getSnapshot().commits[0].sha, 'b');
  } finally {
    history.cancel();
    debug.setMode('off');
    globalThis.fetch = original;
    console.debug = log;
  }
});
