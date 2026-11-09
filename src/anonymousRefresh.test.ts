import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MonitorSession } from './MonitorSession';
import { History } from './history';
import { CommitInfoStore } from './CommitInfoStore';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (check()) return;
    await tick();
  }
  assert.ok(check(), 'operation did not settle');
}
type Run = { id: number; status: string; conclusion: string | null };
async function using(
  check: (context: {
    group: MonitorSession;
    history: History;
    info: CommitInfoStore;
    remote: { pushedAt: string; runs: Run[] };
    cycle: (work: () => Promise<unknown>) => Promise<string[]>;
  }) => Promise<void>,
) {
  const original = globalThis.fetch,
    remote = { pushedAt: '2026-11-01T00:00:00Z', runs: [] as Run[] };
  let paths: string[] = [];
  const json = (data: unknown) => new Response(JSON.stringify(data));
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith('/branches')) return json([{ name: 'main', commit: { sha: 'head' } }]);
    if (path.endsWith('/commits'))
      return json([
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
      return json({
        workflow_runs: remote.runs.map((run) => ({
          ...run,
          workflow_id: 1,
          head_sha: 'head',
          name: 'CI',
          updated_at: '2026-11-01T00:00:00Z',
          html_url: '',
        })),
      });
    if (['/tags', '/releases', '/activity'].some((suffix) => path.endsWith(suffix)))
      return json([]);
    return json({ default_branch: 'main', private: false, pushed_at: remote.pushedAt });
  };
  const history = new History(),
    info = new CommitInfoStore(),
    group = new MonitorSession(history, info, () => {});
  const cycle = async (work: () => Promise<unknown>) => {
    paths = [];
    await work();
    await until(() => !group.getSnapshot().running.size);
    return [...paths].sort();
  };
  try {
    await check({ group, history, info, remote, cycle });
  } finally {
    group.stop();
    history.cancel();
    info.cancel();
    globalThis.fetch = original;
  }
}
const full = (repository: string) =>
  ['', '/actions/runs', '/branches', '/releases', '/tags'].map(
    (suffix) => `/repos/${repository}${suffix}`,
  );

test('anonymous automatic refresh reads only the repository until it reports a push', async () => {
  await using(async ({ group, history, info, remote, cycle }) => {
    await history.open('a/one');
    await info.open('a/one', '');
    const auto = () => cycle(() => group.refreshPrimary('auto'));
    // The first cycle after loading confirms that slower endpoints have caught up.
    assert.deepEqual(await auto(), full('a/one'));
    assert.deepEqual(await auto(), ['/repos/a/one']);
    assert.deepEqual(await auto(), ['/repos/a/one']);
    remote.pushedAt = '2026-11-02T00:00:00Z';
    assert.deepEqual(await auto(), full('a/one'));
    assert.deepEqual(await auto(), full('a/one'));
    assert.deepEqual(await auto(), ['/repos/a/one']);
  });
});
test('anonymous manual refresh and authenticated automatic refresh always read everything', async () => {
  await using(async ({ group, history, info, cycle }) => {
    await history.open('a/one');
    await info.open('a/one', '');
    await cycle(() => group.refreshPrimary('auto'));
    assert.deepEqual(await cycle(() => group.refreshPrimary('auto')), ['/repos/a/one']);
    assert.deepEqual(await cycle(() => group.refreshPrimary('manual')), full('a/one'));
  });
  await using(async ({ group, history, info, cycle }) => {
    await history.open('a/one', 'token');
    await info.open('a/one', 'token');
    for (let count = 0; count < 3; count++)
      assert.deepEqual(await cycle(() => group.refreshPrimary('auto')), full('a/one'));
  });
});
test('an unfinished workflow keeps only Actions polling while the repository is unchanged', async () => {
  await using(async ({ group, history, info, remote, cycle }) => {
    remote.runs = [{ id: 1, status: 'in_progress', conclusion: null }];
    await history.open('a/one');
    await info.open('a/one', '');
    const auto = () => cycle(() => group.refreshPrimary('auto'));
    await auto();
    assert.deepEqual(await auto(), ['/repos/a/one', '/repos/a/one/actions/runs']);
    remote.runs = [{ id: 1, status: 'completed', conclusion: 'success' }];
    assert.deepEqual(await auto(), ['/repos/a/one', '/repos/a/one/actions/runs']);
    assert.equal(info.getSnapshot().bySha.get('head')?.actions?.state, 'success');
    assert.deepEqual(await auto(), ['/repos/a/one']);
  });
});
test('split view applies the same anonymous policy to every repository', async () => {
  await using(async ({ group, cycle }) => {
    await cycle(async () => group.start(['a/one', 'b/two'], ''));
    const auto = () => cycle(() => group.refreshAll('auto'));
    assert.deepEqual(await auto(), [...full('a/one'), ...full('b/two')].sort());
    assert.deepEqual(await auto(), ['/repos/a/one', '/repos/b/two']);
    assert.deepEqual(
      await cycle(() => group.refreshAll('manual')),
      [...full('a/one'), ...full('b/two')].sort(),
    );
  });
});
