import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTokenAccess } from './tokenAccess';

const response = (
  data: unknown,
  status = 200,
  headers?: Record<string, string>,
) => new Response(JSON.stringify(data), { status, headers });
async function using(
  handler: (url: URL) => Response | Promise<Response>,
  check: (requests: URL[]) => Promise<void>,
) {
  const original = globalThis.fetch,
    requests: URL[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        'Bearer test-token',
      );
      assert.equal(init?.method, undefined);
      return handler(url);
    };
    await check(requests);
  } finally {
    globalThis.fetch = original;
  }
}
test('private repository checks each feature and reads actual reported OAuth scopes', async () => {
  await using(
    (url) =>
      url.pathname === '/user'
        ? response({ login: 'tester' }, 200, {
            'X-OAuth-Scopes': 'repo, read:user',
          })
        : url.pathname === '/repos/a/b'
          ? response({ private: true })
          : response([]),
    async (requests) => {
      const report = await checkTokenAccess(
        'a/b',
        'test-token',
        new AbortController().signal,
      );
      assert.equal(report.login, 'tester');
      assert.equal(report.privateRepo, true);
      assert.deepEqual(report.scopes, ['repo', 'read:user']);
      assert.ok(
        Object.values(report.checks).every(
          (check) => check.status === 'available',
        ),
      );
      assert.equal(requests.length, 5);
      for (const url of requests.slice(2))
        assert.equal(url.searchParams.get('per_page'), '1');
    },
  );
});
test('public access is kept distinct from a fine-grained token grant; required-permission headers are not grants', async () => {
  await using(
    (url) =>
      url.pathname === '/user'
        ? response({ login: 'tester' }, 200, {
            'X-Accepted-GitHub-Permissions': 'contents=read',
          })
        : url.pathname === '/repos/a/b'
          ? response({ private: false })
          : response([]),
    async () => {
      const report = await checkTokenAccess(
        'a/b',
        'test-token',
        new AbortController().signal,
      );
      assert.equal(report.privateRepo, false);
      assert.equal(report.scopes, undefined);
      assert.equal(report.checks.contents.status, 'available');
    },
  );
});
test('optional feature denials and temporary errors do not change other access results', async () => {
  await using(
    (url) =>
      url.pathname === '/user'
        ? response({ login: 'tester' })
        : url.pathname === '/repos/a/b'
          ? response({ private: true })
          : url.pathname.endsWith('/pulls')
            ? response({}, 500)
            : url.pathname.endsWith('/actions/runs')
              ? response({}, 403)
              : response([]),
    async () => {
      const report = await checkTokenAccess(
        'a/b',
        'test-token',
        new AbortController().signal,
      );
      assert.equal(report.checks.contents.status, 'available');
      assert.equal(report.checks.pulls.status, 'unknown');
      assert.equal(report.checks.actions.status, 'denied');
    },
  );
});
test('invalid or expired token stops repository probes and does not expose response bodies', async () => {
  await using(
    () => response({ message: 'secret test-token' }, 401),
    async (requests) => {
      const report = await checkTokenAccess(
        'a/b',
        'test-token',
        new AbortController().signal,
      );
      assert.equal(requests.length, 1);
      assert.ok(
        Object.values(report.checks).every(
          (check) => check.status === 'invalid',
        ),
      );
      assert.doesNotMatch(JSON.stringify(report), /secret|test-token/);
    },
  );
});
test('repository selection or visibility failure is access blocked rather than an invalid token', async () => {
  await using(
    (url) =>
      url.pathname === '/user'
        ? response({ login: 'tester' })
        : response({}, 404),
    async (requests) => {
      const report = await checkTokenAccess(
        'a/b',
        'test-token',
        new AbortController().signal,
      );
      assert.equal(report.login, 'tester');
      assert.ok(
        Object.values(report.checks).every(
          (check) => check.status === 'denied',
        ),
      );
      assert.equal(requests.length, 2);
    },
  );
});
test('primary and secondary limits remain unverified and expose a retry deadline', async () => {
  await using(
    () => response({}, 403, { 'Retry-After': '90' }),
    async () => {
      const report = await checkTokenAccess(
        'a/b',
        'test-token',
        new AbortController().signal,
      );
      assert.ok(report.retryAt > Date.now());
      assert.ok(
        Object.values(report.checks).every(
          (check) => check.status === 'limited',
        ),
      );
    },
  );
});
test('no token sends no requests; no repository validates identity without claiming any feature access', async () => {
  await using(
    () => response({ login: 'tester' }),
    async (requests) => {
      const empty = await checkTokenAccess(
        'a/b',
        '',
        new AbortController().signal,
      );
      assert.equal(requests.length, 0);
      assert.equal(empty.checks.contents.status, 'unchecked');
      const user = await checkTokenAccess(
        '',
        'test-token',
        new AbortController().signal,
      );
      assert.equal(requests.length, 1);
      assert.equal(user.login, 'tester');
      assert.equal(user.checks.actions.status, 'unchecked');
    },
  );
});
test('cancelling an old token check cannot return a report or start repository probes', async () => {
  let release!: (response: Response) => void;
  await using(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    async (requests) => {
      const controller = new AbortController(),
        pending = checkTokenAccess('a/b', 'test-token', controller.signal);
      controller.abort();
      release(response({ login: 'old-user' }));
      await assert.rejects(
        pending,
        (error) => error instanceof DOMException && error.name === 'AbortError',
      );
      assert.equal(requests.length, 1);
    },
  );
});
