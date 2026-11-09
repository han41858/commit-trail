import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from './history';
import { layout, ROW, type Commit } from './model';
import { visibleHistorySources } from './graphView';
const commit = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents: parents.map((sha) => ({ sha })),
  commit: { message: sha, author: null, committer: null },
  html_url: `https://github.com/a/b/commit/${sha}`,
});
const ref = (name: string, sha = name) => ({ name, commit: { sha } });
const response = (data: unknown, next = false, lastPage?: number) =>
  new Response(JSON.stringify(data), {
    headers: {
      Link: [
        ...(next ? ['<https://api.github.com/next>; rel="next"'] : []),
        ...(lastPage ? [`<https://api.github.com/commits?page=${lastPage}>; rel="last"`] : []),
      ].join(', '),
    },
  });
type Handler = (url: URL) => Response | undefined | Promise<Response | undefined>;
async function using(
  handler: Handler,
  check: (history: History, requests: URL[]) => Promise<void>,
) {
  const original = globalThis.fetch,
    requests: URL[] = [],
    history = new History();
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const handled = await handler(url);
      if (handled) return handled;
      if (url.pathname.endsWith('/branches')) return response([ref('main', 'm')]);
      if (url.pathname.includes('/branches/')) return new Response('', { status: 404 });
      if (url.pathname.endsWith('/pulls')) return response([]);
      if (url.pathname.endsWith('/commits'))
        throw new Error(`Unexpected history request: ${url.pathname}${url.search}`);
      return response({ default_branch: 'main', stargazers_count: 0 });
    };
    await check(history, requests);
  } finally {
    history.cancel();
    globalThis.fetch = original;
  }
}
const histories = (requests: URL[]) =>
  requests
    .filter((url) => url.pathname.endsWith('/commits'))
    .map((url) => [url.searchParams.get('sha'), url.searchParams.get('page')]);
const gitSha = (n: number) => n.toString(16).padStart(40, '0');

for (const mode of ['squash', 'merge', 'gap'])
  test(`deleted feature ancestry is reconciled after a ${mode} update even with unloaded catalog heads`, async () => {
    const main = gitSha(1),
      root = gitSha(2),
      dev = gitSha(3),
      feature = gitSha(4),
      head = gitSha(5),
      dormant = gitSha(6),
      gap = gitSha(7);
    let updated = false;
    const baseline = [dated(main, '2026-11-02', root), dated(root, '2026-10-01')],
      oldDev = dated(dev, '2026-11-01', root),
      side = dated(feature, '2026-11-02', dev);
    await using(
      (url) => {
        if (url.pathname.endsWith('/branches'))
          return response([
            ref('main', main),
            ref('dev', updated ? head : dev),
            ref('dormant', dormant),
            ...(!updated ? [ref('feature', feature)] : []),
          ]);
        if (url.pathname.endsWith('/activity'))
          return response([push('feature', '2026-11-02'), push('dev', '2026-11-01')]);
        if (url.pathname.endsWith('/commits')) {
          const sha = url.searchParams.get('sha');
          if (sha === 'main') return response(baseline);
          if (sha === feature) return response([side, oldDev, baseline[1]]);
          if (sha === dev) return response([oldDev, baseline[1]]);
          if (sha === head)
            return response(
              mode === 'gap'
                ? [dated(head, '2026-11-02', gap)]
                : [
                    dated(head, '2026-11-02', dev, ...(mode === 'merge' ? [feature] : [])),
                    oldDev,
                    baseline[1],
                  ],
            );
          if (sha === gap) return response([dated(gap, '2026-11-01', dev), oldDev, baseline[1]]);
        }
      },
      async (h, requests) => {
        await h.open('a/b');
        const old = h.getSnapshot().commits.find((c) => c.sha === dev);
        assert.ok(h.getSnapshot().commits.some((c) => c.sha === feature));
        updated = true;
        await h.refresh();
        const state = h.getSnapshot();
        assert.ok(!state.branches.some((b) => b.name === 'feature'));
        assert.equal(
          state.commits.some((c) => c.sha === feature),
          mode === 'merge',
        );
        assert.equal(
          state.commits.find((c) => c.sha === dev),
          old,
          'keep the cached history of a surviving branch across its unresolved gap',
        );
        assert.ok(
          !histories(requests).some(([sha]) => sha === dormant),
          'a picker-only head must not force another history request',
        );
        if (mode === 'gap') {
          await h.loadMore([gap]);
          assert.ok(!h.getSnapshot().commits.some((c) => c.sha === feature));
          assert.equal(
            h.getSnapshot().commits.find((c) => c.sha === dev),
            old,
          );
        }
      },
    );
  });

for (const outcome of ['success', 'missing', 'limited'])
  test(`a retired parent response cannot restore orphan history after deletion (${outcome})`, async () => {
    const main = gitSha(11),
      root = gitSha(12),
      feature = gitSha(13),
      parent = gitSha(14);
    let updating = false;
    let enterMeta!: () => void,
      enterParent!: () => void,
      releaseMeta!: (value: Response) => void,
      releaseParent!: (value: Response) => void;
    const metaEntered = new Promise<void>((r) => (enterMeta = r)),
      parentEntered = new Promise<void>((r) => (enterParent = r)),
      metaGate = new Promise<Response>((r) => (releaseMeta = r)),
      parentGate = new Promise<Response>((r) => (releaseParent = r));
    await using(
      (url) => {
        if (url.pathname === '/repos/a/b' && updating) {
          enterMeta();
          return metaGate;
        }
        if (url.pathname.endsWith('/branches'))
          return response([ref('main', main), ...(!updating ? [ref('feature', feature)] : [])]);
        if (url.pathname.endsWith('/activity')) return response([push('feature', '2026-11-02')]);
        if (url.pathname.endsWith('/commits')) {
          const sha = url.searchParams.get('sha');
          if (sha === 'main')
            return response([dated(main, '2026-11-02', root), dated(root, '2026-10-01')]);
          if (sha === feature) return response([dated(feature, '2026-11-02', parent)]);
          if (sha === parent) {
            enterParent();
            return parentGate;
          }
        }
      },
      async (h) => {
        await h.open('a/b');
        updating = true;
        const refresh = h.refresh();
        await metaEntered;
        const loading = h.loadMore([parent]);
        await parentEntered;
        releaseMeta(response({ default_branch: 'main' }));
        await refresh;
        assert.ok(!h.getSnapshot().commits.some((c) => c.sha === feature));
        releaseParent(
          outcome === 'limited'
            ? new Response('', { status: 429, headers: { 'Retry-After': '30' } })
            : outcome === 'missing'
              ? new Response('', { status: 404 })
              : response([dated(parent, '2026-11-01', root)]),
        );
        await loading;
        assert.ok(!h.getSnapshot().commits.some((c) => c.sha === parent));
        assert.equal(h.getSnapshot().more, false);
        if (outcome === 'limited') {
          assert.match(h.getSnapshot().error, /rate limit/);
          assert.ok(h.getSnapshot().retryAt! > Date.now());
        } else assert.equal(h.getSnapshot().error, '');
      },
    );
  });

for (const pending of ['lookup', 'history'])
  test(`late activity ${pending} cannot resurrect a branch removed by a completed refresh`, async () => {
    const main = gitSha(21),
      root = gitSha(22),
      feature = gitSha(23);
    let updating = false,
      activityPage = 0;
    let enterMeta!: () => void,
      enterStale!: () => void,
      releaseMeta!: (value: Response) => void,
      releaseStale!: (value: Response) => void;
    const metaEntered = new Promise<void>((r) => (enterMeta = r)),
      staleEntered = new Promise<void>((r) => (enterStale = r)),
      metaGate = new Promise<Response>((r) => (releaseMeta = r)),
      staleGate = new Promise<Response>((r) => (releaseStale = r));
    await using(
      (url) => {
        if (url.pathname === '/repos/a/b' && updating) {
          enterMeta();
          return metaGate;
        }
        if (url.pathname.endsWith('/branches'))
          return response([
            ref('main', main),
            ...(!updating && pending === 'history' ? [ref('feature', feature)] : []),
          ]);
        if (url.pathname.endsWith('/activity'))
          return activityPage++ === 0
            ? new Response('[]', {
                headers: { Link: '<https://api.github.com/next?after=older>; rel="next"' },
              })
            : response([push('feature', '2026-11-02')]);
        if (url.pathname.endsWith('/branches/feature')) {
          enterStale();
          return staleGate;
        }
        if (url.pathname.endsWith('/commits')) {
          const sha = url.searchParams.get('sha');
          if (sha === 'main')
            return response([dated(main, '2026-11-02', root), dated(root, '2026-10-01')]);
          if (sha === feature) {
            if (pending === 'history') {
              enterStale();
              return staleGate;
            }
            return response([dated(feature, '2026-11-02', root)]);
          }
        }
      },
      async (h) => {
        await h.open('a/b');
        updating = true;
        const refresh = h.refresh();
        await metaEntered;
        const discovery = h.loadMore(['activity']);
        await staleEntered;
        releaseMeta(response({ default_branch: 'main' }));
        await refresh;
        releaseStale(
          pending === 'lookup'
            ? response(ref('feature', feature))
            : response([dated(feature, '2026-11-02', root)]),
        );
        await discovery;
        assert.ok(!h.getSnapshot().branches.some((b) => b.name === 'feature'));
        assert.ok(!h.getSnapshot().commits.some((c) => c.sha === feature));
        assert.equal(h.getSnapshot().discoveryError, '');
      },
    );
  });

test('a late branch-picker page cannot restore a deleted ref after an authoritative refresh', async () => {
  const main = gitSha(31),
    root = gitSha(32),
    feature = gitSha(33);
  let updating = false,
    page2Requests = 0;
  let enterMeta!: () => void,
    enterPage!: () => void,
    releaseMeta!: (value: Response) => void,
    releasePage!: (value: Response) => void;
  const metaEntered = new Promise<void>((r) => (enterMeta = r)),
    pageEntered = new Promise<void>((r) => (enterPage = r)),
    metaGate = new Promise<Response>((r) => (releaseMeta = r)),
    pageGate = new Promise<Response>((r) => (releasePage = r));
  await using(
    (url) => {
      if (url.pathname === '/repos/a/b' && updating) {
        enterMeta();
        return metaGate;
      }
      if (url.pathname.endsWith('/branches')) {
        if (url.searchParams.get('page') === '2' && ++page2Requests === 1) {
          enterPage();
          return pageGate;
        }
        return response([ref('main', main)], !updating);
      }
      if (url.pathname.endsWith('/activity')) return response([]);
      if (url.pathname.endsWith('/commits')) return response([commit(main, root), commit(root)]);
    },
    async (h) => {
      await h.open('a/b');
      updating = true;
      const refresh = h.refresh();
      await metaEntered;
      const page = h.loadBranches();
      await pageEntered;
      releaseMeta(response({ default_branch: 'main' }));
      await refresh;
      releasePage(response([ref('feature', feature)]));
      await page;
      assert.ok(!h.getSnapshot().branches.some((b) => b.name === 'feature'));
      assert.equal(h.getSnapshot().moreBranches, false);
    },
  );
});

test('a pending boundary load does not postpone removing a merged and deleted branch', async () => {
  const main = gitSha(61),
    root = gitSha(62),
    feature = gitSha(63),
    parent = gitSha(64);
  let deleted = false;
  let enterParent!: () => void, releaseParent!: (value: Response) => void;
  const parentEntered = new Promise<void>((r) => (enterParent = r)),
    parentGate = new Promise<Response>((r) => (releaseParent = r));
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', main), ...(deleted ? [] : [ref('feature', feature)])]);
      if (url.pathname.endsWith('/activity')) return response([]);
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        if (sha === 'main') return response([commit(main, root)]);
        if (sha === root) {
          enterParent();
          return parentGate;
        }
      }
    },
    async (h) => {
      await h.open('a/b');
      assert.ok(h.getSnapshot().branches.some((b) => b.name === 'feature'));
      const boundary = h.loadMore([root]);
      await parentEntered;
      assert.equal(h.getSnapshot().busy, true);
      deleted = true;
      await h.refresh();
      assert.deepEqual(
        h.getSnapshot().branches.map((b) => b.name),
        ['main'],
      );
      releaseParent(response([commit(root, parent), commit(parent)]));
      await boundary;
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === root));
      assert.ok(!h.getSnapshot().branches.some((b) => b.name === 'feature'));
    },
  );
});

test('branch state requests bypass the browser HTTP cache', async () => {
  const original = globalThis.fetch,
    modes = new Map<string, RequestCache | undefined>(),
    history = new History();
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      modes.set(`${url.pathname}?${url.searchParams.get('page') ?? ''}`, init?.cache);
      if (url.pathname.endsWith('/branches')) return response([ref('main', 'm')]);
      if (url.pathname.endsWith('/activity')) return response([]);
      if (url.pathname.endsWith('/commits')) return response([commit('m')]);
      return response({ default_branch: 'main', stargazers_count: 0 });
    };
    await history.open('a/b');
    await history.refresh();
    assert.equal(modes.get('/repos/a/b/branches?1'), 'no-cache');
    assert.equal(modes.get('/repos/a/b/commits?1'), undefined);
    await history.findBranch('missing');
    assert.equal(modes.get('/repos/a/b/branches/missing?'), 'no-cache');
  } finally {
    history.cancel();
    globalThis.fetch = original;
  }
});

for (const source of ['ranking', 'search'])
  test(`a late ${source} lookup cannot restore a removed ref or select it`, async () => {
    const main = gitSha(41),
      root = gitSha(42),
      feature = gitSha(43);
    let updating = false;
    let enterMeta!: () => void,
      enterLookup!: () => void,
      releaseMeta!: (value: Response) => void,
      releaseLookup!: (value: Response) => void;
    const metaEntered = new Promise<void>((r) => (enterMeta = r)),
      lookupEntered = new Promise<void>((r) => (enterLookup = r)),
      metaGate = new Promise<Response>((r) => (releaseMeta = r)),
      lookupGate = new Promise<Response>((r) => (releaseLookup = r));
    await using(
      (url) => {
        if (url.pathname === '/repos/a/b' && updating) {
          enterMeta();
          return metaGate;
        }
        if (url.pathname.endsWith('/branches'))
          return response([ref('main', main)], !updating && source === 'ranking');
        if (url.pathname.endsWith('/branches/feature')) {
          enterLookup();
          return lookupGate;
        }
        if (url.pathname.endsWith('/activity')) return response([]);
        if (url.pathname.endsWith('/pulls'))
          return response([
            {
              id: 1,
              merged_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              base: { ref: 'feature' },
            },
          ]);
        if (url.pathname.endsWith('/commits')) return response([commit(main, root), commit(root)]);
      },
      async (h) => {
        await h.open('a/b');
        updating = true;
        const refresh = h.refresh();
        await metaEntered;
        const lookup = source === 'ranking' ? h.loadRecommendations() : h.findBranch('feature');
        await lookupEntered;
        releaseMeta(response({ default_branch: 'main' }));
        await refresh;
        releaseLookup(response(ref('feature', feature)));
        const result = await lookup;
        assert.ok(!h.getSnapshot().branches.some((b) => b.name === 'feature'));
        assert.equal(h.getSnapshot().base, 'main');
        if (source === 'search') assert.equal(result, false);
      },
    );
  });

test('a parent pruned after branch deletion can be restored when a later merge needs it', async () => {
  let phase: 'initial' | 'deleted' | 'merged' = 'initial';
  const main = gitSha(1),
    root = gitSha(2),
    parent = gitSha(1100),
    feature = gitSha(1000),
    merge = gitSha(5000),
    head = gitSha(5001);
  const baseline = [dated(main, '2026-11-01', root), dated(root, '2026-10-01')];
  const side = Array.from({ length: 100 }, (_, i) =>
    dated(
      gitSha(1000 + i),
      new Date(Date.parse('2026-10-31T23:00:00Z') - i * 60000).toISOString(),
      i === 99 ? parent : gitSha(1001 + i),
    ),
  );
  const merged = [
    ...Array.from({ length: 99 }, (_, i) =>
      dated(
        gitSha(5001 + i),
        new Date(Date.parse('2026-11-02T00:00:00Z') - i * 60000).toISOString(),
        i === 98 ? merge : gitSha(5002 + i),
      ),
    ),
    dated(merge, '2026-11-01T22:10:00Z', main, feature),
  ];
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([
          ref('main', phase === 'merged' ? head : main),
          ...(phase === 'initial' ? [ref('feature', feature)] : []),
        ]);
      if (url.pathname.endsWith('/activity'))
        return response(phase === 'initial' ? [push('feature', '2026-11-01')] : []);
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        if (sha === 'main') return response(baseline);
        if (sha === head) return response(merged, true);
        if (sha === feature) return response(side, true);
        if (sha === parent)
          return response([dated(parent, '2026-10-31T20:00:00Z', root), baseline[1]]);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      await h.loadMore([parent]);
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === parent));
      phase = 'deleted';
      await h.refresh();
      assert.deepEqual(new Set(h.getSnapshot().commits.map((c) => c.sha)), new Set([main, root]));
      phase = 'merged';
      await h.refresh();
      await h.loadMore([feature]);
      assert.ok(
        h.getSnapshot().frontiers.some((f) => f.sources.includes(parent)),
        'a prior successful query must not hide a now-missing parent',
      );
      await Promise.all([h.loadMore([parent]), h.loadMore([parent])]);
      const state = h.getSnapshot(),
        known = new Set(state.commits.map((c) => c.sha));
      assert.ok(known.has(parent));
      assert.equal(state.more, false);
      for (const c of state.commits) for (const p of c.parents) assert.ok(known.has(p.sha));
      assert.equal(
        histories(requests).filter(([sha]) => sha === parent).length,
        1,
        'restore the immutable cached page without another HTTP request',
      );
    },
  );
});

for (const invalid of ['empty', 'wrong-head'])
  test(`an immutable ${invalid} parent response is not cached and Retry can recover`, async () => {
    const main = gitSha(1),
      parent = gitSha(2),
      wrong = gitSha(3);
    let failed = true;
    await using(
      (url) => {
        if (url.pathname.endsWith('/branches')) return response([ref('main', main)]);
        if (url.pathname.endsWith('/activity')) return response([]);
        if (url.pathname.endsWith('/commits'))
          return response(
            url.searchParams.get('sha') === 'main'
              ? [commit(main, parent)]
              : failed
                ? invalid === 'empty'
                  ? []
                  : [commit(wrong)]
                : [commit(parent)],
          );
      },
      async (h, requests) => {
        await h.open('a/b');
        await h.loadMore([parent]);
        assert.match(h.getSnapshot().error, /requested commit/);
        assert.ok(!h.getSnapshot().commits.some((c) => c.sha === wrong));
        failed = false;
        await h.retry();
        assert.equal(h.getSnapshot().error, '');
        assert.equal(h.getSnapshot().more, false);
        assert.ok(h.getSnapshot().commits.some((c) => c.sha === parent));
        assert.equal(histories(requests).filter(([sha]) => sha === parent).length, 2);
      },
    );
  });

test('a refresh missing its immutable head keeps the old graph and retries the head on the next poll', async () => {
  const main = gitSha(1),
    root = gitSha(2),
    head = gitSha(3);
  let changed = false,
    failed = true;
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches')) return response([ref('main', changed ? head : main)]);
      if (url.pathname.endsWith('/activity')) return response([]);
      if (url.pathname.endsWith('/commits'))
        return response(
          url.searchParams.get('sha') === 'main' || failed
            ? [commit(main, root), commit(root)]
            : [commit(head, main), commit(main, root), commit(root)],
        );
    },
    async (h, requests) => {
      await h.open('a/b');
      const before = h.getSnapshot();
      changed = true;
      await h.refresh();
      assert.equal(h.getSnapshot().baseHead, main);
      assert.equal(h.getSnapshot().commits, before.commits);
      assert.equal(h.getSnapshot().branches, before.branches);
      assert.match(h.getSnapshot().refreshError, /requested commit/);
      failed = false;
      await h.refresh();
      assert.equal(h.getSnapshot().baseHead, head);
      assert.equal(h.getSnapshot().refreshError, '');
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === head));
      assert.equal(histories(requests).filter(([sha]) => sha === head).length, 2);
    },
  );
});

test('immutable forward pages do not need to contain the pinned head', async () => {
  const head = gitSha(1),
    middle = gitSha(2),
    root = gitSha(3);
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches')) return response([ref('main', head)]);
      if (url.pathname.endsWith('/activity')) return response([]);
      if (url.pathname.endsWith('/commits'))
        return url.searchParams.get('page') === '3'
          ? response([commit(root)])
          : url.searchParams.get('page') === '2'
            ? response([commit(middle, root)], true, 3)
            : response([commit(head, middle)], true, 3);
    },
    async (h) => {
      await h.open('a/b');
      await h.setDirection(true);
      await h.loadMore();
      await h.loadMore();
      assert.equal(h.getSnapshot().error, '');
      assert.equal(h.getSnapshot().more, false);
      assert.deepEqual(
        new Set(h.getSnapshot().commits.map((c) => c.sha)),
        new Set([head, middle, root]),
      );
    },
  );
});

test('a since-filtered immutable branch page may legitimately omit an old head', async () => {
  const main = gitSha(1),
    root = gitSha(2),
    old = gitSha(3);
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches')) return response([ref('main', main), ref('old', old)]);
      if (url.pathname.endsWith('/activity')) return response([push('old', '2026-10-31')]);
      if (url.pathname.endsWith('/commits'))
        return response(
          url.searchParams.get('sha') === 'main'
            ? [dated(main, '2026-11-01', root), dated(root, '2026-10-01')]
            : [],
        );
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.equal(h.getSnapshot().error, '');
      assert.equal(h.getSnapshot().discoveryError, '');
      assert.ok(!h.getSnapshot().commits.some((c) => c.sha === old));
      assert.ok(
        requests.some(
          (url) => url.searchParams.get('sha') === old && url.searchParams.has('since'),
        ),
      );
    },
  );
});

test('a crossed long path keeps loading across layouts until it rejoins known ancestry above the viewport', async () => {
  for (const reverse of [false, true]) {
    const date = (index: number) =>
      new Date(Date.parse('2026-11-01T00:00:00Z') - index * 60000).toISOString();
    const main = (i: number) =>
      dated(
        `m${i}`,
        date(i),
        ...(i < 999 ? [`m${i + 1}`] : []),
        ...(i === 40 ? ['g0'] : i === 950 && !reverse ? ['below-viewport'] : []),
      );
    const side = (i: number) => dated(`g${i}`, date(40.5 + i), i === 299 ? 'm500' : `g${i + 1}`);
    await using(
      (url) => {
        if (url.pathname.endsWith('/branches')) return response([ref('main', 'm0')]);
        if (url.pathname.endsWith('/activity')) return response([]);
        if (url.pathname.endsWith('/commits')) {
          const sha = url.searchParams.get('sha')!,
            isSide = sha.startsWith('g'),
            index = sha === 'main' ? 0 : Number(sha.slice(1));
          return response(
            Array.from({ length: Math.min(100, (isSide ? 300 : 1000) - index) }, (_, n) =>
              (isSide ? side : main)(index + n),
            ),
          );
        }
      },
      async (h, requests) => {
        await h.open('a/b');
        for (let i = 100; i < 1000; i += 100) await h.loadMore([`m${i}`]);
        // The jump accepted one page; its successor is still above the viewport.
        await h.loadMore(['g0']);
        assert.equal(h.getSnapshot().commits.length, 1100);
        const tasks: Promise<void>[] = [];
        const scan = () => {
          const state = h.getSnapshot();
          if (state.error) return;
          const data = layout(state.commits, new Map(), 'm0'),
            ordered = reverse ? [...data.ordered].reverse() : data.ordered;
          const positions = new Map(
            ordered.map((c, i) => [
              c.sha,
              { x: 48 + (data.lanes.get(c.sha) || 0) * 34, y: 100 + i * ROW },
            ]),
          );
          const top = positions.get(reverse ? 'm10' : 'm700')!.y - 100;
          const ready = visibleHistorySources(
            state.frontiers,
            positions,
            { left: 0, top, width: 1280, height: 796, inset: 80 },
            state.pendingSources,
          );
          if (ready.length) tasks.push(h.loadMore(ready));
        };
        const stop = h.subscribe(scan);
        try {
          scan();
          for (let i = 0; i < 20; i++) await turn();
          await Promise.all(tasks);
          assert.equal(h.getSnapshot().commits.length, 1300, reverse ? 'Newer' : 'Older');
          assert.deepEqual(
            histories(requests).filter(([sha]) => sha?.startsWith('g')),
            [
              ['g0', '1'],
              ['g100', '1'],
              ['g200', '1'],
            ],
          );
          assert.ok(!histories(requests).some(([sha]) => sha === 'below-viewport'));
          assert.ok(
            !h
              .getSnapshot()
              .frontiers.some((frontier) =>
                frontier.sources.some((source) => source.startsWith('g')),
              ),
          );
        } finally {
          stop();
        }
      },
    );
  }
});

test('initial history ignores alphabetically listed branch heads and starts only at the chosen branch', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('2.0.x'), ref('2.1.x'), ref('feature'), ref('main', 'm')], true);
      if (url.pathname.endsWith('/commits') && url.searchParams.get('sha') === 'main')
        return response([commit('m', 'parent')], true);
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.equal(h.getSnapshot().base, 'main');
      assert.deepEqual(histories(requests), [['main', '1']]);
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['m'],
      );
      assert.deepEqual(h.getSnapshot().frontiers, [{ sha: 'm', sources: ['parent'] }]);
    },
  );
});

test('encountered merge parents are fetched by SHA even without a live branch ref', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits')) {
        if (url.searchParams.get('sha') === 'main')
          return response([
            commit('m', 'trunk', 'deleted-side'),
            commit('trunk', 'root'),
            commit('root'),
          ]);
        if (url.searchParams.get('sha') === 'deleted-side')
          return response([commit('deleted-side', 'root'), commit('root')], true);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.deepEqual(h.getSnapshot().frontiers, [{ sha: 'm', sources: ['deleted-side'] }]);
      await Promise.all([h.loadMore(['deleted-side']), h.loadMore(['deleted-side'])]);
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['deleted-side', '1'],
      ]);
      assert.equal(h.getSnapshot().more, false);
      assert.equal(h.getSnapshot().commits.filter((c) => c.sha === 'root').length, 1);
      const count = requests.length;
      await h.loadMore();
      assert.equal(requests.length, count);
    },
  );
});

test('a short unresolved path loads independently of a longer visible path', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits')) {
        if (url.searchParams.get('sha') === 'main')
          return response(
            [
              commit('m', 'long', 'short'),
              commit('short', 'short-parent'),
              commit('long', 'long-parent'),
            ],
            true,
          );
        if (url.searchParams.get('sha') === 'short-parent')
          return response([commit('short-parent')]);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      await h.loadMore(['short-parent']);
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['short-parent', '1'],
      ]);
      assert.ok(h.getSnapshot().frontiers.some((f) => f.sources.includes('long-parent')));
      assert.ok(!h.getSnapshot().frontiers.some((f) => f.sources.includes('short-parent')));
    },
  );
});

test('parallel unknown parent paths deduplicate their shared commits when they join', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits'))
        return url.searchParams.get('sha') === 'main'
          ? response([commit('m', 'a', 'b')])
          : url.searchParams.get('sha') === 'a'
            ? response([commit('a', 'b'), commit('b')])
            : url.searchParams.get('sha') === 'b'
              ? response([commit('b')])
              : undefined;
    },
    async (h, requests) => {
      await h.open('a/b');
      await h.loadMore(['a', 'b', 'a']);
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['a', '1'],
        ['b', '1'],
      ]);
      assert.equal(h.getSnapshot().more, false);
      assert.equal(h.getSnapshot().commits.filter((c) => c.sha === 'b').length, 1);
    },
  );
});

test('unknown branch names cannot be injected as history cursors', async () => {
  await using(
    (url) => (url.pathname.endsWith('/commits') ? response([commit('m', 'parent')]) : undefined),
    async (h, requests) => {
      await h.open('a/b');
      await h.loadMore(['2.0.x']);
      assert.deepEqual(histories(requests), [['main', '1']]);
    },
  );
});

test('branch name pagination does not fetch histories or keep an exhausted graph loading', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return url.searchParams.get('page') === '1'
          ? response([ref('main', 'm')], true)
          : response([ref('2.0.x', 'old')]);
      if (url.pathname.endsWith('/commits'))
        return response([commit(url.searchParams.get('sha') === 'main' ? 'm' : 'old')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.equal(h.getSnapshot().more, false);
      assert.equal(h.getSnapshot().moreBranches, true);
      await h.loadMore();
      assert.deepEqual(histories(requests), [['main', '1']]);
      await h.loadBranches();
      assert.equal(h.getSnapshot().moreBranches, false);
      assert.deepEqual(histories(requests), [['main', '1']]);
      await h.chooseBase('2.0.x');
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['old'],
      );
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['2.0.x', '1'],
      ]);
    },
  );
});

test('continuation errors pause automatic loading and Retry resumes the same parent SHA', async () => {
  let fail = true;
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits')) {
        if (url.searchParams.get('sha') === 'main') return response([commit('m', 'side')]);
        if (url.searchParams.get('sha') === 'side')
          return fail
            ? new Response('', { status: 429, headers: { 'Retry-After': '0' } })
            : response([commit('side')]);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      await h.loadMore(['side']);
      assert.match(h.getSnapshot().error, /rate limit/);
      await h.loadMore(['side']);
      assert.equal(histories(requests).length, 2);
      fail = false;
      await h.retry();
      assert.equal(h.getSnapshot().error, '');
      assert.equal(h.getSnapshot().more, false);
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['side', '1'],
        ['side', '1'],
      ]);
    },
  );
});

test('rate reset blocks premature Retry and permits it after the deadline', async () => {
  const originalNow = Date.now;
  let clock = originalNow(),
    fail = true;
  try {
    Date.now = () => clock;
    await using(
      (url) => {
        if (url.pathname.endsWith('/commits'))
          return url.searchParams.get('sha') === 'main'
            ? response([commit('m', 'parent')])
            : fail
              ? new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
              : response([commit('parent')]);
      },
      async (h, requests) => {
        await h.open('a/b');
        await h.loadMore();
        await h.retry();
        assert.equal(histories(requests).length, 2);
        clock += 2100;
        fail = false;
        await h.retry();
        assert.equal(histories(requests).length, 3);
        assert.equal(h.getSnapshot().error, '');
      },
    );
  } finally {
    Date.now = originalNow;
  }
});

test('clearing history cancels in-flight results and cannot restore private history', async () => {
  let release!: (response: Response) => void;
  await using(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    async (h) => {
      const opening = h.open('private/repo', 'test-only-token');
      h.clear();
      release(response({ default_branch: 'main' }));
      await opening;
      assert.equal(h.getSnapshot().repo, '');
      assert.equal(h.getSnapshot().busy, false);
      assert.deepEqual(h.getSnapshot().commits, []);
      assert.equal(h.getSnapshot().meta, null);
    },
  );
});

test('oldest-first starts at the last page and advances toward newer pages under one pinned head', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('2.0.x', 'old'), ref('main', 'm')]);
      if (url.pathname.endsWith('/commits')) {
        const page = url.searchParams.get('page');
        if (page === '1') return response([commit('m', 'middle')], true, 3);
        if (page === '3') return response([commit('root')]);
        if (page === '2') return response([commit('middle', 'root')], true, 3);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      await h.setDirection(true);
      assert.equal(h.getSnapshot().reverse, true);
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['root'],
      );
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['main', '1'],
        ['m', '3'],
      ]);
      await h.loadMore();
      assert.deepEqual(h.getSnapshot().frontiers, [{ sha: 'middle', sources: ['page:1'] }]);
      await h.loadMore();
      assert.equal(h.getSnapshot().more, false);
      const chronological = layout(h.getSnapshot().commits)
        .ordered.reverse()
        .map((c) => c.sha);
      assert.deepEqual(chronological, ['root', 'middle', 'm']);
      assert.deepEqual(histories(requests).slice(-2), [
        ['m', '2'],
        ['m', '1'],
      ]);
    },
  );
});

test('single-page histories reverse without extra page requests and both ends stop at roots', async () => {
  await using(
    (url) =>
      url.pathname.endsWith('/commits')
        ? response([commit('m', 'root'), commit('root')])
        : undefined,
    async (h, requests) => {
      await h.open('a/b');
      await h.setDirection(true);
      await h.loadMore();
      assert.equal(h.getSnapshot().more, false);
      assert.equal(histories(requests).length, 2);
      await h.setDirection(false);
      assert.equal(h.getSnapshot().reverse, false);
      assert.equal(h.getSnapshot().more, false);
    },
  );
});

test('oldest-first refuses unbounded downloads when the API omits last-page pagination', async () => {
  await using(
    (url) =>
      url.pathname.endsWith('/commits') ? response([commit('m', 'parent')], true) : undefined,
    async (h, requests) => {
      await h.open('a/b');
      await h.setDirection(true);
      assert.match(h.getSnapshot().error, /oldest history page/);
      assert.equal(h.getSnapshot().commits.length, 0);
      assert.equal(histories(requests).length, 2);
    },
  );
});

test('changing direction cancels stale parent fetches and does not mix recent data into oldest history', async () => {
  let release!: (response: Response) => void;
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits')) {
        if (url.searchParams.get('sha') === 'parent')
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        return url.searchParams.get('page') === '2'
          ? response([commit('root')])
          : response([commit('m', 'parent')], true, 2);
      }
    },
    async (h) => {
      await h.open('a/b');
      const pending = h.loadMore(['parent']);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await h.setDirection(true);
      release(response([commit('parent', 'root')]));
      await pending;
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['root'],
      );
      assert.equal(h.getSnapshot().reverse, true);
      assert.equal(h.getSnapshot().busy, false);
    },
  );
});

test('an initial commit request can be retried without selecting unrelated branches', async () => {
  let fail = true;
  await using(
    (url) =>
      url.pathname.endsWith('/commits')
        ? fail
          ? new Response('', { status: 500 })
          : response([commit('m')])
        : undefined,
    async (h, requests) => {
      await h.open('a/b');
      assert.ok(h.getSnapshot().error);
      fail = false;
      await h.retry();
      assert.equal(h.getSnapshot().error, '');
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['main', '1'],
      ]);
    },
  );
});

test('failed branch name pagination retries only names, not commit history', async () => {
  let fail = true;
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return url.searchParams.get('page') === '1'
          ? response([ref('main', 'm')], true)
          : fail
            ? new Response('', { status: 500 })
            : response([ref('other')]);
      if (url.pathname.endsWith('/commits')) return response([commit('m')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      await h.loadBranches();
      assert.ok(h.getSnapshot().error);
      fail = false;
      await h.retry();
      assert.equal(h.getSnapshot().error, '');
      assert.deepEqual(histories(requests), [['main', '1']]);
    },
  );
});

test('main is selected beyond the first names page and PR ranking is deferred', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches')) return response([ref('develop', 'd')], true);
      if (url.pathname.endsWith('/branches/main')) return response(ref('main', 'm'));
      if (url.pathname.endsWith('/commits')) return response([commit('m')]);
      if (url.pathname === '/repos/a/b') return response({ default_branch: 'develop' });
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.equal(h.getSnapshot().base, 'main');
      assert.ok(!requests.some((url) => url.pathname.endsWith('/pulls')));
      await h.loadRecommendations();
      assert.equal(h.getSnapshot().ranking.complete, true);
      assert.deepEqual(histories(requests), [['main', '1']]);
    },
  );
});

test('PR ranking filters deleted refs and exact lookup can select a branch outside recommendations', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches')) return response([ref('master', 'm')]);
      if (url.pathname.endsWith('/branches/hidden%2Fwork'))
        return response(ref('hidden/work', 'h'));
      if (url.pathname.endsWith('/pulls'))
        return response([
          {
            id: 1,
            merged_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            base: { ref: 'deleted' },
          },
        ]);
      if (url.pathname.endsWith('/commits'))
        return response([commit(url.searchParams.get('sha') === 'master' ? 'm' : 'h')]);
      if (url.pathname === '/repos/a/b') return response({ default_branch: 'master' });
    },
    async (h) => {
      await h.open('a/b');
      await h.loadRecommendations();
      assert.equal(h.getSnapshot().ranking.counts.deleted, 1);
      assert.ok(!h.getSnapshot().branches.some((b) => b.name === 'deleted'));
      assert.equal(await h.findBranch('hidden/work'), true);
      assert.equal(h.getSnapshot().base, 'hidden/work');
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['h'],
      );
    },
  );
});

test('PR scans remain bounded and never cause history requests for ranked branch names', async () => {
  let pulls = 0;
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ref('release', 'r')]);
      if (url.pathname.endsWith('/pulls')) {
        pulls++;
        const date = pulls === 4 ? '2020-01-01T00:00:00Z' : new Date().toISOString();
        return response(
          [{ id: pulls, merged_at: date, updated_at: date, base: { ref: 'release' } }],
          true,
        );
      }
      if (url.pathname.endsWith('/commits')) return response([commit('m')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.equal(pulls, 0);
      await h.loadRecommendations();
      assert.equal(pulls, 3);
      assert.equal(h.getSnapshot().ranking.complete, false);
      await h.loadRecommendations();
      assert.equal(pulls, 4);
      assert.equal(h.getSnapshot().ranking.complete, true);
      assert.equal(h.getSnapshot().ranking.counts.release, 3);
      assert.deepEqual(histories(requests), [['main', '1']]);
    },
  );
});

test('oldest-first page failures retry the same page before advancing toward newer history', async () => {
  let fail = true;
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits')) {
        const page = url.searchParams.get('page');
        if (page === '1') return response([commit('m', 'middle')], true, 3);
        if (page === '3') return response([commit('root')]);
        if (page === '2')
          return fail ? new Response('', { status: 500 }) : response([commit('middle', 'root')]);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      await h.setDirection(true);
      await h.loadMore();
      assert.ok(h.getSnapshot().error);
      assert.deepEqual(h.getSnapshot().frontiers, [{ sha: 'root', sources: ['page:2'] }]);
      fail = false;
      await h.retry();
      assert.equal(h.getSnapshot().error, '');
      assert.deepEqual(histories(requests).slice(-2), [
        ['m', '2'],
        ['m', '2'],
      ]);
      assert.deepEqual(h.getSnapshot().frontiers, [{ sha: 'middle', sources: ['page:1'] }]);
    },
  );
});

const dated = (sha: string, date: string, ...parents: string[]): Commit => ({
  ...commit(sha, ...parents),
  commit: { ...commit(sha).commit, committer: { date } },
});
const push = (name: string, date: string) => ({
  ref: `refs/heads/${name}`,
  timestamp: date,
  activity_type: 'push',
});

test('recent push activity discovers independent 22.x history without querying alphabetically early 2.x branches', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('2.0.x', 'old'), ref('22.2.x', 'release'), ref('main', 'm')]);
      if (url.pathname.endsWith('/activity'))
        return response([push('22.2.x', '2026-10-28'), push('main', '2026-10-28')]);
      if (url.pathname.endsWith('/commits')) {
        if (url.searchParams.get('sha') === 'main')
          return response([dated('m', '2026-10-29', 'base'), dated('base', '2026-10-25', 'older')]);
        if (url.searchParams.get('sha') === 'release') {
          assert.equal(url.searchParams.get('since'), '2026-10-25T00:00:00.000Z');
          return response([dated('release', '2026-10-28', 'side-parent')]);
        }
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['release', '1'],
      ]);
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'release'));
      assert.ok(h.getSnapshot().frontiers.some((f) => f.sources.includes('side-parent')));
      assert.equal(h.getSnapshot().discoveryError, '');
    },
  );
});

test('unknown active refs are resolved lazily and deleted refs are not restored', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/activity'))
        return response([push('removed', '2026-10-28'), push('hidden/release', '2026-10-28')]);
      if (url.pathname.endsWith('/branches/hidden%2Frelease'))
        return response(ref('hidden/release', 'r'));
      if (url.pathname.endsWith('/commits'))
        return url.searchParams.get('sha') === 'main'
          ? response([dated('m', '2026-10-29', 'base'), dated('base', '2026-10-25')])
          : response([dated('r', '2026-10-28', 'base')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.ok(h.getSnapshot().branches.some((ref) => ref.name === 'hidden/release'));
      assert.ok(!h.getSnapshot().branches.some((ref) => ref.name === 'removed'));
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['r', '1'],
      ]);
      assert.equal(h.getSnapshot().more, false);
    },
  );
});

test('recent pushes of ancient heads cannot inject old commits into the current date window', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('2.0.x', 'old'), ref('main', 'm')]);
      if (url.pathname.endsWith('/activity')) return response([push('2.0.x', '2026-10-28')]);
      if (url.pathname.endsWith('/commits'))
        return url.searchParams.get('sha') === 'main'
          ? response([dated('m', '2026-10-29')])
          : response([dated('old', '2016-10-01')]);
    },
    async (h) => {
      await h.open('a/b');
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['m'],
      );
      assert.equal(h.getSnapshot().more, false);
    },
  );
});

test('activity scans and histories stay bounded and older events become eligible as the base window expands', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ref('22.2.x', 'r22'), ref('22.1.x', 'r21')]);
      if (url.pathname.endsWith('/activity'))
        return !url.searchParams.has('after')
          ? new Response(
              JSON.stringify([push('22.2.x', '2026-10-28'), push('22.1.x', '2026-09-25')]),
              { headers: { Link: '<https://api.github.com/next?after=older>; rel="next"' } },
            )
          : response([]);
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        if (sha === 'main') return response([dated('m', '2026-10-29', 'older')]);
        if (sha === 'older') return response([dated('older', '2026-09-20')]);
        if (sha === 'r22') return response([dated('r22', '2026-10-29', 'm')]);
        if (sha === 'r21') return response([dated('r21', '2026-09-25', 'older')]);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.ok(!h.getSnapshot().commits.some((c) => c.sha === 'r21'));
      await h.loadMore(['older']);
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'r21'));
      assert.equal(requests.filter((url) => url.pathname.endsWith('/activity')).length, 2);
    },
  );
});

test('activity errors preserve base history, stop automatic retries, and allow explicit retry', async () => {
  let fail = true;
  await using(
    (url) => {
      if (url.pathname.endsWith('/activity'))
        return fail ? new Response('', { status: 403 }) : response([]);
      if (url.pathname.endsWith('/commits'))
        return url.searchParams.get('sha') === 'main'
          ? response([dated('m', '2026-10-29', 'older')])
          : response([dated('older', '2026-10-25')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.equal(h.getSnapshot().error, '');
      assert.match(h.getSnapshot().discoveryError, /denied access/);
      await h.loadMore(['older']);
      assert.equal(requests.filter((url) => url.pathname.endsWith('/activity')).length, 1);
      fail = false;
      await h.retryDiscovery();
      assert.equal(h.getSnapshot().discoveryError, '');
      assert.equal(h.getSnapshot().commits.length, 2);
    },
  );
});

test('clearing history while activity is loading cannot restore the previous repository', async () => {
  let release!: (response: Response) => void, ready!: (value?: unknown) => void;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  await using(
    (url) => {
      if (url.pathname.endsWith('/activity')) {
        ready();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      if (url.pathname.endsWith('/commits')) return response([dated('m', '2026-10-29')]);
    },
    async (h) => {
      const opening = h.open('a/b');
      await started;
      h.clear();
      release(response([push('22.2.x', '2026-10-29')]));
      await opening;
      assert.equal(h.getSnapshot().repo, '');
      assert.equal(h.getSnapshot().commits.length, 0);
      assert.equal(h.getSnapshot().discoveryError, '');
    },
  );
});

test('active branch histories are batched by push time rather than by name', async () => {
  const names = ['z', 'a', 'q', 'v', 'c'];
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ...names.map((name) => ref(name, `head-${name}`))]);
      if (url.pathname.endsWith('/activity'))
        return response(names.map((name, index) => push(name, `2026-10-28T12:00:0${5 - index}Z`)));
      if (url.pathname.endsWith('/commits'))
        return url.searchParams.get('sha') === 'main'
          ? response([dated('m', '2026-10-29', 'root'), dated('root', '2026-10-25')])
          : response([dated(url.searchParams.get('sha')!, '2026-10-28', 'root')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.deepEqual(
        histories(requests).map(([sha]) => sha),
        ['main', 'head-z', 'head-a', 'head-q'],
      );
      assert.ok(h.getSnapshot().frontiers.some((f) => f.sources.includes('activity')));
      await h.loadMore(['activity']);
      assert.deepEqual(
        histories(requests).map(([sha]) => sha),
        ['main', 'head-z', 'head-a', 'head-q', 'head-v', 'head-c'],
      );
      assert.equal(h.getSnapshot().more, false);
    },
  );
});

test('oldest-first never inserts current active heads into its historical starting window', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ref('22.2.x', 'r')]);
      if (url.pathname.endsWith('/activity')) return response([push('22.2.x', '2026-10-28')]);
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha'),
          page = url.searchParams.get('page');
        if (sha === 'r') return response([dated('r', '2026-10-28', 'root')]);
        if (page === '3') return response([dated('root', '2014-09-18')]);
        if (page === '2') return response([dated('middle', '2020-01-01', 'root')]);
        return response(
          [dated('m', '2026-10-29', 'recent'), dated('recent', '2026-10-25', 'middle')],
          true,
          3,
        );
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'r'));
      await h.setDirection(true);
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['root'],
      );
      const calls = histories(requests).length;
      await h.loadMore();
      assert.ok(!h.getSnapshot().commits.some((c) => c.sha === 'r'));
      assert.equal(histories(requests).length, calls + 1);
      await h.loadMore();
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'r'));
    },
  );
});

const cursorResponse = (data: unknown, cursor?: string) =>
  new Response(JSON.stringify(data), {
    headers: cursor
      ? {
          Link: `<https://api.github.com/repositories/123/activity?after=${encodeURIComponent(cursor)}>; rel="next"`,
        }
      : {},
  });

test('PR and merge queue updates discover 21.x and 20.x after the active 22.x branch', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([
          ref('2.0.x', 'old'),
          ref('main', 'm'),
          ref('22.2.x', 'r22'),
          ref('21.2.x', 'r21'),
          ref('20.3.x', 'r20'),
        ]);
      if (url.pathname.endsWith('/activity'))
        return cursorResponse([
          push('22.2.x', '2026-10-29T17:00:00Z'),
          { ...push('21.2.x', '2026-10-29T15:00:00Z'), activity_type: 'pr_merge' },
          { ...push('20.3.x', '2026-10-29T14:00:00Z'), activity_type: 'merge_queue_merge' },
          { ...push('removed', '2026-10-29T13:00:00Z'), activity_type: 'branch_deletion' },
        ]);
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        if (sha === 'main')
          return response([
            dated('m', '2026-10-29T21:00:00Z', 'root'),
            dated('root', '2026-10-25'),
          ]);
        const dates: Record<string, string> = {
          r22: '2026-10-29T17:00:00Z',
          r21: '2026-10-29T15:00:00Z',
          r20: '2026-10-29T14:00:00Z',
        };
        if (sha && dates[sha]) return response([dated(sha, dates[sha], 'root')]);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.deepEqual(
        histories(requests).map(([sha]) => sha),
        ['main', 'r22', 'r21', 'r20'],
      );
      assert.deepEqual(
        layout(h.getSnapshot().commits).ordered.map((c) => c.sha),
        ['m', 'r22', 'r21', 'r20', 'root'],
      );
      assert.ok(!requests.some((url) => url.pathname.endsWith('/branches/removed')));
    },
  );
});

test('a branch on the next real activity cursor is discovered without repeating the first page', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ref('22.2.x', 'r22'), ref('21.2.x', 'r21')]);
      if (url.pathname.endsWith('/activity')) {
        assert.equal(url.searchParams.has('page'), false);
        return url.searchParams.get('after') === 'older/cursor+='
          ? cursorResponse([{ ...push('21.2.x', '2026-10-28'), activity_type: 'pr_merge' }])
          : cursorResponse([push('22.2.x', '2026-10-29')], 'older/cursor+=');
      }
      if (url.pathname.endsWith('/commits'))
        return url.searchParams.get('sha') === 'main'
          ? response([dated('m', '2026-10-29', 'root'), dated('root', '2026-10-25')])
          : response([dated(url.searchParams.get('sha')!, '2026-10-28', 'root')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.ok(!h.getSnapshot().commits.some((c) => c.sha === 'r21'));
      await h.loadMore(['activity']);
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'r21'));
      assert.deepEqual(
        requests
          .filter((url) => url.pathname.endsWith('/activity'))
          .map((url) => url.searchParams.get('after')),
        [null, 'older/cursor+='],
      );
      assert.equal(h.getSnapshot().discoveryError, '');
      assert.equal(h.getSnapshot().more, false);
    },
  );
});

test('repeated activity cursors pause discovery instead of exhausting the API quota', async () => {
  let repeat = true;
  await using(
    (url) => {
      if (url.pathname.endsWith('/activity'))
        return repeat ? cursorResponse([push('main', '2026-10-29')], 'same') : cursorResponse([]);
      if (url.pathname.endsWith('/commits')) return response([dated('m', '2026-10-29')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      await h.loadMore(['activity']);
      assert.match(h.getSnapshot().discoveryError, /pagination did not advance/);
      await h.loadMore();
      assert.equal(requests.filter((url) => url.pathname.endsWith('/activity')).length, 2);
      repeat = false;
      await h.retryDiscovery();
      assert.equal(h.getSnapshot().discoveryError, '');
    },
  );
});

test('an empty filtered branch is reconsidered when exploration reaches its head date', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ref('21.2.x', 'r21')]);
      if (url.pathname.endsWith('/activity'))
        return cursorResponse([{ ...push('21.2.x', '2026-10-28'), activity_type: 'pr_merge' }]);
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        if (sha === 'main')
          return response([dated('m', '2026-10-29', 'base'), dated('base', '2026-10-25', 'older')]);
        if (sha === 'older') return response([dated('older', '2026-09-20')]);
        if (sha === 'r21')
          return url.searchParams.get('since')!.startsWith('2026-10')
            ? response([])
            : response([dated('r21', '2026-09-25', 'older')]);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.ok(!h.getSnapshot().commits.some((c) => c.sha === 'r21'));
      await h.loadMore(['older']);
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'r21'));
      assert.equal(histories(requests).filter(([sha]) => sha === 'r21').length, 2);
    },
  );
});

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('a newly visible path starts while another path is blocked and duplicate calls share its request', async () => {
  const a = gate<Response>(),
    started = gate<void>();
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        if (sha === 'main') return response([commit('m', 'a', 'b')]);
        if (sha === 'a') {
          started.resolve();
          return a.promise;
        }
        if (sha === 'b') return response([commit('b')]);
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      const first = h.loadMore(['a']);
      await started.promise;
      const duplicate = h.loadMore(['a']);
      await h.loadMore(['b']);
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'b'));
      assert.equal(h.getSnapshot().busy, true);
      assert.equal(histories(requests).filter(([sha]) => sha === 'a').length, 1);
      a.resolve(response([commit('a')]));
      await Promise.all([first, duplicate]);
      assert.equal(h.getSnapshot().busy, false);
    },
  );
});

test('all captured paths stay queued while sixteen commit requests run concurrently', async () => {
  const names = Array.from('abcdefghijklmnopqr');
  const gates = new Map(names.map((name) => [name, gate<Response>()]));
  let active = 0,
    peak = 0;
  await using(
    async (url) => {
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha')!;
        if (sha === 'main') return response([commit('main-head', ...names)]);
        if (gates.has(sha)) {
          active++;
          peak = Math.max(peak, active);
          const result = await gates.get(sha)!.promise;
          active--;
          return result;
        }
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      const pending = h.loadMore(names);
      await turn();
      assert.equal(histories(requests).length, 17);
      assert.equal(peak, 16);
      gates.get('d')!.resolve(response([commit('d')]));
      await turn();
      assert.ok(histories(requests).some(([sha]) => sha === 'q'));
      gates.get('b')!.resolve(response([commit('b')]));
      await turn();
      assert.ok(histories(requests).some(([sha]) => sha === 'r'));
      for (const name of names) gates.get(name)!.resolve(response([commit(name)]));
      await pending;
      assert.equal(peak, 16);
      assert.equal(h.getSnapshot().commits.length, 19);
      assert.equal(h.getSnapshot().busy, false);
      for (const name of names)
        assert.equal(histories(requests).filter(([sha]) => sha === name).length, 1);
    },
  );
});

test('one failed parallel path does not hide successful paths and Retry repeats only the failed source', async () => {
  const slow = gate<Response>();
  let fail = true;
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        if (sha === 'main') return response([commit('m', 'a', 'b')]);
        if (sha === 'a') return fail ? new Response('', { status: 500 }) : response([commit('a')]);
        if (sha === 'b') return slow.promise;
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      const pending = h.loadMore(['a', 'b']);
      await turn();
      assert.ok(h.getSnapshot().error);
      slow.resolve(response([commit('b')]));
      await pending;
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'b'));
      fail = false;
      await h.retry();
      assert.equal(h.getSnapshot().error, '');
      assert.equal(histories(requests).filter(([sha]) => sha === 'a').length, 2);
      assert.equal(histories(requests).filter(([sha]) => sha === 'b').length, 1);
    },
  );
});

test('changing repositories cancels queued work and ignores all old parallel results', async () => {
  const names = Array.from('abcdefghijklmnopqr');
  const gates = new Map(names.map((name) => [name, gate<Response>()]));
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha')!;
        if (url.pathname.includes('/other/')) return response([commit('new')]);
        if (sha === 'main') return response([commit('main-head', ...names)]);
        return gates.get(sha)?.promise;
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      const pending = h.loadMore(names);
      await turn();
      await h.open('other/repo');
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['new'],
      );
      for (const name of names) gates.get(name)!.resolve(response([commit(name)]));
      await pending;
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['new'],
      );
      assert.equal(h.getSnapshot().repo, 'other/repo');
      assert.ok(!histories(requests).some(([sha]) => sha === 'q' || sha === 'r'));
    },
  );
});

test('active branch histories publish independently while another discovered branch is still loading', async () => {
  const slow = gate<Response>(),
    started = gate<void>();
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ref('slow', 's'), ref('fast', 'f')]);
      if (url.pathname.endsWith('/activity'))
        return cursorResponse([push('slow', '2026-10-28'), push('fast', '2026-10-27')]);
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        if (sha === 'main')
          return response([dated('m', '2026-10-29', 'root'), dated('root', '2026-10-25')]);
        if (sha === 's') {
          started.resolve();
          return slow.promise;
        }
        if (sha === 'f') return response([dated('f', '2026-10-27', 'root')]);
      }
    },
    async (h) => {
      const opening = h.open('a/b');
      await started.promise;
      await turn();
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'f'));
      assert.equal(h.getSnapshot().busy, true);
      slow.resolve(response([dated('s', '2026-10-28', 'root')]));
      await opening;
      assert.equal(h.getSnapshot().busy, false);
    },
  );
});

test('discovered branch aliases share one in-flight commit request', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ref('alias-one', 'same'), ref('alias-two', 'same')]);
      if (url.pathname.endsWith('/activity'))
        return cursorResponse([push('alias-one', '2026-10-28'), push('alias-two', '2026-10-28')]);
      if (url.pathname.endsWith('/commits'))
        return url.searchParams.get('sha') === 'main'
          ? response([dated('m', '2026-10-29', 'root'), dated('root', '2026-10-25')])
          : response([dated('same', '2026-10-28', 'root')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.equal(histories(requests).filter(([sha]) => sha === 'same').length, 1);
      assert.equal(h.getSnapshot().commits.filter((c) => c.sha === 'same').length, 1);
    },
  );
});

test('an empty boundary response cannot silently mark a broken branch complete', async () => {
  let empty = true;
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits'))
        return url.searchParams.get('sha') === 'main'
          ? response([commit('m', 'gap')])
          : empty
            ? response([])
            : response([commit('gap')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      await h.loadMore(['gap']);
      assert.match(h.getSnapshot().error, /requested commit/);
      assert.equal(h.getSnapshot().more, true);
      assert.deepEqual(h.getSnapshot().frontiers, [{ sha: 'm', sources: ['gap'] }]);
      await h.loadMore();
      assert.equal(histories(requests).length, 2);
      empty = false;
      await h.retry();
      assert.equal(h.getSnapshot().error, '');
      assert.equal(h.getSnapshot().more, false);
    },
  );
});

test('settled cursors notify subscribers after cleanup so a visible boundary keeps advancing', async () => {
  const cursors: string[] = [];
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ref('found', 'f')]);
      if (url.pathname.endsWith('/commits'))
        return response(
          url.searchParams.get('sha') === 'main'
            ? [dated('m', '2026-10-29', 'root'), dated('root', '2026-10-25')]
            : [dated('f', '2026-10-28', 'root')],
        );
      if (url.pathname.endsWith('/activity')) {
        const cursor = url.searchParams.get('after') ?? 'first';
        cursors.push(cursor);
        return cursor === 'third'
          ? cursorResponse([push('found', '2026-10-28')])
          : cursorResponse([push('main', '2026-10-29')], cursor === 'first' ? 'second' : 'third');
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      assert.deepEqual(cursors, ['first']);
      const tasks: Promise<void>[] = [];
      const scan = () => {
        const state = h.getSnapshot();
        if (state.error) return;
        const ready = [...new Set(state.frontiers.flatMap((frontier) => frontier.sources))].filter(
          (source) => !state.pendingSources.includes(source),
        );
        if (ready.length) tasks.push(h.loadMore(ready));
      };
      const stop = h.subscribe(scan);
      try {
        scan();
        for (let i = 0; i < 10; i++) await turn();
        await Promise.all(tasks);
        assert.deepEqual(cursors, ['first', 'second', 'third']);
        assert.deepEqual(histories(requests), [
          ['main', '1'],
          ['f', '1'],
        ]);
        assert.equal(h.getSnapshot().more, false);
        assert.deepEqual(h.getSnapshot().pendingSources, []);
      } finally {
        stop();
      }
    },
  );
});

test('reentrant viewport scans retain new main boundaries without duplicating accepted work', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        return response(
          sha === 'main' ? [commit('m', 'a')] : sha === 'a' ? [commit('a', 'b')] : [commit('b')],
        );
      }
    },
    async (h, requests) => {
      await h.open('a/b');
      const tasks: Promise<void>[] = [],
        states: string[][] = [];
      const scan = () => {
        const state = h.getSnapshot();
        states.push([...state.pendingSources]);
        const ready = state.frontiers
          .flatMap((frontier) => frontier.sources)
          .filter((source) => !state.pendingSources.includes(source));
        if (ready.length && !state.error) tasks.push(h.loadMore(ready));
      };
      const stop = h.subscribe(scan);
      try {
        scan();
        await turn();
        await Promise.all(tasks);
        assert.deepEqual(histories(requests), [
          ['main', '1'],
          ['a', '1'],
          ['b', '1'],
        ]);
        assert.ok(states.some((sources) => sources.includes('a') && sources.includes('b')));
        assert.deepEqual(h.getSnapshot().pendingSources, []);
        assert.equal(h.getSnapshot().more, false);
      } finally {
        stop();
      }
    },
  );
});

test('changing base before accepted work starts cannot run that work in the new traversal', async () => {
  await using(
    (url) => {
      if (url.pathname.endsWith('/commits'))
        return response(
          url.searchParams.get('sha') === 'main' ? [commit('m', 'gap')] : [commit('new')],
        );
    },
    async (h, requests) => {
      await h.open('a/b');
      const pending = h.loadMore(['gap']);
      assert.deepEqual(h.getSnapshot().pendingSources, ['gap']);
      await h.chooseBase('other');
      await pending;
      assert.deepEqual(histories(requests), [
        ['main', '1'],
        ['other', '1'],
      ]);
      assert.deepEqual(
        h.getSnapshot().commits.map((c) => c.sha),
        ['new'],
      );
      assert.deepEqual(h.getSnapshot().pendingSources, []);
    },
  );
});
test('PR ranking permission denial names the missing permission and keeps the graph', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/pulls'))
        return new Response(
          JSON.stringify({ message: 'Resource not accessible by personal access token' }),
          { status: 403 },
        );
      if (url.pathname.endsWith('/branches'))
        return response([{ name: 'main', commit: { sha: 'm' } }]);
      if (url.pathname.endsWith('/commits')) return response([commit('m')]);
      return response({ default_branch: 'main', stargazers_count: 0 });
    };
    const h = new History();
    await h.open('a/b', 'token');
    await h.loadRecommendations();
    assert.equal(h.getSnapshot().ranking.error, 'Needs Pull requests: Read-only.');
    assert.equal(h.getSnapshot().error, '');
    assert.equal(h.getSnapshot().commits.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('refresh leaves unchanged commits and branch arrays intact and does not reread commit metadata', async () => {
  await using(
    (url) =>
      url.pathname.endsWith('/commits')
        ? response([commit('m', 'root'), commit('root')])
        : undefined,
    async (h, requests) => {
      await h.open('a/b');
      const before = h.getSnapshot(),
        count = histories(requests).length;
      await h.refresh();
      assert.equal(h.getSnapshot().commits, before.commits);
      assert.equal(h.getSnapshot().branches, before.branches);
      assert.equal(histories(requests).length, count);
    },
  );
});
test('refresh deduplicates a new shared head and keeps known commit objects', async () => {
  let sha = 'm';
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', sha), ref('feature', sha)]);
      if (url.pathname.endsWith('/commits'))
        return response(
          url.searchParams.get('sha') === 'new'
            ? [commit('new', 'm'), commit('m', 'root'), commit('root')]
            : [commit('m', 'root'), commit('root')],
        );
    },
    async (h, requests) => {
      await h.open('a/b');
      const old = h.getSnapshot().commits.find((c) => c.sha === 'm');
      sha = 'new';
      await h.refresh();
      assert.equal(h.getSnapshot().baseHead, 'new');
      assert.equal(
        h.getSnapshot().commits.find((c) => c.sha === 'm'),
        old,
      );
      assert.equal(histories(requests).filter(([sha]) => sha === 'new').length, 1);
    },
  );
});
test('a partial or failed branch listing cannot delete refs; a later complete listing ends tracking', async () => {
  let refresh = false,
    fail = true;
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches')) {
        if (!refresh) return response([ref('main', 'm'), ref('feature', 'root')]);
        if (url.searchParams.get('page') === '1') return response([ref('main', 'm')], true);
        return fail ? new Response('', { status: 500 }) : response([]);
      }
      if (url.pathname.endsWith('/commits')) return response([commit('m', 'root'), commit('root')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      const before = h.getSnapshot().commits;
      refresh = true;
      await h.refresh();
      assert.ok(h.getSnapshot().branches.some((b) => b.name === 'feature'));
      assert.equal(h.getSnapshot().commits, before);
      fail = false;
      await h.refresh();
      assert.ok(!h.getSnapshot().branches.some((b) => b.name === 'feature'));
      const count = histories(requests).length;
      await h.refresh();
      assert.equal(histories(requests).length, count);
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'root'));
    },
  );
});
test('force push reevaluates reachability and preserves shared commits used by another ref', async () => {
  let sha = 'm';
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', sha), ref('shared', 'root')]);
      if (url.pathname.endsWith('/commits'))
        return response(
          url.searchParams.get('sha') === 'replacement'
            ? [commit('replacement', 'root'), commit('root')]
            : [commit('m', 'root'), commit('root')],
        );
    },
    async (h) => {
      await h.open('a/b');
      sha = 'replacement';
      await h.refresh();
      assert.deepEqual(
        new Set(h.getSnapshot().commits.map((c) => c.sha)),
        new Set(['replacement', 'root']),
      );
      assert.equal(h.getSnapshot().baseHead, 'replacement');
    },
  );
});
test('an actually new branch after a complete baseline is fetched incrementally', async () => {
  let added = false;
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ...(added ? [ref('new-feature', 'n')] : [])]);
      if (url.pathname.endsWith('/commits'))
        return response(
          url.searchParams.get('sha') === 'n'
            ? [commit('n', 'root')]
            : [commit('m', 'root'), commit('root')],
        );
    },
    async (h) => {
      await h.open('a/b');
      await h.refresh();
      added = true;
      await h.refresh();
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'n'));
      assert.ok(h.getSnapshot().branches.some((b) => b.name === 'new-feature'));
    },
  );
});
test('a new branch is detected on the first poll when the initial branch catalog was complete', async () => {
  let created = false;
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([ref('main', 'm'), ...(created ? [ref('fresh', 'n')] : [])]);
      if (url.pathname.endsWith('/commits'))
        return response(url.searchParams.get('sha') === 'n' ? [commit('n', 'm')] : [commit('m')]);
    },
    async (h) => {
      await h.open('a/b');
      created = true;
      await h.refresh();
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'n'));
    },
  );
});
test('failed changed-head batches leave both the displayed graph and references untouched', async () => {
  let changed = false;
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response([
          ref('main', changed ? 'new' : 'm'),
          ref('side', changed ? 'broken' : 'm'),
        ]);
      if (url.pathname.endsWith('/commits')) {
        const sha = url.searchParams.get('sha');
        return sha === 'broken'
          ? new Response('', { status: 500 })
          : response(sha === 'new' ? [commit('new', 'm')] : [commit('m')]);
      }
    },
    async (h) => {
      await h.open('a/b');
      const old = h.getSnapshot();
      changed = true;
      await h.refresh();
      assert.equal(h.getSnapshot().commits, old.commits);
      assert.equal(h.getSnapshot().branches, old.branches);
      assert.match(h.getSnapshot().refreshError, /500/);
    },
  );
});
test('a deleted selected branch stops HEAD fetching and retains cached history with an explicit notice', async () => {
  let deleted = false;
  await using(
    (url) => {
      if (url.pathname.endsWith('/branches'))
        return response(
          deleted ? [ref('other', 'root')] : [ref('main', 'm'), ref('other', 'root')],
        );
      if (url.pathname.endsWith('/commits')) return response([commit('m', 'root'), commit('root')]);
    },
    async (h, requests) => {
      await h.open('a/b');
      deleted = true;
      const count = histories(requests).length;
      await h.refresh();
      await h.refresh();
      assert.equal(histories(requests).length, count);
      assert.equal(h.getSnapshot().baseHead, 'm');
      assert.ok(!h.getSnapshot().branches.some((ref) => ref.name === 'main'));
      assert.match(h.getSnapshot().refreshNotice, /deleted/);
      assert.ok(h.getSnapshot().commits.some((c) => c.sha === 'm'));
    },
  );
});
