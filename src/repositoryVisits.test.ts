import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from './history';
import { RecentRepositories } from './RecentRepositories';

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const commit = {
  sha: 'head',
  parents: [],
  commit: {
    message: 'test',
    author: { name: 'Test', date: '2026-10-31T00:00:00Z' },
    committer: null,
  },
  html_url: '',
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function using(
  handler: (
    url: URL,
    init?: RequestInit,
  ) => Response | Promise<Response> | undefined,
  check: (
    history: History,
    recent: RecentRepositories,
    requests: URL[],
  ) => Promise<void>,
) {
  const original = globalThis.fetch,
    requests: URL[] = [],
    data = new Map<string, string>();
  const recent = new RecentRepositories({
    storage: () => ({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    }),
    now: () => 100,
  });
  const history = new History(recent.repositoryMetadata);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    const result = handler(url, init);
    if (result) return result;
    if (url.pathname.endsWith('/branches'))
      return response([{ name: 'main', commit: { sha: 'head' } }]);
    if (url.pathname.endsWith('/commits')) return response([commit]);
    if (url.pathname.endsWith('/activity')) return response([]);
    return response({
      default_branch: 'main',
      private: false,
      description: null,
      stargazers_count: 0,
    });
  };
  try {
    await check(history, recent, requests);
  } finally {
    history.cancel();
    globalThis.fetch = original;
  }
}

test('metadata success records URL opens and explicit reopens without waiting for commit loading', async () => {
  await using(
    (url) =>
      url.pathname.endsWith('/commits') ? response({}, 403) : undefined,
    async (history, recent, requests) => {
      await history.open('https://github.com/Owner/Repo.git');
      assert.deepEqual(recent.getSnapshot().entries, [
        { repository: 'owner/repo', visibility: 'public', visitedAt: 100 },
      ]);
      assert.equal(
        requests.filter((url) => url.pathname === '/repos/Owner/Repo').length,
        1,
      );
      assert.ok(history.getSnapshot().error);
      await history.open('other/repo');
      await history.open('OWNER/REPO');
      assert.deepEqual(
        recent.getSnapshot().entries.map((entry) => entry.repository),
        ['owner/repo', 'other/repo'],
      );
    },
  );
});
test('invalid input, 404, 401, permission failure and network failure do not create visits', async () => {
  for (const status of [404, 401, 403, 0])
    await using(
      (url) => {
        if (url.pathname === '/repos/a/repo') {
          if (status === 0) throw new Error('network');
          return response({}, status);
        }
        return undefined;
      },
      async (history, recent, requests) => {
        await history.open('not a repository');
        assert.equal(requests.length, 0);
        await history.open('a/repo');
        assert.deepEqual(recent.getSnapshot().entries, []);
        assert.ok(history.getSnapshot().error);
      },
    );
});
test('public/private status comes from metadata and is not inferred from the presence of a PAT', async () => {
  await using(
    (url) =>
      url.pathname === '/repos/private/repo'
        ? response({ default_branch: 'main', private: true })
        : undefined,
    async (history, recent) => {
      await history.open('public/repo', 'test-only-token');
      await history.open('private/repo', 'test-only-token');
      assert.deepEqual(
        recent
          .getSnapshot()
          .entries.map((entry) => [entry.repository, entry.visibility]),
        [
          ['private/repo', 'private'],
          ['public/repo', 'public'],
        ],
      );
      recent.authenticationChanged('test-only-token', 'different-test-token');
      assert.deepEqual(
        recent.getSnapshot().entries.map((entry) => entry.repository),
        ['public/repo'],
      );
    },
  );
});
test('unknown metadata visibility is not guessed and failed refreshes preserve visits', async () => {
  let fail = false;
  await using(
    (url) =>
      url.pathname === '/repos/a/repo'
        ? response(
            fail ? {} : { default_branch: 'main', private: true },
            fail ? 401 : 200,
          )
        : url.pathname === '/repos/unknown/repo'
          ? response({ default_branch: 'main' })
          : undefined,
    async (history, recent) => {
      await history.open('unknown/repo');
      assert.deepEqual(recent.getSnapshot().entries, []);
      await history.open('a/repo');
      const before = recent.getSnapshot().entries;
      fail = true;
      await history.refresh();
      assert.deepEqual(recent.getSnapshot().entries, before);
    },
  );
});
test('unchanged refreshes keep timestamps, changed visibility updates, and clearing stays cleared', async () => {
  let isPrivate = false;
  await using(
    (url) =>
      url.pathname === '/repos/a/repo'
        ? response({ default_branch: 'main', private: isPrivate })
        : undefined,
    async (history, recent) => {
      await history.open('a/repo');
      const before = recent.getSnapshot();
      await history.refresh();
      assert.equal(recent.getSnapshot(), before);
      isPrivate = true;
      await history.refresh();
      assert.deepEqual(recent.getSnapshot().entries, [
        { repository: 'a/repo', visibility: 'private', visitedAt: 100 },
      ]);
      recent.clear();
      await history.refresh();
      assert.deepEqual(recent.getSnapshot().entries, []);
      await history.open('a/repo');
      assert.equal(recent.getSnapshot().entries[0].visibility, 'private');
    },
  );
});
test('cancelled metadata cannot resurrect old private visits after authentication or repository changes', async () => {
  let release!: (value: Response) => void;
  let waiting = true;
  await using(
    (url) =>
      url.pathname === '/repos/old/repo' && waiting
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : undefined,
    async (history, recent) => {
      const old = history.open('old/repo', 'old-test-token');
      await tick();
      recent.authenticationChanged('old-test-token', 'new-test-token');
      await history.open('new/repo', 'new-test-token');
      waiting = false;
      release(response({ default_branch: 'main', private: true }));
      await old;
      assert.deepEqual(
        recent.getSnapshot().entries.map((entry) => entry.repository),
        ['new/repo'],
      );
    },
  );
});
test('connecting visit persistence does not add API requests', async () => {
  await using(
    () => undefined,
    async (history, _recent, requests) => {
      await history.open('a/repo');
      const withVisits = requests.map((url) => url.pathname + url.search);
      requests.length = 0;
      const plain = new History();
      try {
        await plain.open('a/repo');
        assert.deepEqual(
          requests.map((url) => url.pathname + url.search),
          withVisits,
        );
      } finally {
        plain.cancel();
      }
    },
  );
});
test('storage failures cannot turn a successful repository open into an application error', async () => {
  const original = globalThis.fetch;
  const recent = new RecentRepositories({
    storage: () => ({
      getItem: () => null,
      setItem() {
        throw new Error('quota');
      },
      removeItem() {},
    }),
  });
  const history = new History(recent.repositoryMetadata);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    return response(
      url.pathname.endsWith('/branches')
        ? [{ name: 'main', commit: { sha: 'head' } }]
        : url.pathname.endsWith('/commits')
          ? [commit]
          : url.pathname.endsWith('/activity')
            ? []
            : { default_branch: 'main', private: false },
    );
  };
  try {
    await history.open('a/repo');
    assert.equal(history.getSnapshot().error, '');
    assert.equal(history.getSnapshot().commits.length, 1);
    assert.equal(recent.getSnapshot().available, false);
  } finally {
    history.cancel();
    globalThis.fetch = original;
  }
});
