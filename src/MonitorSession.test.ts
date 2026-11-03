import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MonitorSession } from './MonitorSession';
import { History } from './history';
import { CommitInfoStore } from './CommitInfoStore';
import { RefreshLoop, type RefreshClock } from './RefreshLoop';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (check()) return;
    await tick();
  }
  assert.ok(check(), 'operation did not settle');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function completionClock(start = 1000) {
  let now = start,
    id = 0;
  const timers = new Map<number, () => void>();
  const clock: RefreshClock = {
    now: () => now,
    set: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clear: (key) => {
      timers.delete(key as number);
    },
  };
  return {
    clock,
    timers,
    set: (value: number) => {
      now = value;
    },
  };
}
const response = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 304 ? null : JSON.stringify(data), { status, headers });
async function using(
  check: (context: {
    group: MonitorSession;
    history: History;
    info: CommitInfoStore;
    paths: string[];
    visits: string[];
    holds: Map<string, ReturnType<typeof deferred<Response>>>;
    failures: Map<string, number>;
    aborted: string[];
    conditional: string[];
  }) => Promise<void>,
) {
  const original = globalThis.fetch,
    paths: string[] = [],
    visits: string[] = [],
    aborted: string[] = [],
    conditional: string[] = [],
    holds = new Map<string, ReturnType<typeof deferred<Response>>>(),
    failures = new Map<string, number>();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname;
    paths.push(path);
    init?.signal?.addEventListener('abort', () => aborted.push(path), { once: true });
    const hold = holds.get(path);
    if (hold) return hold.promise;
    const failure = failures.get(path);
    if (failure) return response({}, failure, failure === 429 ? { 'Retry-After': '60' } : {});
    if ((init?.headers as Record<string, string>)?.['If-None-Match']) {
      conditional.push(path);
      return response(null, 304);
    }
    if (path.endsWith('/branches'))
      return response([{ name: 'main', commit: { sha: 'head' } }], 200, { ETag: '"stable"' });
    if (path.endsWith('/commits'))
      return response([
        {
          sha: 'head',
          parents: [],
          commit: {
            message: 'fixture',
            author: { name: 'Test', date: '2026-11-01T00:00:00Z' },
            committer: null,
          },
          html_url: '',
        },
      ]);
    if (path.endsWith('/actions/runs'))
      return response({ workflow_runs: [] }, 200, { ETag: '"stable"' });
    if (['/tags', '/releases', '/activity'].some((suffix) => path.endsWith(suffix)))
      return response([], 200, { ETag: '"stable"' });
    return response({ default_branch: 'main', private: false }, 200, { ETag: '"stable"' });
  };
  const metadata = (repo: string, _private: boolean, visit: boolean) => {
      if (visit) visits.push(repo);
    },
    history = new History(metadata),
    info = new CommitInfoStore(),
    group = new MonitorSession(history, info, metadata);
  try {
    await check({ group, history, info, paths, visits, holds, failures, aborted, conditional });
  } finally {
    group.stop();
    history.cancel();
    info.cancel();
    for (const hold of holds.values())
      hold.resolve(response({ default_branch: 'main', private: false }));
    await tick();
    globalThis.fetch = original;
  }
}
test('one through 32 independent models reuse the primary and cap only distinct valid names', async () => {
  for (const count of [1, 3, 4, 8, 16, 32])
    await using(async ({ group, history, info, paths, visits }) => {
      await history.open('a/one');
      await info.open('a/one', '');
      const before = paths.filter((path) => path === '/repos/a/one').length;
      const names = [
        'a/one',
        ...Array.from({ length: count - 1 }, (_, index) => `owner/repo-${index}`),
      ];
      group.start(
        [
          'invalid',
          ...names.flatMap((name) => [name, name.toUpperCase()]),
          ...(count === 32 ? ['overflow/repo'] : []),
        ],
        '',
      );
      await until(() => group.getSnapshot().running.size === 0);
      assert.deepEqual(
        group.getSnapshot().entries.map((entry) => entry.repository),
        names,
      );
      assert.equal(group.getSnapshot().entries[0].history, history);
      assert.equal(paths.filter((path) => path === '/repos/a/one').length, before);
      assert.deepEqual(visits, names);
      assert.equal(new Set(group.getSnapshot().entries.map((entry) => entry.history)).size, count);
      assert.equal(new Set(group.getSnapshot().entries.map((entry) => entry.info)).size, count);
    });
});
test('metadata starts as soon as repository metadata succeeds, before slow branch or commit loading completes', async () => {
  await using(async ({ group, holds, paths }) => {
    const branches = deferred<Response>();
    holds.set('/repos/b/two/branches', branches);
    group.start(['b/two'], '');
    await until(() => paths.includes('/repos/b/two/actions/runs'));
    const entry = group.getSnapshot().entries[0];
    assert.equal(entry.info.getSnapshot().repo, 'b/two');
    assert.equal(entry.history.getSnapshot().commits.length, 0);
    assert.equal(group.getSnapshot().running.size, 1);
    branches.resolve(response([{ name: 'main', commit: { sha: 'head' } }]));
    await until(() => !group.getSnapshot().running.size);
  });
});
test('a URL can adopt the loading primary model and start the remaining repositories without duplicate metadata', async () => {
  await using(async ({ group, history, holds, paths }) => {
    const first = deferred<Response>();
    holds.set('/repos/a/one', first);
    const opening = history.open('a/one');
    await until(() => paths.includes('/repos/a/one'));
    group.start(['a/one', 'b/two'], '');
    assert.equal(group.getSnapshot().entries[0].primary, true);
    assert.equal(group.getSnapshot().entries[0].history, history);
    await until(() => group.getSnapshot().entries[1].history.getSnapshot().commits.length === 1);
    assert.equal(paths.filter((path) => path === '/repos/a/one').length, 1);
    first.resolve(response({ default_branch: 'main', private: false }));
    await opening;
  });
});
test('an adopted primary URL failure retries through its original history without taking over metadata ownership', async () => {
  await using(async ({ group, history, holds, paths }) => {
    const first = deferred<Response>();
    holds.set('/repos/a/one', first);
    const opening = history.open('a/one');
    await until(() => paths.includes('/repos/a/one'));
    group.start(['a/one'], '');
    first.resolve(response({}, 404));
    await opening;
    assert.ok(history.getSnapshot().error);
    holds.delete('/repos/a/one');
    await group.refreshAll('auto');
    await until(() => !group.getSnapshot().running.size);
    assert.ok(history.getSnapshot().meta);
    assert.equal(paths.filter((path) => path === '/repos/a/one').length, 2);
    assert.equal(paths.filter((path) => path === '/repos/a/one/tags').length, 0);
  });
});
test('a slow repository does not delay dispatch completion or the next refresh of faster repositories', async () => {
  await using(async ({ group, paths, holds }) => {
    group.start(['a/one', 'b/two'], '');
    await until(() => !group.getSnapshot().running.size);
    const slow = deferred<Response>();
    holds.set('/repos/b/two', slow);
    await group.refreshAll('auto');
    await until(
      () =>
        paths.filter((path) => path === '/repos/a/one').length === 2 &&
        group.getSnapshot().running.size === 1,
    );
    await group.refreshAll('auto');
    await until(
      () =>
        paths.filter((path) => path === '/repos/a/one').length === 3 &&
        group.getSnapshot().running.size === 1,
    );
    assert.equal(paths.filter((path) => path === '/repos/b/two').length, 2);
    slow.resolve(response({ default_branch: 'main', private: false }));
    await until(() => !group.getSnapshot().running.size);
  });
});
test('32 repositories share one RefreshLoop timer and skip an already running repository', async () => {
  await using(async ({ group, paths, holds }) => {
    group.start(
      ['a/one', 'b/two', ...Array.from({ length: 30 }, (_, index) => `owner/repo-${index}`)],
      '',
    );
    await until(() => !group.getSnapshot().running.size);
    holds.set('/repos/b/two', deferred<Response>());
    let now = 1000,
      id = 0;
    const timers = new Map<number, () => void>();
    const clock: RefreshClock = {
      now: () => now,
      set: (fn) => {
        timers.set(++id, fn);
        return id;
      },
      clear: (key) => {
        timers.delete(key as number);
      },
    };
    const loop = new RefreshLoop(group.refreshAll, () => true, clock);
    loop.configure('monitor', true, 60000);
    loop.loaded();
    for (let n = 0; n < 2; n++) {
      assert.equal(timers.size, 1);
      const callback = [...timers.values()][0];
      timers.clear();
      now += 60000;
      callback();
      await until(
        () =>
          paths.filter((path) => path === '/repos/a/one').length === n + 2 &&
          group.getSnapshot().running.size === 1,
      );
    }
    assert.equal(paths.filter((path) => path === '/repos/b/two').length, 2);
    loop.stop();
    assert.equal(timers.size, 0);
  });
});
test('failures stay isolated and failed metadata is retried on the common schedule', async () => {
  await using(async ({ group, failures, paths }) => {
    failures.set('/repos/b/two', 404);
    group.start(['a/one', 'b/two'], '');
    await until(() => !group.getSnapshot().running.size);
    assert.equal(group.getSnapshot().entries[0].history.getSnapshot().commits.length, 1);
    assert.ok(group.getSnapshot().entries[1].history.getSnapshot().error);
    failures.clear();
    await group.refreshAll('auto');
    await until(() => !group.getSnapshot().running.size);
    assert.equal(group.getSnapshot().entries[1].history.getSnapshot().commits.length, 1);
    assert.equal(paths.filter((path) => path === '/repos/b/two').length, 2);
  });
});
test('the initial timer can settle after a late history request fails in either repository', async () => {
  for (const repository of ['a/one', 'b/two']) {
    await using(async ({ group, history, info }) => {
      const fetch = globalThis.fetch;
      const parent = deferred<Response>();
      let requested = false;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === `/repos/${repository}/commits`) {
          if (url.searchParams.get('sha') === 'missing') {
            requested = true;
            return parent.promise;
          }
          return response([
            {
              sha: 'head',
              parents: [{ sha: 'missing' }],
              commit: { message: 'head', author: null, committer: null },
              html_url: '',
            },
          ]);
        }
        return fetch(input, init);
      };
      await history.open('a/one');
      await info.open('a/one', '');
      group.start(['a/one', 'b/two'], '');
      await until(() => !group.getSnapshot().running.size);
      const entry = group.getSnapshot().entries.find((item) => item.repository === repository)!;
      const { clock, timers } = completionClock();
      const loop = new RefreshLoop(
        () => group.refreshAll('manual'),
        () => true,
        clock,
      );
      loop.configure('monitor', true, 300000, true);
      const unsubscribe = group.subscribe(() => {
        if (group.getSnapshot().settled) loop.loaded();
      });
      const work = entry.history.loadMore(['missing']);
      await until(() => requested);
      assert.equal(loop.getSnapshot().waitingForInitialLoad, true);
      assert.equal(timers.size, 0);
      parent.resolve(response({}, 404));
      await work;
      assert.ok(entry.history.getSnapshot().error);
      assert.deepEqual(entry.history.getSnapshot().pendingSources, []);
      assert.equal(entry.history.getSnapshot().busy, false);
      assert.equal(loop.getSnapshot().waitingForInitialLoad, false);
      assert.equal(loop.getSnapshot().nextAt, 301000);
      assert.equal(timers.size, 1);
      unsubscribe();
      loop.stop();
    });
  }
});
test('the initial timer observes late metadata job completion after a 404', async () => {
  await using(async ({ group, history, info }) => {
    const fetch = globalThis.fetch;
    const jobs = deferred<Response>();
    let requested = false;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/repos/b/two/actions/runs') {
        return response({
          workflow_runs: [
            {
              id: 1,
              workflow_id: 1,
              name: 'CI',
              head_sha: 'head',
              status: 'in_progress',
              conclusion: null,
              run_attempt: 1,
              updated_at: '2026-11-03T00:00:00Z',
              html_url: 'https://github.com/b/two/actions/runs/1',
            },
          ],
        });
      }
      if (url.pathname.endsWith('/attempts/1/jobs')) {
        requested = true;
        return jobs.promise;
      }
      return fetch(input, init);
    };
    await history.open('a/one');
    await info.open('a/one', '');
    group.start(['a/one', 'b/two'], '');
    await until(() => !group.getSnapshot().running.size);
    const entry = group.getSnapshot().entries[1];
    const { clock } = completionClock();
    const loop = new RefreshLoop(
      () => group.refreshAll('manual'),
      () => true,
      clock,
    );
    loop.configure('monitor', true, 300000, true);
    const unsubscribe = group.subscribe(() => {
      if (group.getSnapshot().settled) loop.loaded();
    });
    entry.info.watch(['head']);
    await until(() => requested);
    assert.equal(loop.getSnapshot().waitingForInitialLoad, true);
    jobs.resolve(response({}, 404));
    await until(() => !entry.info.getSnapshot().busy);
    assert.ok(Object.keys(entry.info.getSnapshot().errors).length);
    assert.equal(loop.getSnapshot().waitingForInitialLoad, false);
    unsubscribe();
    loop.stop();
  });
});
test('manual refresh retries failed parent history in the primary repository', async () => {
  await using(async ({ group, history, info }) => {
    const fetch = globalThis.fetch;
    let parentRequests = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/repos/a/one/commits') {
        const parent = url.searchParams.get('sha') === 'missing';
        if (parent && ++parentRequests === 1) return response({}, 404);
        return response([
          {
            sha: parent ? 'missing' : 'head',
            parents: parent ? [] : [{ sha: 'missing' }],
            commit: { message: 'fixture', author: null, committer: null },
            html_url: '',
          },
        ]);
      }
      return fetch(input, init);
    };
    await history.open('a/one');
    await info.open('a/one', '');
    group.start(['a/one'], '');
    await history.loadMore(['missing']);
    assert.ok(history.getSnapshot().error);
    const result = await group.refreshAll('manual');
    await result.completion;
    assert.equal(history.getSnapshot().error, '');
    assert.equal(history.getSnapshot().commits.length, 2);
    assert.equal(parentRequests, 2);
  });
});
test('one repository rate limit pauses all 32 repositories until the shared deadline', async () => {
  await using(async ({ group, failures, paths }) => {
    failures.set('/repos/b/two', 429);
    group.start(
      ['a/one', 'b/two', ...Array.from({ length: 30 }, (_, index) => `owner/repo-${index}`)],
      '',
    );
    await until(() => !group.getSnapshot().running.size);
    assert.equal(group.canRequest(), false);
    const before = paths.length,
      result = await group.refreshAll('auto');
    assert.ok(result.retryAt! > Date.now());
    assert.equal(paths.length, before);
    const now = Date.now;
    try {
      const next = result.retryAt! + 1;
      Date.now = () => next;
      failures.clear();
      await group.refreshAll('auto');
      await until(() => !group.getSnapshot().running.size);
      assert.equal(group.canRequest(), true);
      assert.ok(paths.length > before);
    } finally {
      Date.now = now;
    }
  });
});
test('a rate limit is shared immediately even if the same repository metadata refresh is still slow', async () => {
  await using(async ({ group, history, info, holds, failures }) => {
    await history.open('a/one');
    await info.open('a/one', '');
    group.start(['a/one'], '');
    holds.set('/repos/a/one/tags', deferred<Response>());
    failures.set('/repos/a/one', 429);
    await group.refreshAll('auto');
    await until(() => !group.canRequest());
    assert.equal(group.getSnapshot().running.size, 1);
  });
});
test('conditional caches remain repository-local and unchanged refreshes keep commit array identity', async () => {
  await using(async ({ group, conditional }) => {
    group.start(['a/one', 'b/two'], '');
    await until(() => !group.getSnapshot().running.size);
    const commits = group.getSnapshot().entries.map((entry) => entry.history.getSnapshot().commits);
    for (let i = 0; i < 2; i++) {
      await group.refreshAll('auto');
      await until(() => !group.getSnapshot().running.size);
    }
    group
      .getSnapshot()
      .entries.forEach((entry, index) =>
        assert.equal(entry.history.getSnapshot().commits, commits[index]),
      );
    assert.ok(conditional.includes('/repos/a/one'));
    assert.ok(conditional.includes('/repos/b/two'));
  });
});
test('exit cancels all 32 monitor-owned requests and ignores their late metadata', async () => {
  await using(async ({ group, holds, paths, visits, aborted }) => {
    const names = Array.from({ length: 32 }, (_, index) => `owner/repo-${index}`);
    const slow = names.map(() => deferred<Response>());
    names.forEach((name, index) => holds.set(`/repos/${name}`, slow[index]));
    group.start(names, '');
    await until(() => names.every((name) => paths.includes(`/repos/${name}`)));
    group.stop();
    const before = paths.length;
    slow.forEach((request) =>
      request.resolve(response({ default_branch: 'main', private: false })),
    );
    await tick();
    await tick();
    assert.equal(group.getSnapshot().active, false);
    assert.equal(group.getSnapshot().running.size, 0);
    assert.deepEqual(visits, []);
    assert.equal(paths.length, before);
    assert.ok(names.every((name) => aborted.includes(`/repos/${name}`)));
  });
});
test('32 initial loads complete independently, including a failed repository and a late final response', async () => {
  await using(async ({ group, holds, failures, paths }) => {
    const names = Array.from({ length: 32 }, (_, index) => `owner/repo-${index}`);
    const slow = deferred<Response>();
    holds.set(`/repos/${names[31]}`, slow);
    failures.set(`/repos/${names[12]}`, 404);
    group.start(names, '');
    await until(() => group.getSnapshot().running.size === 1);
    const entries = group.getSnapshot().entries;
    assert.equal(entries.length, 32);
    assert.ok(entries[12].history.getSnapshot().error);
    assert.ok(
      entries
        .filter((_, index) => index !== 12 && index !== 31)
        .every((entry) => entry.history.getSnapshot().commits.length === 1),
    );
    assert.equal(group.getSnapshot().settled, false);
    holds.delete(`/repos/${names[31]}`);
    slow.resolve(response({ default_branch: 'main', private: false }));
    await until(() => !group.getSnapshot().running.size);
    assert.equal(group.getSnapshot().settled, true);
    failures.clear();
    await group.refreshAll('auto');
    await until(() => !group.getSnapshot().running.size);
    assert.ok(entries.every((entry) => entry.history.getSnapshot().commits.length === 1));
    assert.equal(paths.filter((path) => path === `/repos/${names[12]}`).length, 2);
  });
});
test('exiting preserves the primary model and changing PAT releases the old shared backoff', async () => {
  await using(async ({ group, history, info, failures }) => {
    await history.open('a/one');
    await info.open('a/one', '');
    const snapshot = history.getSnapshot();
    failures.set('/repos/b/two', 429);
    group.start(['a/one', 'b/two'], '');
    await until(() => !group.getSnapshot().running.size);
    group.stop();
    assert.equal(history.getSnapshot(), snapshot);
    assert.equal(group.canRequest(), false);
    group.authenticationChanged('old', 'new');
    assert.equal(group.canRequest(), true);
  });
});
test('a late rate error from a cancelled metadata refresh cannot throttle a new authentication context', async () => {
  await using(async ({ group, history, info, holds, paths }) => {
    await history.open('a/one');
    await info.open('a/one', '');
    group.start(['a/one', 'b/two'], '');
    await until(() => !group.getSnapshot().running.size);
    const slow = deferred<Response>();
    holds.set('/repos/b/two/tags', slow);
    await group.refreshAll('auto');
    await until(() => paths.filter((path) => path === '/repos/b/two/tags').length === 2);
    group.authenticationChanged('old', 'new');
    slow.resolve(response({}, 429, { 'Retry-After': '60' }));
    await tick();
    await tick();
    assert.equal(group.canRequest(), true);
    assert.equal(group.getSnapshot().retryAt, 0);
  });
});
for (const statuses of [
  [200, 200],
  [200, 500],
  [500, 500],
])
  test(`split completion waits for the last started repository with results ${statuses.join('/')}`, async () => {
    await using(async ({ group, holds }) => {
      group.start(['a/one', 'b/two'], '');
      await until(() => !group.getSnapshot().running.size);
      const first = deferred<Response>(),
        last = deferred<Response>();
      holds.set('/repos/a/one', first);
      holds.set('/repos/b/two', last);
      const time = completionClock(),
        loop = new RefreshLoop(group.refreshAll, () => true, time.clock);
      loop.configure('monitor', true, 60000);
      loop.loaded();
      await loop.refresh();
      await tick();
      assert.equal(loop.getSnapshot().lastCompletedAt, 1000);
      time.set(2000);
      first.resolve(response({ default_branch: 'main', private: false }, statuses[0]));
      await until(() => group.getSnapshot().running.size === 1);
      loop.loaded();
      assert.equal(loop.getSnapshot().lastCompletedAt, 1000);
      time.set(5000);
      last.resolve(response({ default_branch: 'main', private: false }, statuses[1]));
      await until(() => loop.getSnapshot().lastCompletedAt === 5000);
      assert.equal(group.getSnapshot().running.size, 0);
      assert.equal(loop.getSnapshot().nextAt, 61000);
      assert.equal(time.timers.size, 1);
      loop.stop();
    });
  });
test('a later cycle waits only for its new work while a previous slow cycle can finish later', async () => {
  await using(async ({ group, holds, paths }) => {
    group.start(['a/one', 'b/two'], '');
    await until(() => !group.getSnapshot().running.size);
    const slow = deferred<Response>();
    holds.set('/repos/b/two', slow);
    const time = completionClock(),
      loop = new RefreshLoop(group.refreshAll, () => true, time.clock);
    loop.configure('monitor', true, 60000);
    loop.loaded();
    await loop.refresh();
    await until(() => group.getSnapshot().running.size === 1);
    assert.equal(loop.getSnapshot().lastCompletedAt, 1000);
    time.set(3000);
    await loop.refresh();
    await until(() => loop.getSnapshot().lastCompletedAt === 3000);
    assert.equal(group.getSnapshot().running.size, 1);
    assert.equal(paths.filter((path) => path === '/repos/b/two').length, 2);
    time.set(9000);
    slow.resolve(response({ default_branch: 'main', private: false }));
    await until(() => loop.getSnapshot().lastCompletedAt === 9000);
    assert.equal(loop.getSnapshot().nextAt, 63000);
    assert.equal(time.timers.size, 1);
    loop.stop();
  });
});
test('a dispatch skipping every busy repository does not invent a completion', async () => {
  await using(async ({ group, holds, paths }) => {
    group.start(['a/one'], '');
    await until(() => !group.getSnapshot().running.size);
    const slow = deferred<Response>();
    holds.set('/repos/a/one', slow);
    const time = completionClock(),
      loop = new RefreshLoop(group.refreshAll, () => true, time.clock);
    loop.configure('monitor', false, 60000);
    loop.loaded();
    await loop.refresh();
    await tick();
    const before = paths.length;
    time.set(4000);
    await loop.refresh();
    assert.equal(paths.length, before);
    assert.equal(loop.getSnapshot().lastCompletedAt, 1000);
    time.set(8000);
    slow.resolve(response({ default_branch: 'main', private: false }));
    await until(() => loop.getSnapshot().lastCompletedAt === 8000);
    loop.stop();
  });
});
test('a primary failure still waits for slow metadata before the loop records completion', async () => {
  await using(async ({ group, history, info, holds, failures }) => {
    await history.open('a/one');
    await info.open('a/one', '');
    const slow = deferred<Response>();
    holds.set('/repos/a/one/tags', slow);
    failures.set('/repos/a/one', 500);
    const time = completionClock(),
      loop = new RefreshLoop(group.refreshPrimary, () => true, time.clock);
    loop.configure('single', false, 60000);
    loop.loaded();
    const task = loop.refresh();
    await until(() => !!history.getSnapshot().refreshError);
    time.set(3000);
    assert.equal(loop.getSnapshot().running, true);
    assert.equal(loop.getSnapshot().lastCompletedAt, 1000);
    slow.resolve(response([], 500));
    await task;
    assert.equal(loop.getSnapshot().lastCompletedAt, 3000);
    assert.ok(loop.getSnapshot().error);
    loop.stop();
  });
});
test('an unexpected rejection waits for its sibling request to settle', async () => {
  await using(async ({ group, history, info }) => {
    const slow = deferred<{}>();
    history.refresh = async () => {
      throw new Error('Network failed');
    };
    info.refresh = () => slow.promise;
    const time = completionClock(),
      loop = new RefreshLoop(group.refreshPrimary, () => true, time.clock);
    loop.configure('single', false, 60000);
    const task = loop.refresh();
    await tick();
    assert.equal(loop.getSnapshot().lastCompletedAt, null);
    assert.equal(loop.getSnapshot().running, true);
    time.set(7000);
    slow.resolve({});
    await task;
    assert.equal(loop.getSnapshot().lastCompletedAt, 7000);
    assert.equal(loop.getSnapshot().error, 'Network failed');
    loop.stop();
  });
});
test('rate-limit backoff is immediate but completion waits for the other started work', async () => {
  await using(async ({ group, history, info, holds, failures, paths }) => {
    await history.open('a/one');
    await info.open('a/one', '');
    group.start(['a/one'], '');
    const slow = deferred<Response>();
    holds.set('/repos/a/one/tags', slow);
    failures.set('/repos/a/one', 429);
    const start = Date.now(),
      time = completionClock(start),
      loop = new RefreshLoop(group.refreshAll, () => true, time.clock);
    loop.configure('monitor', true, 60000);
    loop.loaded();
    await loop.refresh();
    await until(() => !group.canRequest());
    assert.equal(loop.getSnapshot().lastCompletedAt, start);
    time.set(start + 100);
    await loop.refresh();
    const deadline = loop.getSnapshot().retryAt;
    assert.ok(deadline > start);
    assert.equal(loop.getSnapshot().lastCompletedAt, start);
    time.set(start + 500);
    slow.resolve(response([]));
    await until(() => loop.getSnapshot().lastCompletedAt === start + 500);
    const before = paths.length;
    await loop.refresh();
    assert.equal(paths.length, before);
    assert.equal(loop.getSnapshot().nextAt, deadline);
    assert.equal(time.timers.size, 1);
    loop.stop();
  });
});
test('discarded monitor sessions cannot complete a current cycle with a late response', async () => {
  await using(async ({ group, holds }) => {
    group.start(['a/one'], '');
    await until(() => !group.getSnapshot().running.size);
    const slow = deferred<Response>();
    holds.set('/repos/a/one', slow);
    let completion: Promise<boolean> | null | undefined;
    const time = completionClock(),
      loop = new RefreshLoop(
        async (kind) => {
          const result = await group.refreshAll(kind);
          completion = result.completion;
          return result;
        },
        () => true,
        time.clock,
      );
    loop.configure('monitor', false, 60000);
    loop.loaded();
    await loop.refresh();
    await tick();
    group.stop();
    holds.clear();
    group.start(['b/two'], '');
    await until(() => !group.getSnapshot().running.size);
    time.set(5000);
    loop.configure('new-monitor', false, 60000);
    loop.loaded();
    time.set(9000);
    slow.resolve(response({ default_branch: 'main', private: false }));
    assert.equal(await completion, false);
    await tick();
    assert.equal(loop.getSnapshot().lastCompletedAt, 5000);
    assert.equal(loop.getSnapshot().error, '');
    loop.stop();
  });
});
