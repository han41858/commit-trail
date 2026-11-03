import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MonitorRepositories,
  MONITOR_REPOSITORIES_KEY,
  normalizeMonitorRepositories,
  moveMonitorRepository,
} from './MonitorRepositories';

function setup(raw: unknown = ['public/one', 'private/one', 'unknown/one']) {
  const data = new Map([
    [MONITOR_REPOSITORIES_KEY, JSON.stringify(raw)],
    ['unrelated', 'keep'],
  ]);
  let allowed = true,
    writer = true;
  const publicNames = ['public/one'];
  const options = {
    storage: () => ({
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    }),
    publicRepositories: () => publicNames,
    allowPrivate: () => allowed,
    canWrite: () => writer,
  };
  const store = new MonitorRepositories(options);
  return {
    store,
    data,
    options,
    publicNames,
    allow: (value: boolean) => {
      allowed = value;
    },
    write: (value: boolean) => {
      writer = value;
    },
  };
}
test('monitor names normalize URLs and case, preserve order, deduplicate and stop at four', () => {
  assert.deepEqual(
    normalizeMonitorRepositories([
      'https://github.com/OWNER/Repo.git',
      'owner/repo',
      null,
      'bad input',
      'other/two',
      'other/three',
      'other/four',
      'other/five',
    ]),
    ['owner/repo', 'other/two', 'other/three', 'other/four'],
  );
  for (const value of [null, {}, 'bad']) assert.deepEqual(normalizeMonitorRepositories(value), []);
});
test('moving monitor repositories changes order without mutating, duplicating or removing selections', () => {
  const names = ['a/one', 'b/two', 'c/three', 'd/four'];
  assert.deepEqual(moveMonitorRepository(names, 'a/one', 3), [
    'b/two',
    'c/three',
    'd/four',
    'a/one',
  ]);
  assert.deepEqual(moveMonitorRepository(names, 'd/four', 0), [
    'd/four',
    'a/one',
    'b/two',
    'c/three',
  ]);
  assert.deepEqual(names, ['a/one', 'b/two', 'c/three', 'd/four']);
});
test('keyboard moves clamp at either end and invalid or unchanged moves preserve the same array', () => {
  const names = ['a/one', 'b/two'];
  for (const [repository, to] of [
    ['a/one', -1],
    ['b/two', 5],
    ['missing/repo', 0],
    ['a/one', NaN],
  ] as const)
    assert.equal(moveMonitorRepository(names, repository, to), names);
  assert.deepEqual(moveMonitorRepository(names, 'a/one', 999), ['b/two', 'a/one']);
});
test('only names are persisted and a new instance restores the chosen order', () => {
  const { store, data, options } = setup([]);
  store.set(['B/Two', 'A/One']);
  assert.deepEqual(JSON.parse(data.get(MONITOR_REPOSITORIES_KEY)!), ['b/two', 'a/one']);
  assert.equal(data.get('unrelated'), 'keep');
  assert.deepEqual(new MonitorRepositories(options).getSnapshot(), ['b/two', 'a/one']);
});
test('first PAT, replacement and removal keep known public monitor names and discard private or unclassified names', () => {
  for (const [previous, next] of [
    ['', 'first'],
    ['old', 'new'],
    ['old', ''],
  ]) {
    const { store, data } = setup();
    store.authenticationChanged(previous, next);
    assert.deepEqual(store.getSnapshot(), ['public/one']);
    assert.deepEqual(JSON.parse(data.get(MONITOR_REPOSITORIES_KEY)!), ['public/one']);
    assert.equal(data.get('unrelated'), 'keep');
  }
});
test('the same PAT and its restoration preserve the saved monitor selection', () => {
  const { store, options } = setup();
  store.authenticationChanged('same', 'same');
  assert.deepEqual(store.getSnapshot(), ['public/one', 'private/one', 'unknown/one']);
  assert.deepEqual(new MonitorRepositories(options).getSnapshot(), store.getSnapshot());
});
test('unauthenticated names persist only after public metadata has confirmed them', () => {
  const { store, data, publicNames, allow } = setup([]);
  allow(false);
  store.set(['new/public', 'public/one', 'new/unknown']);
  assert.deepEqual(JSON.parse(data.get(MONITOR_REPOSITORIES_KEY)!), ['public/one']);
  publicNames.push('new/public');
  store.reconcile();
  assert.deepEqual(store.getSnapshot(), ['new/public', 'public/one']);
  assert.deepEqual(JSON.parse(data.get(MONITOR_REPOSITORIES_KEY)!), ['new/public', 'public/one']);
});
test('an outdated authentication tab hides private names and cannot overwrite the current selection', () => {
  const { store, data, allow, write } = setup();
  allow(false);
  write(false);
  data.set(MONITOR_REPOSITORIES_KEY, JSON.stringify(['public/one', 'private/new']));
  store.reload();
  assert.deepEqual(store.getSnapshot(), ['public/one']);
  store.reconcile();
  assert.deepEqual(JSON.parse(data.get(MONITOR_REPOSITORIES_KEY)!), ['public/one', 'private/new']);
});
test('invalid storage data is sanitized, storage errors leave in-memory monitoring available', () => {
  const { data, options } = setup();
  data.set(MONITOR_REPOSITORIES_KEY, 'bad JSON');
  assert.deepEqual(new MonitorRepositories(options).getSnapshot(), []);
  const store = new MonitorRepositories({
    ...options,
    storage: () => {
      throw new Error('blocked');
    },
  });
  assert.doesNotThrow(() => {
    store.set(['public/one']);
    store.authenticationChanged('a', 'b');
  });
  assert.deepEqual(store.getSnapshot(), ['public/one']);
  const quota = new MonitorRepositories({
    ...options,
    storage: () => ({
      ...options.storage(),
      setItem() {
        throw new Error('quota');
      },
    }),
  });
  assert.doesNotThrow(() => quota.set(['public/one']));
  assert.deepEqual(quota.getSnapshot(), ['public/one']);
});
