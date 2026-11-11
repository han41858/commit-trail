import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from './history';
import { BranchSelections } from './BranchSelections';
import { MonitorSession } from './MonitorSession';
import { CommitInfoStore } from './CommitInfoStore';
const response = (data: unknown, status = 200, partial = false) =>
  new Response(JSON.stringify(data), {
    status,
    headers: partial
      ? { Link: '<https://api.github.com/next>; rel="next"' }
      : {},
  });
type Options = {
  names?: string[];
  partial?: boolean;
  exact?: Record<string, string | number>;
  defaultBranch?: string;
};
async function using(
  options: Options,
  check: (
    history: History,
    store: BranchSelections,
    requests: URL[],
  ) => Promise<void>,
) {
  const data = new Map<string, string>(),
    store = new BranchSelections({
      storage: () => ({
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
          data.set(key, value);
        },
        removeItem: (key) => {
          data.delete(key);
        },
      }),
    });
  const history = new History(
      (repo, privateRepo) => store.repositoryMetadata(repo, privateRepo),
      store,
    ),
    requests: URL[] = [],
    original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith('/branches'))
      return response(
        (options.names ?? ['main', 'master', 'dev']).map((name) => ({
          name,
          commit: { sha: name + '-head' },
        })),
        200,
        options.partial,
      );
    if (url.pathname.includes('/branches/')) {
      const name = decodeURIComponent(url.pathname.split('/branches/')[1]),
        value = options.exact?.[name];
      return typeof value === 'string'
        ? response({ name, commit: { sha: value } })
        : response({}, typeof value === 'number' ? value : 404);
    }
    if (url.pathname.endsWith('/commits'))
      return response([
        {
          sha: url.searchParams.get('sha') + '-head',
          parents: [],
          commit: { message: 'fixture', author: null, committer: null },
          html_url: '',
        },
      ]);
    if (url.pathname.endsWith('/actions/runs'))
      return response({ workflow_runs: [] });
    if (
      ['/tags', '/releases', '/activity', '/pulls'].some((suffix) =>
        url.pathname.endsWith(suffix),
      )
    )
      return response([]);
    return response({
      default_branch: options.defaultBranch ?? 'dev',
      private: false,
    });
  };
  try {
    await check(history, store, requests);
  } finally {
    history.cancel();
    globalThis.fetch = original;
  }
}
for (const [names, expected] of [
  [['main', 'master', 'dev'], 'main'],
  [['master', 'dev'], 'master'],
  [['dev'], 'dev'],
] as const)
  test(`first visits retain the default priority: ${expected}`, async () => {
    await using({ names: [...names] }, async (history, store) => {
      await history.open('a/repo');
      assert.equal(history.getSnapshot().base, expected);
      assert.equal(store.get('a/repo'), undefined);
    });
  });
test('URL overrides a remembered choice without recording it; a plain revisit restores the remembered branch', async () => {
  await using({}, async (history, store) => {
    store.record('a/repo', 'dev', false);
    await history.open('a/repo', '', undefined, 'main');
    assert.equal(history.getSnapshot().base, 'main');
    assert.equal(store.get('a/repo'), 'dev');
    await history.open('a/repo');
    assert.equal(history.getSnapshot().base, 'dev');
  });
});
test('missing URL branches fall back to the remembered branch, and confirmed deleted records fall back to main', async () => {
  await using({}, async (history, store) => {
    store.record('a/repo', 'dev', false);
    await history.open('a/repo', '', undefined, 'gone');
    assert.equal(history.getSnapshot().base, 'dev');
    store.record('a/repo', 'deleted', false);
    await history.open('a/repo');
    assert.equal(history.getSnapshot().base, 'main');
    assert.equal(store.get('a/repo'), undefined);
  });
});
test('partial catalogs resolve exact saved and URL branch names without lowercasing or fetching unrelated defaults', async () => {
  await using(
    {
      names: ['dev'],
      partial: true,
      exact: { 'Feature/Fix': 'feature', main: 403 },
    },
    async (history, store, requests) => {
      store.record('a/repo', 'Feature/Fix', false);
      await history.open('a/repo');
      assert.equal(history.getSnapshot().base, 'Feature/Fix');
      assert.ok(
        requests.some((url) =>
          url.pathname.endsWith('/branches/Feature%2FFix'),
        ),
      );
      assert.ok(
        !requests.some((url) => url.pathname.endsWith('/branches/main')),
      );
      await history.open('a/repo', '', undefined, 'dev');
      assert.equal(history.getSnapshot().base, 'dev');
      assert.equal(history.getSnapshot().error, '');
      assert.equal(store.get('a/repo'), 'Feature/Fix');
    },
  );
});
for (const status of [401, 403, 429, 500])
  test(`temporary lookup failure ${status} preserves the saved branch and an existing graph`, async () => {
    await using(
      { names: ['main'], partial: true, exact: { 'Feature/Fix': status } },
      async (history, store) => {
        await history.open('a/repo');
        const before = history.getSnapshot();
        store.record('a/repo', 'Feature/Fix', false);
        await history.restoreBase('Feature/Fix');
        assert.equal(history.getSnapshot().base, 'main');
        assert.equal(history.getSnapshot().commits, before.commits);
        assert.ok(history.getSnapshot().error);
        assert.equal(store.get('a/repo'), 'Feature/Fix');
      },
    );
  });
for (const method of ['retry', 'refresh'] as const)
  test(`failed initial branch lookup uses ${method} to retry its requested choice instead of silently choosing a default`, async () => {
    const options: Options = {
      names: ['main'],
      partial: true,
      exact: { 'Feature/Fix': 500 },
    };
    await using(options, async (history, store) => {
      await history.open('a/repo', '', undefined, 'Feature/Fix');
      assert.ok(history.getSnapshot().error);
      options.exact!['Feature/Fix'] = 'feature';
      await history[method]();
      assert.equal(history.getSnapshot().base, 'Feature/Fix');
      assert.equal(history.getSnapshot().error, '');
      assert.equal(store.get('a/repo'), undefined);
    });
  });
test('retry resolves a failed URL navigation without first clearing the existing graph', async () => {
  const options: Options = {
    names: ['main'],
    partial: true,
    exact: { Feature: 500 },
  };
  await using(options, async (history) => {
    await history.open('a/repo');
    await history.restoreBase('Feature');
    assert.equal(history.getSnapshot().base, 'main');
    options.exact!.Feature = 'feature';
    await history.retry();
    assert.equal(history.getSnapshot().base, 'Feature');
    assert.equal(history.getSnapshot().error, '');
  });
});
test('the common refresh path retries a pending URL lookup and keeps ordinary refresh priorities unchanged', async () => {
  const options: Options = {
    names: ['main'],
    partial: true,
    exact: { Feature: 500 },
  };
  await using(options, async (history, store) => {
    await history.open('a/repo');
    await history.restoreBase('Feature');
    options.exact!.Feature = 'feature';
    await history.refresh();
    assert.equal(history.getSnapshot().base, 'Feature');
    assert.equal(history.getSnapshot().error, '');
    assert.equal(store.get('a/repo'), undefined);
    await history.refresh();
    assert.equal(history.getSnapshot().base, 'Feature');
  });
});
test('refresh and retry do not duplicate an active URL branch lookup', async () => {
  await using({ names: ['main'], partial: true }, async (history) => {
    await history.open('a/repo');
    const original = globalThis.fetch;
    let release!: (response: Response) => void,
      calls = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/branches/Feature')) {
        calls++;
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return original(input, init);
    };
    const pending = history.restoreBase('Feature');
    await Promise.all([history.refresh(), history.retry()]);
    assert.equal(calls, 1);
    release(response({ name: 'Feature', commit: { sha: 'f' } }));
    await pending;
    assert.equal(history.getSnapshot().base, 'Feature');
  });
});
test('refresh, returning from a URL override and repository changes do not write user choices', async () => {
  await using({}, async (history, store) => {
    store.record('a/repo', 'dev', false);
    store.record('b/repo', 'master', false);
    await history.open('a/repo', '', undefined, 'main');
    await history.refresh();
    assert.equal(history.getSnapshot().base, 'main');
    await history.restoreBase();
    assert.equal(history.getSnapshot().base, 'dev');
    await history.open('b/repo');
    assert.equal(history.getSnapshot().base, 'master');
    assert.equal(store.get('a/repo'), 'dev');
  });
});
test('Split view preserves its primary graph and initializes other repositories with independent branch preferences', async () => {
  await using({}, async (history, store, requests) => {
    store.record('a/repo', 'dev', false);
    store.record('b/repo', 'master', false);
    await history.open('a/repo');
    const before = history.getSnapshot(),
      info = new CommitInfoStore(),
      group = new MonitorSession(history, info, () => {}, store);
    try {
      const count = requests.length;
      group.start(['a/repo', 'b/repo'], '', [undefined, 'main']);
      for (let i = 0; i < 50 && group.getSnapshot().running.size; i++)
        await new Promise((resolve) => setImmediate(resolve));
      const entries = group.getSnapshot().entries;
      assert.equal(entries[0].history, history);
      assert.equal(history.getSnapshot().commits, before.commits);
      assert.equal(entries[1].history.getSnapshot().base, 'main');
      assert.equal(store.get('b/repo'), 'master');
      assert.equal(
        requests.slice(count).filter((url) => url.pathname === '/repos/a/repo')
          .length,
        0,
      );
      group.start(['a/repo', 'b/repo'], '', ['master'], true);
      for (let i = 0; i < 50 && group.getSnapshot().running.size; i++)
        await new Promise((resolve) => setImmediate(resolve));
      assert.equal(history.getSnapshot().base, 'master');
      assert.equal(store.get('a/repo'), 'dev');
    } finally {
      group.stop();
      info.cancel();
    }
  });
});
test('a late URL lookup cannot override a subsequent direct choice', async () => {
  await using({ names: ['main', 'dev'], partial: true }, async (history) => {
    await history.open('a/repo');
    const original = globalThis.fetch;
    let release!: (response: Response) => void;
    globalThis.fetch = async (input, init) =>
      String(input).includes('/branches/Feature')
        ? new Promise((resolve) => {
            release = resolve;
          })
        : original(input, init);
    const pending = history.restoreBase('Feature');
    assert.ok(release);
    await history.chooseBase('dev');
    release(response({ name: 'Feature', commit: { sha: 'f' } }));
    await pending;
    assert.equal(history.getSnapshot().base, 'dev');
  });
});
test('returning to the already displayed branch cancels a slower URL lookup', async () => {
  await using({ names: ['main', 'dev'], partial: true }, async (history) => {
    await history.open('a/repo');
    const original = globalThis.fetch;
    let release!: (response: Response) => void;
    globalThis.fetch = async (input, init) =>
      String(input).includes('/branches/Feature')
        ? new Promise((resolve) => {
            release = resolve;
          })
        : original(input, init);
    const pending = history.restoreBase('Feature');
    await history.restoreBase('main');
    release(response({ name: 'Feature', commit: { sha: 'f' } }));
    await pending;
    assert.equal(history.getSnapshot().base, 'main');
  });
});
test('network failures preserve saved choices and loaded commits', async () => {
  await using({ names: ['main'], partial: true }, async (history, store) => {
    await history.open('a/repo');
    const commits = history.getSnapshot().commits,
      original = globalThis.fetch;
    store.record('a/repo', 'Feature', false);
    globalThis.fetch = async (input, init) =>
      String(input).includes('/branches/Feature')
        ? Promise.reject(new TypeError('offline'))
        : original(input, init);
    await history.restoreBase('Feature');
    assert.equal(history.getSnapshot().commits, commits);
    assert.equal(store.get('a/repo'), 'Feature');
    assert.match(history.getSnapshot().error, /Could not reach GitHub/);
  });
});
