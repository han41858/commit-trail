import { test } from 'node:test';
import assert from 'node:assert/strict';
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
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}
async function using(
  check: (context: {
    paths: string[];
    holds: Map<string, ReturnType<typeof deferred>>;
    failures: Map<string, number>;
  }) => Promise<void>,
) {
  const original = globalThis.fetch,
    paths: string[] = [],
    holds = new Map<string, ReturnType<typeof deferred>>(),
    failures = new Map<string, number>();
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    await holds.get(path)?.promise;
    const failure = failures.get(path);
    if (failure) return json({}, failure);
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
    if (path.endsWith('/actions/runs')) return json({ workflow_runs: [] });
    if (['/tags', '/releases', '/activity'].some((suffix) => path.endsWith(suffix)))
      return json([]);
    return json({ default_branch: 'main', private: false });
  };
  try {
    await check({ paths, holds, failures });
  } finally {
    for (const hold of holds.values()) hold.release();
    await tick();
    globalThis.fetch = original;
  }
}

test('opening requests the repository and its first branch page together', async () => {
  await using(async ({ paths, holds }) => {
    const repository = deferred();
    holds.set('/repos/a/one', repository);
    const history = new History();
    const opening = history.open('a/one');
    await until(() => paths.length === 2);
    assert.deepEqual([...paths].sort(), ['/repos/a/one', '/repos/a/one/branches']);
    repository.release();
    await opening;
    assert.equal(history.getSnapshot().error, '');
    assert.equal(history.getSnapshot().commits.length, 1);
    assert.equal(paths.filter((path) => path === '/repos/a/one/branches').length, 1);
    history.cancel();
  });
});
test('a missing repository reports the repository error, not the branch request failure', async () => {
  await using(async ({ failures }) => {
    failures.set('/repos/a/none', 404);
    failures.set('/repos/a/none/branches', 500);
    const history = new History();
    await history.open('a/none');
    assert.match(history.getSnapshot().error, /Repository not found/);
    assert.equal(history.getSnapshot().meta, null);
    history.cancel();
  });
});
test('a branch page failure still stops the initial load after the repository succeeds', async () => {
  await using(async ({ failures }) => {
    failures.set('/repos/a/one/branches', 500);
    const history = new History();
    await history.open('a/one');
    assert.match(history.getSnapshot().error, /500/);
    assert.equal(history.getSnapshot().commits.length, 0);
    history.cancel();
  });
});
test('metadata requests Actions without waiting for tags', async () => {
  await using(async ({ paths, holds }) => {
    const tags = deferred();
    holds.set('/repos/a/one/tags', tags);
    const info = new CommitInfoStore();
    const opening = info.open('a/one', '');
    await until(() => paths.includes('/repos/a/one/actions/runs'));
    // Releases resolve against tags, so they still wait.
    assert.ok(!paths.includes('/repos/a/one/releases'));
    tags.release();
    await opening;
    assert.ok(paths.includes('/repos/a/one/releases'));
    assert.deepEqual(info.getSnapshot().errors, {});
    info.cancel();
  });
});
