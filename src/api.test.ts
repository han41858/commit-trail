import { test } from 'node:test';
import assert from 'node:assert/strict';
import { github, commitsPage, branchesPage } from './api';
import { requestActivity } from './requestActivity';
test('pagination uses 100 commits and encoded branch; token only sent to GitHub', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(
        input,
        'https://api.github.com/repos/a/b/commits?sha=feat%2Ftest&per_page=100&page=2',
      );
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        'Bearer test-token',
      );
      return new Response('[]', {
        headers: { Link: '<https://api.github.com/x?page=3>; rel="next"' },
      });
    };
    assert.equal(
      (await commitsPage('a/b', 'feat/test', 2, 'test-token')).next,
      true,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('branch pagination and unauthenticated request', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(
        input,
        'https://api.github.com/repos/a/b/branches?per_page=100&page=2',
      );
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        undefined,
      );
      return new Response('[]');
    };
    assert.equal((await branchesPage('a/b', 2, '')).next, false);
  } finally {
    globalThis.fetch = original;
  }
});
test('API errors are safe, distinct and retryable', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 404, 409, 429, 500]) {
      globalThis.fetch = async () =>
        new Response('sensitive response', { status });
      await assert.rejects(
        github('/repos/a/b', 'secret'),
        (e) =>
          e instanceof Error &&
          !e.message.includes('sensitive') &&
          !e.message.includes('secret'),
      );
    }
    globalThis.fetch = async () => new Response('[]');
    assert.deepEqual((await github('/repos/a/b', '')).data, []);
  } finally {
    globalThis.fetch = original;
  }
});
test('network and cancellation errors', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError('network');
    };
    await assert.rejects(github('/repos/a/b', ''), /Could not reach/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(github('/repos/a/b', '', controller.signal));
  } finally {
    globalThis.fetch = original;
  }
});

test('primary and secondary rate limits include a retry deadline; permission errors stay distinct', async () => {
  const original = globalThis.fetch;
  try {
    const reset = Math.ceil(Date.now() / 1000) + 1800;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ message: 'sensitive rate limit exceeded' }),
        {
          status: 403,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(reset),
          },
        },
      );
    await assert.rejects(
      github('/repos/a/b', ''),
      (e: any) =>
        e.retryAt === reset * 1000 &&
        e.message.includes('rate limit') &&
        !e.message.includes('sensitive') &&
        e.message.includes('access token'),
    );
    const before = Date.now();
    globalThis.fetch = async () =>
      new Response('{}', { status: 429, headers: { 'Retry-After': '120' } });
    await assert.rejects(
      github('/repos/a/b', 'test-token'),
      (e: any) =>
        e.retryAt >= before + 120000 &&
        e.message.includes('rate limit') &&
        !e.message.includes('test-token'),
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          message: 'Resource not accessible by personal access token',
        }),
        { status: 403 },
      );
    await assert.rejects(
      github('/repos/a/b', 'test-token'),
      (e: any) =>
        !e.retryAt &&
        e.message.includes('denied access') &&
        !e.message.includes('rate limit'),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('last-page metadata supplies the oldest starting page without following external links', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response('[]', {
        headers: {
          Link: '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=392>; rel="last"',
        },
      });
    };
    const page = await commitsPage('a/b', 'main', 1, '');
    assert.equal(page.next, true);
    assert.equal(page.lastPage, 392);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('active history is restricted to the current date window and activity is ordered by time', async () => {
  const original = globalThis.fetch;
  const requests: URL[] = [];
  try {
    globalThis.fetch = async (input) => {
      requests.push(new URL(String(input)));
      return new Response('[]');
    };
    await commitsPage(
      'a/b',
      'release-sha',
      1,
      '',
      undefined,
      Date.parse('2026-10-25T00:00:00Z'),
    );
    assert.equal(
      requests[0].searchParams.get('since'),
      '2026-10-25T00:00:00.000Z',
    );
    const { branchActivityPage } = await import('./api');
    await branchActivityPage('a/b', 'next-cursor', '');
    assert.equal(requests[1].pathname, '/repos/a/b/activity');
    assert.equal(requests[1].searchParams.get('direction'), 'desc');
    assert.equal(requests[1].searchParams.get('after'), 'next-cursor');
    assert.equal(requests[1].searchParams.has('page'), false);
    assert.equal(requests[1].searchParams.has('activity_type'), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('repository activity follows the opaque after cursor from Link instead of a numeric page', async () => {
  const original = globalThis.fetch;
  const requests: URL[] = [];
  const cursor = 'Y3Vyc29y:+/=token';
  try {
    globalThis.fetch = async (input) => {
      requests.push(new URL(String(input)));
      return new Response('[]', {
        headers: {
          Link: `<https://api.github.com/repositories/123/activity?after=${encodeURIComponent(cursor)}>; rel="next"`,
        },
      });
    };
    const { branchActivityPage } = await import('./api');
    const first = await branchActivityPage('a/b', undefined, '');
    assert.equal(first.nextCursor, cursor);
    await branchActivityPage('a/b', first.nextCursor, '');
    assert.equal(requests[1].searchParams.get('after'), cursor);
    assert.equal(requests[1].searchParams.has('page'), false);
    assert.equal(requests[1].searchParams.has('activity_type'), false);
    assert.equal(requests[1].pathname, '/repos/a/b/activity');
  } finally {
    globalThis.fetch = original;
  }
});

test('request activity counts HTTP work through body parsing and clears failed requests', async () => {
  const original = globalThis.fetch;
  let body!: (value: unknown) => void, fail!: (value: Response) => void;
  const firstBody = new Promise((resolve) => {
      body = resolve;
    }),
    secondResponse = new Promise<Response>((resolve) => {
      fail = resolve;
    });
  const counts: number[] = [];
  const stop = requestActivity.subscribe(() =>
    counts.push(requestActivity.getSnapshot()),
  );
  try {
    globalThis.fetch = async (input) => {
      if (String(input).endsWith('/first')) {
        const result = new Response('[]');
        result.json = () => firstBody;
        return result;
      }
      return secondResponse;
    };
    const first = github('/first', ''),
      second = github('/second', '');
    assert.equal(requestActivity.getSnapshot(), 2);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requestActivity.getSnapshot(), 2);
    body([]);
    await first;
    assert.equal(requestActivity.getSnapshot(), 1);
    fail(new Response('', { status: 500 }));
    await assert.rejects(second, /500/);
    assert.equal(requestActivity.getSnapshot(), 0);
    assert.deepEqual(counts, [1, 2, 1, 0]);
  } finally {
    stop();
    globalThis.fetch = original;
  }
});

test('aborted requests stop counting immediately and late completion cannot decrement a new request', async () => {
  const original = globalThis.fetch;
  const releases: ((value: Response) => void)[] = [];
  try {
    globalThis.fetch = () =>
      new Promise((resolve) => {
        releases.push(resolve);
      });
    const controller = new AbortController(),
      old = github('/old', '', controller.signal);
    assert.equal(requestActivity.getSnapshot(), 1);
    controller.abort();
    assert.equal(requestActivity.getSnapshot(), 0);
    const current = github('/current', '');
    assert.equal(requestActivity.getSnapshot(), 1);
    releases[0](new Response('[]'));
    await old;
    assert.equal(requestActivity.getSnapshot(), 1);
    releases[1](new Response('[]'));
    await current;
    assert.equal(requestActivity.getSnapshot(), 0);
  } finally {
    globalThis.fetch = original;
  }
});
