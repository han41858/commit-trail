import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubReader } from './GitHubReader';
test('conditional requests reuse 304 data, pagination and ETag without reading a body', async () => {
  const original = fetch;
  const reader = new GitHubReader('test');
  let calls = 0;
  try {
    globalThis.fetch = async (_input, init) => {
      calls++;
      if (calls === 1)
        return new Response('[1]', {
          headers: {
            ETag: '"a"',
            Link: '<https://api.github.com/page2>; rel="next"',
          },
        });
      assert.equal(
        (init?.headers as Record<string, string>)['If-None-Match'],
        '"a"',
      );
      return new Response(null, { status: 304 });
    };
    const a = await reader.get('/repos/a/b/tags');
    const b = await reader.get('/repos/a/b/tags');
    assert.equal(a, b);
    assert.equal(b.next, true);
    assert.deepEqual(b.data, [1]);
  } finally {
    reader.cancel();
    globalThis.fetch = original;
  }
});
test('duplicate fetches share one request and rate limits prevent early retries', async () => {
  const original = fetch;
  const reader = new GitHubReader('');
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response('{}', {
        status: 429,
        headers: { 'Retry-After': '30' },
      });
    };
    await Promise.allSettled([reader.get('/x'), reader.get('/x')]);
    assert.equal(calls, 1);
    await assert.rejects(reader.get('/x'));
    assert.equal(calls, 1);
  } finally {
    reader.cancel();
    globalThis.fetch = original;
  }
});
