import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestActivity } from './requestActivity';
import { github } from './api';
import { GitHubReader } from './GitHubReader';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('repository counts are independent, case-insensitive and published with the global total', () => {
  const snapshots: number[][] = [];
  const unsubscribe = requestActivity.subscribe(() => {
    snapshots.push([
      requestActivity.getSnapshot(),
      requestActivity.getSnapshot('owner/one'),
      requestActivity.getSnapshot('owner/two'),
    ]);
  });
  const first = requestActivity.begin(undefined, 'Owner/One');
  const second = requestActivity.begin(undefined, 'owner/one');
  const other = requestActivity.begin(undefined, 'owner/two');
  const identity = requestActivity.begin();
  try {
    assert.deepEqual(snapshots.at(-1), [4, 2, 1]);
    assert.equal(requestActivity.getSnapshot('OWNER/ONE'), 2);
    assert.equal(requestActivity.getSnapshot('owner/absent'), 0);
    first();
    assert.deepEqual(snapshots.at(-1), [3, 1, 1]);
    other();
    assert.deepEqual(snapshots.at(-1), [2, 1, 0]);
  } finally {
    first();
    second();
    other();
    identity();
    unsubscribe();
  }
  assert.deepEqual(snapshots.at(-1), [0, 0, 0]);
});

test('queued work is excluded from both global and repository HTTP counts', () => {
  requestActivity.queue(5);
  const finish = requestActivity.begin(undefined, 'owner/one');
  try {
    assert.equal(requestActivity.getQueuedSnapshot(), 5);
    assert.equal(requestActivity.getSnapshot(), 1);
    assert.equal(requestActivity.getSnapshot('owner/one'), 1);
  } finally {
    finish();
    requestActivity.queue(-5);
  }
  assert.equal(requestActivity.getSnapshot('owner/one'), 0);
});

test('abort, duplicate completion and already-aborted work cannot leave or decrement stale counts', () => {
  const controller = new AbortController();
  const finish = requestActivity.begin(controller.signal, 'owner/one');
  controller.abort();
  finish();
  finish();
  requestActivity.begin(controller.signal, 'owner/one')();
  assert.equal(requestActivity.getSnapshot(), 0);
  assert.equal(requestActivity.getSnapshot('owner/one'), 0);
  const next = requestActivity.begin(undefined, 'owner/one');
  assert.equal(requestActivity.getSnapshot('owner/one'), 1);
  next();
  assert.equal(requestActivity.getSnapshot('owner/one'), 0);
});

test('real API accounting includes response-body parsing and extracts only the repository', async (t) => {
  let resolve!: (value: unknown[]) => void;
  const body = new Promise<unknown[]>((done) => {
    resolve = done;
  });
  const response = new Response('[]');
  t.mock.method(response, 'json', () => body);
  const fetch = t.mock.method(globalThis, 'fetch', async () => response);
  const request = github('/repos/Owner/One/actions/runs?branch=Feature%2FPrivate', '');
  try {
    await tick();
    assert.equal(requestActivity.getSnapshot(), 1);
    assert.equal(requestActivity.getSnapshot('owner/one'), 1);
    assert.equal(requestActivity.getSnapshot('owner/two'), 0);
  } finally {
    resolve([]);
    await request;
  }
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(requestActivity.getSnapshot('owner/one'), 0);
});

test('304, HTTP failure and network failure all release their repository counts', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  const cached = { data: ['cached'], next: false, etag: '"test"' };
  fetch.mock.mockImplementation(async () => new Response(null, { status: 304 }));
  assert.equal(await github('/repos/owner/one/tags', '', undefined, cached), cached);
  assert.equal(requestActivity.getSnapshot('owner/one'), 0);
  fetch.mock.mockImplementation(async () => new Response('{}', { status: 500 }));
  await assert.rejects(github('/repos/owner/one/tags', ''));
  assert.equal(requestActivity.getSnapshot('owner/one'), 0);
  fetch.mock.mockImplementation(async () => {
    throw new Error('Network unavailable');
  });
  await assert.rejects(github('/repos/owner/one/tags', ''));
  assert.equal(requestActivity.getSnapshot(), 0);
  assert.equal(requestActivity.getSnapshot('owner/one'), 0);
});

test('shared and immutable cached reader requests are not counted twice', async (t) => {
  let resolve!: (value: Response) => void;
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  const fetch = t.mock.method(globalThis, 'fetch', () => response);
  const reader = new GitHubReader('');
  const first = reader.get('/repos/owner/one/tags', true);
  const second = reader.get('/repos/owner/one/tags', true);
  await tick();
  try {
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(requestActivity.getSnapshot('owner/one'), 1);
    resolve(new Response('[]'));
    await Promise.all([first, second]);
    assert.equal(requestActivity.getSnapshot('owner/one'), 0);
    await reader.get('/repos/owner/one/tags', true);
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(requestActivity.getSnapshot('owner/one'), 0);
  } finally {
    resolve(new Response('[]'));
    await Promise.all([first, second]);
    reader.cancel();
  }
  assert.equal(requestActivity.getSnapshot('owner/one'), 0);
});

test('identity requests contribute only to the global count', async (t) => {
  let resolve!: (value: Response) => void;
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  t.mock.method(globalThis, 'fetch', () => response);
  const request = github('/user', '');
  assert.equal(requestActivity.getSnapshot(), 1);
  assert.equal(requestActivity.getSnapshot('owner/one'), 0);
  resolve(new Response('{}'));
  await request;
  assert.equal(requestActivity.getSnapshot(), 0);
});
