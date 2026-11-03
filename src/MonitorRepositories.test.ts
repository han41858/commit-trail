import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MonitorRepositories,
  MONITOR_REPOSITORIES_KEY,
  MONITOR_PUBLIC_REPOSITORIES_KEY,
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
test('monitor names normalize URLs and case, preserve order and deduplicate', () => {
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
    ['owner/repo', 'other/two', 'other/three', 'other/four', 'other/five'],
  );
  for (const value of [null, {}, 'bad']) assert.deepEqual(normalizeMonitorRepositories(value), []);
});
test('32 distinct valid repositories survive normalization and storage, with overflow discarded after deduplication', () => {
  const names = Array.from({ length: 32 }, (_, index) => `owner/repo-${index}`);
  const input = [
    null,
    'invalid',
    ...names.flatMap((name) => [name.toUpperCase(), name]),
    'extra/repo',
  ];
  assert.deepEqual(normalizeMonitorRepositories(input), names);
  const { store, data, options } = setup();
  store.set(input.filter((value): value is string => typeof value === 'string'));
  assert.deepEqual(store.getSnapshot(), names);
  assert.deepEqual(JSON.parse(data.get(MONITOR_REPOSITORIES_KEY)!), names);
  assert.deepEqual(new MonitorRepositories(options).getSnapshot(), names);
  assert.deepEqual(moveMonitorRepository(names, names[31], 0), [names[31], ...names.slice(0, 31)]);
});
test('existing one-to-four repository selections restore without migration', () => {
  for (const count of [1, 2, 3, 4]) {
    const names = Array.from({ length: count }, (_, index) => `owner/repo-${index}`);
    const { store, data } = setup(names);
    assert.deepEqual(store.getSnapshot(), names);
    assert.deepEqual(JSON.parse(data.get(MONITOR_REPOSITORIES_KEY)!), names);
  }
});
test('a new 32-name incoming selection keeps a reobserved public name from the previous group', () => {
  const { store, publicNames, allow } = setup([]);
  allow(false);
  const prior = Array.from({ length: 32 }, (_, index) => `prior/repo-${index}`);
  const incoming = [prior[0], ...Array.from({ length: 31 }, (_, index) => `next/repo-${index}`)];
  for (const name of [...prior, ...incoming]) {
    publicNames.push(name);
    publicNames.splice(0, Math.max(0, publicNames.length - 10));
    store.repositoryMetadata(name, false);
  }
  store.set(incoming);
  assert.deepEqual(store.getSnapshot(), incoming);
});
test('32 confirmed public selections survive eviction from ten recent visits without retaining private names', () => {
  const names = Array.from({ length: 32 }, (_, index) => `owner/repo-${index}`);
  const { store, data, options, publicNames, allow } = setup(names);
  allow(false);
  for (const name of names) {
    publicNames.push(name);
    publicNames.splice(0, Math.max(0, publicNames.length - 10));
    store.repositoryMetadata(name, false);
  }
  assert.deepEqual(store.getSnapshot(), names);
  assert.deepEqual(JSON.parse(data.get(MONITOR_REPOSITORIES_KEY)!), names);
  assert.deepEqual(JSON.parse(data.get(MONITOR_PUBLIC_REPOSITORIES_KEY)!), names);
  assert.deepEqual(new MonitorRepositories(options).getSnapshot(), names);
  store.authenticationChanged('old-token', '');
  assert.deepEqual(store.getSnapshot(), names);
  publicNames.splice(publicNames.indexOf(names[31]), 1);
  store.repositoryMetadata(names[31], true);
  const publicOnly = names.slice(0, 31);
  assert.deepEqual(store.getSnapshot(), publicOnly);
  assert.deepEqual(new MonitorRepositories(options).getSnapshot(), publicOnly);
  assert.deepEqual(JSON.parse(data.get(MONITOR_PUBLIC_REPOSITORIES_KEY)!), publicOnly);
  assert.ok(!data.get(MONITOR_PUBLIC_REPOSITORIES_KEY)!.includes('old-token'));
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
