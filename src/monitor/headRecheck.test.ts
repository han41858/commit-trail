import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MonitorSession } from './MonitorSession';
import { History } from '../repository/history';
import { CommitInfoStore } from '../repository/CommitInfoStore';

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
    cycle: (work: () => Promise<unknown>) => Promise<string[]>;
  }) => Promise<void>,
) {
  const original = globalThis.fetch,
    remotes = Object.fromEntries(
      repositories.map((repository) => [repository, seed()]),
    );
  let paths: string[] = [];
  const json = (data: unknown) => new Response(JSON.stringify(data));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)),
      path = url.pathname,
      remote = remotes[path.split('/').slice(2, 4).join('/')];
    paths.push(path);
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
  };
  const cycle = async (work: () => Promise<unknown>) => {
    paths = [];
    await work();
    await until(() => !group.getSnapshot().running.size);
    // Commit pages follow from a moved head; the policy is about the other reads.
    return paths.filter((path) => !path.endsWith('/commits')).sort();
  };
  try {
    await check({ group, history, info, remotes, moved, cycle });
  } finally {
    group.stop();
    history.cancel();
    info.cancel();
    globalThis.fetch = original;
  }
}
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
        assert.deepEqual(await cycle(() => group.recheck()), [
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
      assert.deepEqual(await cycle(() => group.recheck()), []);

      remote.parents.next = ['base'];
      remote.branches.main = 'next';
      await cycle(() => group.refreshPrimary('manual'));
      assert.equal(moved.count, 1);

      // The head moves again while the recheck reads it.
      remote.parents.later = ['next'];
      remote.branches.main = 'later';
      await cycle(() => group.recheck());
      assert.equal(history.getSnapshot().baseHead, 'later');
      assert.equal(moved.count, 1);
      assert.deepEqual(await cycle(() => group.recheck()), []);
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
      assert.deepEqual(await cycle(() => group.recheck()), [
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
    assert.deepEqual(await cycle(() => group.recheck()), []);
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
    assert.deepEqual(await cycle(() => group.recheck()), [
      '/repos/a/one',
      '/repos/a/one/branches',
    ]);
    assert.deepEqual(names(history), ['main']);
    // Slower metadata still gets its confirming read on the regular schedule.
    assert.deepEqual(await auto(), full);
    assert.deepEqual(await auto(), ['/repos/a/one']);
  });
});
