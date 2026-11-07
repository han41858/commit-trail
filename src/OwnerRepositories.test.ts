import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { OwnerRepositories, type OwnerRepository } from './OwnerRepositories';
import { requestActivity } from './requestActivity';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const repository = (
  id: number,
  name: string,
  owner = 'owner',
  isPrivate = false,
  pushedAt: string | null = '2026-11-01T00:00:00Z',
): OwnerRepository => ({
  id,
  name,
  full_name: `${owner}/${name}`,
  owner: { login: owner },
  private: isPrivate,
  description: `Description of ${name}`,
  pushed_at: pushedAt,
});
const response = (items: unknown, next = false) =>
  new Response(JSON.stringify(
    next && Array.isArray(items)
      ? [...items, ...Array.from({ length: Math.max(0, 100 - items.length) }, (_, index) =>
          repository(10000 + index, `other-${index}`, 'another-owner'))]
      : items,
  ), {
    headers: next ? { Link: '<https://api.github.com/ignored?page=2>; rel="next"' } : {},
  });
const names = (store: OwnerRepositories) => store.getSnapshot().repositories.map((repo) => repo.name);

function fixture(t: TestContext, token = '') {
  const original = globalThis.fetch;
  const store = new OwnerRepositories();
  store.setToken(token);
  t.after(() => {
    store.close();
    globalThis.fetch = original;
  });
  return store;
}

test('owner query is explicit, anonymous, normalized and uses public owner repositories', async (t) => {
  const store = fixture(t);
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(url.pathname, '/users/owner/repos');
    assert.equal(url.searchParams.get('type'), 'owner');
    assert.equal(url.searchParams.get('sort'), 'full_name');
    assert.equal(url.searchParams.get('direction'), 'asc');
    assert.equal(url.searchParams.get('per_page'), '100');
    assert.equal(url.searchParams.get('page'), '1');
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    return response([repository(1, 'first')]);
  };
  assert.equal(calls, 0);
  await store.open(' OwNeR ');
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().owner, 'owner');
  assert.deepEqual(names(store), ['first']);
  assert.equal(store.getSnapshot().authenticated.enabled, false);
});

test('public organization results use the same owner filter without a profile lookup', async (t) => {
  const store = fixture(t);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response([
      {
        ...repository(1, 'org-repo', 'Organization'),
        owner: { login: 'Organization', type: 'Organization' },
      },
      repository(2, 'foreign', 'elsewhere'),
    ]);
  };
  await store.open('organization');
  assert.equal(calls, 1);
  assert.deepEqual(names(store), ['org-repo']);
});

test('PAT lookup merges by ID and filters collaboration repositories by exact owner', async (t) => {
  const store = fixture(t, 'limited-pat');
  const publicRepo = repository(1, 'public');
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const auth = (init?.headers as Record<string, string>).Authorization;
    if (url.pathname === '/user/repos') {
      assert.equal(auth, 'Bearer limited-pat');
      assert.equal(url.searchParams.get('type'), null);
      assert.equal(url.searchParams.get('affiliation'), 'owner,collaborator,organization_member');
      assert.equal(url.searchParams.get('sort'), 'full_name');
      assert.equal(url.searchParams.get('direction'), 'asc');
      assert.equal(url.searchParams.get('per_page'), '100');
      return response([
        publicRepo,
        repository(2, 'allowed-private', 'OWNER', true),
        repository(3, 'foreign-private', 'owner-other', true),
      ]);
    }
    assert.equal(auth, undefined);
    return response([publicRepo]);
  };
  await store.open('owner');
  assert.deepEqual(names(store), ['allowed-private', 'public']);
  assert.equal(store.getSnapshot().repositories[0].private, true);
  assert.equal(store.getSnapshot().repositories.length, 2);
  assert.equal(store.getSnapshot().authenticated.enabled, true);
});

test('invalid or restricted PAT errors keep independent public results', async (t) => {
  const store = fixture(t);
  for (const status of [401, 403]) {
    store.setToken(`invalid-or-restricted-${status}`);
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).pathname === '/user/repos')
        return new Response('{"message":"sensitive permission detail"}', { status });
      assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
      return response([repository(1, 'public')]);
    };
    await store.open('owner');
    assert.deepEqual(names(store), ['public']);
    assert.equal(store.getSnapshot().public.error, '');
    assert.ok(store.getSnapshot().authenticated.error);
    assert.ok(!store.getSnapshot().authenticated.error.includes('sensitive'));
    store.close();
  }
});

test('initial public and authenticated pages appear together after the slower request settles', async (t) => {
  const store = fixture(t, 'pat');
  const completed: string[][] = [];
  store.subscribe(() => {
    const state = store.getSnapshot();
    if (state.owner && !state.busy) completed.push(names(store));
  });
  let finishAuth!: (result: Response) => void;
  globalThis.fetch = async (input) =>
    new URL(String(input)).pathname === '/user/repos'
      ? new Promise<Response>((resolve) => {
          finishAuth = resolve;
        })
      : response([repository(1, 'public')]);
  const loading = store.open('owner');
  await flush();
  assert.deepEqual(names(store), []);
  assert.equal(store.getSnapshot().busy, true);
  assert.equal(store.getSnapshot().public.busy, false);
  assert.equal(store.getSnapshot().authenticated.busy, true);
  finishAuth(response([repository(2, 'private', 'owner', true)]));
  await loading;
  assert.deepEqual(names(store), ['private', 'public']);
  assert.equal(store.getSnapshot().busy, false);
  assert.deepEqual(completed, [['private', 'public']]);
});

test('authenticated results are usable even if the public source fails', async (t) => {
  const store = fixture(t, 'pat');
  globalThis.fetch = async (input) =>
    new URL(String(input)).pathname === '/user/repos'
      ? response([repository(1, 'private', 'owner', true)])
      : new Response('{}', { status: 500 });
  await store.open('owner');
  assert.deepEqual(names(store), ['private']);
  assert.ok(store.getSnapshot().public.error);
  assert.equal(store.getSnapshot().authenticated.error, '');
});

test('repository order uses case-insensitive name regardless of push time', async (t) => {
  const store = fixture(t);
  globalThis.fetch = async () => response([
    repository(1, 'zeta'),
    repository(2, 'Beta'),
    repository(3, 'alpha'),
    repository(4, 'new', 'owner', false, '2026-11-02T00:00:00Z'),
    repository(5, 'no-push', 'owner', false, null),
    repository(6, 'invalid-push', 'owner', false, 'invalid'),
  ]);
  await store.open('owner');
  assert.deepEqual(names(store), ['alpha', 'Beta', 'invalid-push', 'new', 'no-push', 'zeta']);
});

test('both sources paginate only on loadMore calls and preserve unmatched authenticated pages', async (t) => {
  const store = fixture(t, 'pat');
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    calls.push(`${url.pathname}:${page}`);
    if (url.pathname === '/user/repos')
      return page === 1
        ? response([repository(9, 'foreign', 'other', true)], true)
        : response([repository(2, 'private', 'owner', true)]);
    return page === 1
      ? response([repository(1, 'public')], true)
      : response([repository(1, 'public'), repository(3, 'public-two')]);
  };
  await store.open('owner');
  assert.equal(calls.length, 2);
  assert.deepEqual(names(store), ['public']);
  assert.equal(store.getSnapshot().authenticated.more, true);
  await store.loadMore();
  assert.deepEqual(calls.sort(), [
    '/user/repos:1',
    '/user/repos:2',
    '/users/owner/repos:1',
    '/users/owner/repos:2',
  ]);
  assert.deepEqual(names(store), ['private', 'public', 'public-two']);
  assert.equal(store.getSnapshot().public.more, false);
  assert.equal(store.getSnapshot().authenticated.more, false);
  await store.loadMore();
  assert.equal(calls.length, 4);
});

test('an empty matching authenticated page is not treated as exhaustion while Link has next', async (t) => {
  const store = fixture(t, 'pat');
  let authCalls = 0;
  globalThis.fetch = async (input) => {
    if (new URL(String(input)).pathname !== '/user/repos') return response([]);
    authCalls++;
    return authCalls === 1 ? response([], true) : response([repository(1, 'found', 'owner', true)]);
  };
  await store.open('owner');
  assert.deepEqual(names(store), []);
  assert.equal(store.getSnapshot().authenticated.more, true);
  assert.equal(store.getSnapshot().public.more, false);
  await store.loadMore();
  assert.deepEqual(names(store), ['found']);
  assert.equal(authCalls, 2);
});

test('failed next page keeps prior rows and Retry repeats only the failed source page', async (t) => {
  const store = fixture(t, 'pat');
  const calls: string[] = [];
  let failed = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    calls.push(`${url.pathname}:${page}`);
    if (url.pathname === '/user/repos') return response([repository(2, 'private', 'owner', true)]);
    if (page === 1) return response([repository(1, 'public')], true);
    if (!failed) {
      failed = true;
      throw new TypeError('secret network detail');
    }
    return response([repository(3, 'public-two')]);
  };
  await store.open('owner');
  await store.loadMore();
  assert.deepEqual(names(store), ['private', 'public']);
  assert.match(store.getSnapshot().public.error, /Could not reach/);
  await store.retry();
  assert.deepEqual(names(store), ['private', 'public', 'public-two']);
  assert.deepEqual(calls.sort(), [
    '/user/repos:1',
    '/users/owner/repos:1',
    '/users/owner/repos:2',
    '/users/owner/repos:2',
  ]);
});

test('public rate limiting does not block authenticated results or retry before its deadline', async (t) => {
  const store = fixture(t, 'pat');
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });
  let publicCalls = 0;
  let authCalls = 0;
  globalThis.fetch = async (input) => {
    if (new URL(String(input)).pathname === '/user/repos') {
      authCalls++;
      return response([repository(2, 'private', 'owner', true)]);
    }
    publicCalls++;
    return publicCalls === 1
      ? new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
      : response([repository(1, 'public')]);
  };
  await store.open('owner');
  assert.deepEqual(names(store), ['private']);
  assert.equal(store.getSnapshot().public.retryAt, now + 60_000);
  await store.retry();
  assert.equal(publicCalls, 1);
  store.close();
  await store.open('owner');
  assert.equal(publicCalls, 1);
  assert.deepEqual(names(store), ['private']);
  now += 60_001;
  await store.retry();
  assert.equal(publicCalls, 2);
  assert.equal(authCalls, 1);
  assert.deepEqual(names(store), ['private', 'public']);
});

test('anonymous 404 identifies the owner and neither response errors nor malformed records leak data', async (t) => {
  const store = fixture(t);
  globalThis.fetch = async () => new Response('{"message":"private secret"}', { status: 404 });
  await store.open('missing');
  assert.match(store.getSnapshot().public.error, /owner not found/i);
  assert.ok(!store.getSnapshot().public.error.includes('secret'));
  assert.equal(store.getSnapshot().public.more, false);
  globalThis.fetch = async () => response([
    repository(1, 'public'),
    repository(2, 'must-not-be-public', 'owner', true),
    { ...repository(3, 'bad'), full_name: 'other/bad' },
    { ...repository(4, 'bad'), id: '4' },
    { ...repository(5, 'bad'), private: undefined },
  ]);
  await store.open('owner');
  assert.deepEqual(names(store), ['public']);
});

test('malformed payload reports a retryable safe error instead of an empty result', async (t) => {
  const store = fixture(t);
  globalThis.fetch = async () => response({ secret: 'not-a-list' });
  await store.open('owner');
  assert.match(store.getSnapshot().public.error, /Could not load/);
  assert.equal(store.getSnapshot().repositories.length, 0);
});

test('same-owner open and loadMore cannot duplicate in-flight work', async (t) => {
  const store = fixture(t);
  let finish!: (value: Response) => void;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  };
  const loading = store.open('owner');
  await flush();
  await store.open('OWNER');
  await store.loadMore();
  assert.equal(calls, 1);
  finish(response([repository(1, 'one')]));
  await loading;
  assert.deepEqual(names(store), ['one']);
});

test('changing owner aborts old requests and late responses cannot overwrite the new list', async (t) => {
  const store = fixture(t, 'pat');
  const old: { resolve: (value: Response) => void; signal: AbortSignal }[] = [];
  let first = true;
  globalThis.fetch = async (_input, init) => {
    if (first) return new Promise<Response>((resolve) => old.push({ resolve, signal: init!.signal! }));
    return response([repository(2, 'new', 'next')]);
  };
  const previous = store.open('owner');
  await flush();
  first = false;
  await store.open('next');
  assert.equal(old.length, 2);
  assert.ok(old.every((request) => request.signal.aborted));
  for (const request of old) request.resolve(response([repository(1, 'late-private', 'owner', true)]));
  await previous;
  assert.equal(store.getSnapshot().owner, 'next');
  assert.deepEqual(names(store), ['new']);
});

test('closing hides results, aborts requests and ignores late success or failure', async (t) => {
  const store = fixture(t);
  let resolve!: (value: Response) => void;
  let signal!: AbortSignal;
  globalThis.fetch = async (_input, init) => {
    signal = init!.signal!;
    return new Promise<Response>((done) => {
      resolve = done;
    });
  };
  const loading = store.open('owner');
  await flush();
  store.close();
  assert.equal(signal.aborted, true);
  resolve(response([repository(1, 'late')]));
  await loading;
  assert.equal(store.getSnapshot().owner, '');
  assert.deepEqual(names(store), []);
  assert.equal(store.getSnapshot().busy, false);
});

test('fresh successful pages survive close and are reused across owner casing and switches', async (t) => {
  const store = fixture(t, 'pat');
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    const path = new URL(String(input)).pathname;
    if (path === '/user/repos') return response([repository(2, 'private', 'owner', true)]);
    const owner = path.split('/')[2];
    return response([repository(1, 'public', owner)]);
  };
  await store.open('owner');
  store.close();
  const cached = store.open('OWNER');
  assert.deepEqual(names(store), ['private', 'public']);
  assert.equal(store.getSnapshot().busy, false);
  await cached;
  assert.equal(calls, 2);
  assert.deepEqual(names(store), ['private', 'public']);
  await store.open('other');
  assert.deepEqual(names(store), ['public']);
  await store.open('owner');
  assert.equal(calls, 4);
  assert.deepEqual(names(store), ['private', 'public']);
});

test('expired cache refreshes on explicit open including an already open owner', async (t) => {
  const store = fixture(t);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });
  let calls = 0;
  globalThis.fetch = async () => response([repository(++calls, `version-${calls}`)]);
  await store.open('owner');
  now += 59_999;
  await store.open('owner');
  assert.equal(calls, 1);
  now += 2;
  await store.open('owner');
  assert.equal(calls, 2);
  assert.deepEqual(names(store), ['version-2']);
});

test('cache is bounded to ten recently accessed owners', async (t) => {
  const store = fixture(t);
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    const owner = new URL(String(input)).pathname.split('/')[2];
    return response([repository(1, 'repo', owner)]);
  };
  for (let i = 0; i < 10; i++) await store.open(`owner${i}`);
  await store.open('owner0');
  assert.equal(calls, 10);
  await store.open('owner10');
  await store.open('owner0');
  assert.equal(calls, 11);
  await store.open('owner1');
  assert.equal(calls, 12);
});

test('PAT add, replacement and removal invalidate visible and cached authenticated results', async (t) => {
  const store = fixture(t);
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    if (new URL(String(input)).pathname !== '/user/repos') return response([repository(1, 'public')]);
    const token = (init?.headers as Record<string, string>).Authorization;
    return response([
      repository(
        token === 'Bearer first' ? 2 : 3,
        token === 'Bearer first' ? 'first-private' : 'second-private',
        'owner',
        true,
      ),
    ]);
  };
  await store.open('owner');
  store.setToken('first');
  assert.equal(store.getSnapshot().owner, '');
  await store.open('owner');
  assert.deepEqual(names(store), ['first-private', 'public']);
  store.setToken('second');
  assert.deepEqual(names(store), []);
  await store.open('owner');
  assert.deepEqual(names(store), ['public', 'second-private']);
  store.setToken('');
  assert.deepEqual(names(store), []);
  await store.open('owner');
  assert.deepEqual(names(store), ['public']);
  assert.equal(calls, 6);
});

test('a token change ignores a late private response and cannot seed a new-token cache', async (t) => {
  const store = fixture(t, 'old');
  let finish!: (response: Response) => void;
  globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).pathname !== '/user/repos') return response([repository(1, 'public')]);
    if ((init?.headers as Record<string, string>).Authorization === 'Bearer old')
      return new Promise<Response>((resolve) => {
      finish = resolve;
    });
    return response([repository(3, 'new-private', 'owner', true)]);
  };
  const previous = store.open('owner');
  await flush();
  store.setToken('new');
  await store.open('owner');
  finish(response([repository(2, 'old-private', 'owner', true)]));
  await previous;
  assert.deepEqual(names(store), ['new-private', 'public']);
  store.close();
  await store.open('owner');
  assert.deepEqual(names(store), ['new-private', 'public']);
});

test('global HTTP activity counts owner lookups while repository column counters stay isolated', async (t) => {
  const store = fixture(t, 'pat');
  const pending: ((result: Response) => void)[] = [];
  globalThis.fetch = async () => new Promise<Response>((resolve) => pending.push(resolve));
  const initial = requestActivity.getSnapshot();
  const loading = store.open('owner');
  await flush();
  assert.equal(requestActivity.getSnapshot(), initial + 2);
  assert.equal(requestActivity.getSnapshot('owner/repo'), 0);
  pending[0](response([repository(1, 'public')]));
  await flush();
  assert.equal(requestActivity.getSnapshot(), initial + 1);
  store.close();
  assert.equal(requestActivity.getSnapshot(), initial);
  pending[1](response([repository(2, 'private', 'owner', true)]));
  await loading;
  assert.equal(requestActivity.getSnapshot(), initial);
});

test('reopening a partial load reuses completed public pages and retries only the uncached auth source', async (t) => {
  const store = fixture(t, 'pat');
  let publicCalls = 0;
  let authCalls = 0;
  const pending: ((value: Response) => void)[] = [];
  globalThis.fetch = async (input) => {
    if (new URL(String(input)).pathname !== '/user/repos') {
      publicCalls++;
      return response([repository(1, 'public')], true);
    }
    authCalls++;
    return new Promise<Response>((resolve) => pending.push(resolve));
  };
  const previous = store.open('owner');
  await flush();
  assert.deepEqual(names(store), []);
  store.close();
  const reopened = store.open('owner');
  await flush();
  assert.deepEqual(names(store), []);
  assert.equal(store.getSnapshot().busy, true);
  assert.equal(publicCalls, 1);
  pending[1](response([repository(2, 'private', 'owner', true)]));
  await reopened;
  pending[0](response([repository(3, 'stale-private', 'owner', true)]));
  await previous;
  assert.equal(publicCalls, 1);
  assert.equal(authCalls, 2);
  assert.deepEqual(names(store), ['private', 'public']);
  assert.equal(store.getSnapshot().public.more, true);
});

test('reopening a paginated cache continues at the next page without duplicating loaded repositories', async (t) => {
  const store = fixture(t);
  const pages: number[] = [];
  globalThis.fetch = async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    pages.push(page);
    return response([repository(1, 'shared'), repository(page + 1, `page-${page}`)], page < 3);
  };
  await store.open('owner');
  await store.loadMore();
  store.close();
  await store.open('owner');
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(names(store), ['page-1', 'page-2', 'shared']);
  await store.loadMore();
  assert.deepEqual(pages, [1, 2, 3]);
  assert.deepEqual(names(store), ['page-1', 'page-2', 'page-3', 'shared']);
});

test('an authenticated rate limit leaves public pagination usable and remains scoped to the token', async (t) => {
  const store = fixture(t, 'limited');
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}:${url.searchParams.get('page')}`);
    if (url.pathname === '/user/repos') {
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer limited'
        ? new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
        : response([repository(3, 'new-private', 'owner', true)]);
    }
    const page = Number(url.searchParams.get('page'));
    return response([repository(page, `public-${page}`)], page === 1);
  };
  await store.open('owner');
  assert.ok(store.getSnapshot().authenticated.retryAt! > Date.now());
  await store.loadMore();
  assert.deepEqual(names(store), ['public-1', 'public-2']);
  await store.retry();
  assert.equal(calls.filter((path) => path.startsWith('/user/repos:')).length, 1);
  store.setToken('new');
  await store.open('owner');
  assert.deepEqual(names(store), ['new-private', 'public-1']);
  assert.equal(store.getSnapshot().authenticated.retryAt, null);
});

test('a fast authenticated page also waits for public data before showing the combined list', async (t) => {
  const store = fixture(t, 'pat');
  let finishPublic!: (value: Response) => void;
  globalThis.fetch = async (input) =>
    new URL(String(input)).pathname === '/user/repos'
      ? response([repository(2, 'private', 'owner', true), repository(1, 'public')])
      : new Promise<Response>((resolve) => {
          finishPublic = resolve;
        });
  const loading = store.open('owner');
  await flush();
  assert.deepEqual(names(store), []);
  assert.equal(store.getSnapshot().busy, true);
  assert.equal(store.getSnapshot().public.busy, true);
  assert.equal(store.getSnapshot().authenticated.busy, false);
  finishPublic(response([repository(1, 'public')]));
  await loading;
  assert.deepEqual(names(store), ['private', 'public']);
  assert.equal(store.getSnapshot().busy, false);
});

test('authentication failure reveals the successful public page when the initial action completes', async (t) => {
  const store = fixture(t, 'invalid');
  let finishAuth!: (value: Response) => void;
  globalThis.fetch = async (input) =>
    new URL(String(input)).pathname === '/user/repos'
      ? new Promise<Response>((resolve) => {
          finishAuth = resolve;
        })
      : response([repository(1, 'public')]);
  const loading = store.open('owner');
  await flush();
  assert.deepEqual(names(store), []);
  assert.equal(store.getSnapshot().busy, true);
  finishAuth(new Response('{}', { status: 401 }));
  await loading;
  assert.deepEqual(names(store), ['public']);
  assert.match(store.getSnapshot().authenticated.error, /invalid or expired/);
  assert.equal(store.getSnapshot().public.error, '');
  assert.equal(store.getSnapshot().busy, false);
});

test('loadMore keeps displayed rows stable and blocks overlapping actions until both sources finish', async (t) => {
  const store = fixture(t, 'pat');
  const calls: string[] = [];
  let finishAuth!: (value: Response) => void;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    calls.push(`${url.pathname}:${page}`);
    if (page === 1)
      return url.pathname === '/user/repos'
        ? response([repository(2, 'private', 'owner', true)], true)
        : response([repository(1, 'public')], true);
    if (url.pathname === '/user/repos')
      return new Promise<Response>((resolve) => {
        finishAuth = resolve;
      });
    return response([repository(3, 'new-public')], true);
  };
  await store.open('owner');
  const originalRows = store.getSnapshot().repositories;
  const loading = store.loadMore();
  await flush();
  assert.equal(store.getSnapshot().repositories, originalRows);
  assert.deepEqual(names(store), ['private', 'public']);
  assert.equal(store.getSnapshot().busy, true);
  assert.equal(store.getSnapshot().public.busy, false);
  assert.equal(store.getSnapshot().authenticated.busy, true);
  await store.loadMore();
  await store.retry();
  await store.open('OWNER');
  assert.equal(calls.length, 4);
  finishAuth(response([repository(4, 'new-private', 'owner', true)]));
  await loading;
  assert.deepEqual(names(store), ['new-private', 'new-public', 'private', 'public']);
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(calls.length, 4);
});

test('Retry keeps prior rows until every retried source settles and does not replay successful pages', async (t) => {
  const store = fixture(t, 'pat');
  const calls: string[] = [];
  const pending = new Map<string, (value: Response) => void>();
  let retrying = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    calls.push(`${url.pathname}:${page}`);
    if (page === 1)
      return url.pathname === '/user/repos'
        ? response([repository(2, 'private', 'owner', true)], true)
        : response([repository(1, 'public')], true);
    if (!retrying) return new Response('{}', { status: 500 });
    return new Promise<Response>((resolve) => pending.set(url.pathname, resolve));
  };
  await store.open('owner');
  await store.loadMore();
  const originalRows = store.getSnapshot().repositories;
  assert.deepEqual(names(store), ['private', 'public']);
  assert.ok(store.getSnapshot().public.error);
  assert.ok(store.getSnapshot().authenticated.error);
  retrying = true;
  const loading = store.retry();
  await flush();
  pending.get('/users/owner/repos')!(response([repository(3, 'new-public')]));
  await flush();
  assert.equal(store.getSnapshot().repositories, originalRows);
  assert.equal(store.getSnapshot().busy, true);
  await store.retry();
  await store.loadMore();
  assert.equal(calls.length, 6);
  pending.get('/user/repos')!(response([repository(4, 'new-private', 'owner', true)]));
  await loading;
  assert.deepEqual(names(store), ['new-private', 'new-public', 'private', 'public']);
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().public.error, '');
  assert.equal(store.getSnapshot().authenticated.error, '');
  assert.equal(calls.filter((call) => call.endsWith(':1')).length, 2);
});

test('a failed source in loadMore preserves old rows until the other source finishes', async (t) => {
  const store = fixture(t, 'pat');
  let finishPublic!: (value: Response) => void;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    if (page === 1)
      return url.pathname === '/user/repos'
        ? response([repository(2, 'private', 'owner', true)], true)
        : response([repository(1, 'public')], true);
    if (url.pathname === '/user/repos') return new Response('{}', { status: 403 });
    return new Promise<Response>((resolve) => {
      finishPublic = resolve;
    });
  };
  await store.open('owner');
  const originalRows = store.getSnapshot().repositories;
  const loading = store.loadMore();
  await flush();
  assert.equal(store.getSnapshot().repositories, originalRows);
  assert.equal(store.getSnapshot().busy, true);
  assert.ok(store.getSnapshot().authenticated.error);
  finishPublic(response([repository(3, 'new-public')]));
  await loading;
  assert.deepEqual(names(store), ['new-public', 'private', 'public']);
  assert.ok(store.getSnapshot().authenticated.error);
  assert.equal(store.getSnapshot().busy, false);
});

test('a short raw page is terminal even if a next Link is present', async (t) => {
  const store = fixture(t, 'pat');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify([repository(1, 'one')]), {
      headers: { Link: '<https://api.github.com/ignored?page=2>; rel="next"' },
    });
  };
  await store.open('owner');
  assert.equal(store.getSnapshot().public.more, false);
  assert.equal(store.getSnapshot().authenticated.more, false);
  for (let i = 0; i < 10; i++) await store.loadMore();
  assert.equal(calls, 2);
});
