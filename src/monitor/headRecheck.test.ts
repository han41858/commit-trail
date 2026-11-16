import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MonitorSession } from './MonitorSession';
import { History } from '../repository/history';
import { CommitInfoStore } from '../repository/CommitInfoStore';
import {
  RECHECK_DELAY,
  RefreshLoop,
  type RefreshClock,
} from '../shared/refresh/RefreshLoop';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (check()) return;
    await tick();
  }
  assert.ok(check(), 'operation did not settle');
}
type Remote = {
  pushedAt: string;
  branches: Record<string, string>;
  parents: Record<string, string[]>;
};
const seed = (): Remote => ({
  pushedAt: '2026-11-01T00:00:00Z',
  branches: { main: 'base', feature: 'work' },
  parents: { base: [], work: ['base'] },
});
async function using(
  repositories: string[],
  check: (context: {
    group: MonitorSession;
    history: History;
    info: CommitInfoStore;
    remotes: Record<string, Remote>;
    moved: { count: number };
    // A request to one of these paths waits until its promise settles.
    holds: Map<string, Promise<void>>;
    paths: () => string[];
    cycle: (work: () => Promise<unknown>) => Promise<string[]>;
  }) => Promise<void>,
) {
  const original = globalThis.fetch,
    remotes = Object.fromEntries(
      repositories.map((repository) => [repository, seed()]),
    );
  let paths: string[] = [];
  const holds = new Map<string, Promise<void>>();
  const json = (data: unknown) => new Response(JSON.stringify(data));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)),
      path = url.pathname,
      remote = remotes[path.split('/').slice(2, 4).join('/')];
    paths.push(path);
    await holds.get(path);
    if (path.endsWith('/branches'))
      return json(
        Object.entries(remote.branches).map(([name, sha]) => ({
          name,
          commit: { sha },
        })),
      );
    if (path.endsWith('/commits')) {
      const list: unknown[] = [],
        seen = new Set<string>(),
        requested = url.searchParams.get('sha') ?? 'main',
        queue = [remote.branches[requested] ?? requested];
      while (queue.length) {
        const sha = queue.shift()!;
        if (seen.has(sha)) continue;
        seen.add(sha);
        const parents = remote.parents[sha] ?? [];
        list.push({
          sha,
          parents: parents.map((sha) => ({ sha })),
          commit: {
            message: sha,
            author: { name: 'Test', date: '2026-11-01T00:00:00Z' },
            committer: null,
          },
          html_url: '',
        });
        queue.push(...parents);
      }
      return json(list);
    }
    if (path.endsWith('/actions/runs')) return json({ workflow_runs: [] });
    if (
      ['/tags', '/releases', '/activity', '/pulls'].some((suffix) =>
        path.endsWith(suffix),
      )
    )
      return json([]);
    if (path.includes('/branches/')) return new Response('', { status: 404 });
    return json({
      default_branch: 'main',
      private: false,
      pushed_at: remote.pushedAt,
    });
  };
  const history = new History(),
    info = new CommitInfoStore(),
    group = new MonitorSession(history, info, () => {}),
    moved = { count: 0 };
  group.onHeadMoved = () => {
    moved.count++;
    return 0;
  };
  const cycle = async (work: () => Promise<unknown>) => {
    paths = [];
    await work();
    await until(() => !group.getSnapshot().running.size);
    // Commit pages follow from a moved head; the policy is about the other reads.
    return paths.filter((path) => !path.endsWith('/commits')).sort();
  };
  try {
    await check({
      group,
      history,
      info,
      remotes,
      moved,
      holds,
      paths: () => paths.filter((path) => !path.endsWith('/commits')).sort(),
      cycle,
    });
  } finally {
    group.stop();
    history.cancel();
    info.cancel();
    globalThis.fetch = original;
  }
}
const recheck = (group: MonitorSession, now?: number) => {
  group.recheck(false, now);
  return group.rechecked;
};
const names = (history: History) =>
  history
    .getSnapshot()
    .branches.map((branch) => branch.name)
    .sort();
// GitHub applies the merge first and removes the merged branch a few seconds later.
const merges: Record<string, (remote: Remote) => void> = {
  squash: (remote) => {
    remote.parents.merged = ['base'];
  },
  rebase: (remote) => {
    remote.parents.replayed = ['base'];
    remote.parents.merged = ['replayed'];
  },
  'merge commit': (remote) => {
    remote.parents.merged = ['base', 'work'];
  },
};

for (const [mode, merge] of Object.entries(merges))
  test(`a ${mode} seen before GitHub deletes its branch is corrected by one recheck`, async () => {
    await using(
      ['a/one'],
      async ({ group, history, info, remotes, moved, cycle }) => {
        const remote = remotes['a/one'];
        await history.open('a/one', 'token');
        await info.open('a/one', 'token');
        await cycle(() => group.refreshPrimary('auto'));
        assert.equal(moved.count, 0);

        merge(remote);
        remote.branches.main = 'merged';
        remote.pushedAt = '2026-11-02T00:00:00Z';
        await cycle(() => group.refreshPrimary('auto'));
        assert.equal(history.getSnapshot().baseHead, 'merged');
        assert.deepEqual(names(history), ['feature', 'main']);
        assert.equal(moved.count, 1);

        delete remote.branches.feature;
        remote.pushedAt = '2026-11-02T00:00:03Z';
        // Only repository and branch reads: metadata waits for the regular cycle.
        assert.deepEqual(await cycle(() => recheck(group)), [
          '/repos/a/one',
          '/repos/a/one/branches',
        ]);
        assert.deepEqual(names(history), ['main']);
        assert.equal(moved.count, 1);
      },
    );
  });

test('a recheck never schedules another one and a quiet cycle schedules none', async () => {
  await using(
    ['a/one'],
    async ({ group, history, info, remotes, moved, cycle }) => {
      const remote = remotes['a/one'];
      await history.open('a/one', 'token');
      await info.open('a/one', 'token');
      await cycle(() => group.refreshPrimary('auto'));

      // A new or deleted branch alone does not move a known head.
      remote.branches.other = 'base';
      delete remote.branches.feature;
      await cycle(() => group.refreshPrimary('auto'));
      assert.equal(moved.count, 0);
      assert.deepEqual(await cycle(() => recheck(group)), []);

      remote.parents.next = ['base'];
      remote.branches.main = 'next';
      await cycle(() => group.refreshPrimary('manual'));
      assert.equal(moved.count, 1);

      // The head moves again while the recheck reads it.
      remote.parents.later = ['next'];
      remote.branches.main = 'later';
      await cycle(() => recheck(group));
      assert.equal(history.getSnapshot().baseHead, 'later');
      assert.equal(moved.count, 1);
      assert.deepEqual(await cycle(() => recheck(group)), []);
    },
  );
});

test('split view rechecks only the repositories whose heads moved', async () => {
  await using(
    ['a/one', 'b/two', 'c/three'],
    async ({ group, remotes, moved, cycle }) => {
      await cycle(async () =>
        group.start(['a/one', 'b/two', 'c/three'], 'token'),
      );
      await cycle(() => group.refreshAll('auto'));
      assert.equal(moved.count, 0);

      const remote = remotes['b/two'];
      remote.parents.merged = ['base'];
      remote.branches.main = 'merged';
      await cycle(() => group.refreshAll('auto'));
      assert.equal(moved.count, 1);

      delete remote.branches.feature;
      assert.deepEqual(await cycle(() => recheck(group)), [
        '/repos/b/two',
        '/repos/b/two/branches',
      ]);
      const entry = group
        .getSnapshot()
        .entries.find((entry) => entry.repository === 'b/two')!;
      assert.deepEqual(names(entry.history), ['main']);
    },
  );
});

test('a repository removed from split view before the recheck is skipped', async () => {
  await using(['a/one', 'b/two'], async ({ group, remotes, moved, cycle }) => {
    await cycle(async () => group.start(['a/one', 'b/two'], 'token'));
    await cycle(() => group.refreshAll('auto'));
    remotes['b/two'].parents.merged = ['base'];
    remotes['b/two'].branches.main = 'merged';
    await cycle(() => group.refreshAll('auto'));
    assert.equal(moved.count, 1);
    group.stop();
    assert.deepEqual(await cycle(() => recheck(group)), []);
  });
});

test('an anonymous recheck does not replace the second full read after a push', async () => {
  await using(['a/one'], async ({ group, history, info, remotes, cycle }) => {
    const remote = remotes['a/one'],
      full = ['', '/actions/runs', '/branches', '/releases', '/tags'].map(
        (suffix) => `/repos/a/one${suffix}`,
      );
    await history.open('a/one');
    await info.open('a/one', '');
    const auto = () => cycle(() => group.refreshPrimary('auto'));
    await auto();
    assert.deepEqual(await auto(), ['/repos/a/one']);

    remote.parents.merged = ['base'];
    remote.branches.main = 'merged';
    remote.pushedAt = '2026-11-02T00:00:00Z';
    assert.deepEqual(await auto(), full);
    delete remote.branches.feature;
    assert.deepEqual(await cycle(() => recheck(group)), [
      '/repos/a/one',
      '/repos/a/one/branches',
    ]);
    assert.deepEqual(names(history), ['main']);
    // Slower metadata still gets its confirming read on the regular schedule.
    assert.deepEqual(await auto(), full);
    assert.deepEqual(await auto(), ['/repos/a/one']);
  });
});

function timer() {
  let now = 1000,
    id = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  const clock: RefreshClock = {
    now: () => now,
    set: (fn, ms) => {
      tasks.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (key) => {
      tasks.delete(key as number);
    },
  };
  return {
    clock,
    advance: async (ms: number) => {
      const until = now + ms;
      while (true) {
        const task = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
        if (!task || task[1].at > until) break;
        now = task[1].at;
        tasks.delete(task[0]);
        task[1].fn();
        await tick();
      }
      now = until;
    },
  };
}
const gate = () => {
  let open = () => {};
  const closed = new Promise<void>((resolve) => (open = resolve));
  return { closed, open };
};

test('each repository waits from its own change and a new regular read replaces the wait', async () => {
  await using(['a/one', 'b/two'], async ({ group, remotes, cycle, paths }) => {
    let due = 0;
    group.onHeadMoved = () => due;
    await cycle(async () => group.start(['a/one', 'b/two'], 'token'));
    await cycle(() => group.refreshAll('auto'));
    const move = (repository: string, sha: string) => {
      remotes[repository].parents[sha] = ['base'];
      remotes[repository].branches.main = sha;
    };

    due = 7000;
    move('a/one', 'one');
    await cycle(() => group.refreshAll('auto'));
    due = 13000;
    move('b/two', 'two');
    await cycle(() => group.refreshAll('auto'));
    // The second cycle read a/one again, so only b/two is still waiting.
    await cycle(async () => {
      assert.equal(group.recheck(false, 7000), 13000);
      assert.equal(group.recheck(false, 12999), 13000);
      await group.rechecked;
    });
    assert.deepEqual(paths(), []);
    await cycle(async () => {
      assert.equal(group.recheck(false, 13000), undefined);
      await group.rechecked;
    });
    assert.deepEqual(paths(), ['/repos/b/two', '/repos/b/two/branches']);

    // Both move in one cycle but are noticed at different times.
    const dues = [20000, 26000];
    group.onHeadMoved = () => dues.shift()!;
    move('a/one', 'one-b');
    move('b/two', 'two-b');
    await cycle(() => group.refreshAll('auto'));
    await cycle(async () => {
      assert.equal(group.recheck(false, 20000), 26000);
      await group.rechecked;
    });
    assert.equal(
      paths().filter((path) => path.endsWith('/branches')).length,
      1,
    );
    await cycle(async () => {
      assert.equal(group.recheck(false, 26000), undefined);
      await group.rechecked;
    });
    assert.equal(
      paths().filter((path) => path.endsWith('/branches')).length,
      1,
    );
  });
});

test('slow metadata of the same refresh does not lose the recheck', async () => {
  await using(['a/one'], async ({ group, history, info, remotes, holds }) => {
    const remote = remotes['a/one'],
      time = timer(),
      loop = new RefreshLoop(
        (kind) => group.refreshPrimary(kind),
        () => true,
        time.clock,
        (discard, now) => group.recheck(discard, now),
      );
    group.onHeadMoved = loop.recheckSoon;
    await history.open('a/one', 'token');
    await info.open('a/one', 'token');
    loop.configure('a/one', true, 60000);
    loop.loaded();

    remote.parents.merged = ['base'];
    remote.branches.main = 'merged';
    const tags = gate();
    holds.set('/repos/a/one/tags', tags.closed);
    await time.advance(60000);
    await until(() => history.getSnapshot().baseHead === 'merged');
    assert.deepEqual(names(history), ['feature', 'main']);
    delete remote.branches.feature;

    await time.advance(RECHECK_DELAY - 1);
    await group.rechecked;
    assert.deepEqual(names(history), ['feature', 'main']);
    await time.advance(1);
    await group.rechecked;
    // The regular refresh is still waiting for tags.
    assert.equal(loop.getSnapshot().running, true);
    assert.deepEqual(names(history), ['main']);
    tags.open();
    await until(() => !loop.getSnapshot().running);
    loop.stop();
  });
});

test('a split view repository that answers late still waits the full delay', async () => {
  await using(
    ['a/one', 'b/two'],
    async ({ group, remotes, holds, paths, cycle }) => {
      const time = timer(),
        loop = new RefreshLoop(
          (kind) => group.refreshAll(kind),
          () => true,
          time.clock,
          (discard, now) => group.recheck(discard, now),
        );
      group.onHeadMoved = loop.recheckSoon;
      await cycle(async () => group.start(['a/one', 'b/two'], 'token'));
      loop.configure('split', true, 60000);
      loop.loaded();
      const entry = (repository: string) =>
        group
          .getSnapshot()
          .entries.find((entry) => entry.repository === repository)!.history;
      for (const repository of ['a/one', 'b/two']) {
        remotes[repository].parents.merged = ['base'];
        remotes[repository].branches.main = 'merged';
      }
      const slow = gate();
      holds.set('/repos/b/two', slow.closed);

      await time.advance(60000);
      await until(() => entry('a/one').getSnapshot().baseHead === 'merged');
      await time.advance(6000);
      slow.open();
      await until(() => entry('b/two').getSnapshot().baseHead === 'merged');
      await until(() => !group.getSnapshot().running.size);
      for (const repository of ['a/one', 'b/two'])
        delete remotes[repository].branches.feature;

      // a/one is due 7 seconds after its own change; b/two has waited only one.
      await cycle(async () => {
        await time.advance(1000);
        await group.rechecked;
      });
      assert.deepEqual(paths(), ['/repos/a/one', '/repos/a/one/branches']);
      assert.deepEqual(names(entry('b/two')), ['feature', 'main']);
      await cycle(async () => {
        await time.advance(5999);
        await group.rechecked;
      });
      assert.deepEqual(paths(), []);
      await cycle(async () => {
        await time.advance(1);
        await group.rechecked;
      });
      assert.deepEqual(paths(), ['/repos/b/two', '/repos/b/two/branches']);
      assert.deepEqual(names(entry('b/two')), ['main']);
      loop.stop();
    },
  );
});
