import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_STORAGE_KEY } from './tokenStorage';
import {
  RecentRepositories,
  RECENT_REPOSITORIES_KEY,
  normalizeRecentRepositories,
  matchingRecentRepositories,
  type RecentRepository,
} from './RecentRepositories';

class MemoryStorage {
  data = new Map<string, string>();
  writes = 0;
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = (key: string, value: string) => {
    this.writes++;
    this.data.set(key, value);
  };
  removeItem = (key: string) => {
    this.writes++;
    this.data.delete(key);
  };
}
const row = (
  repository: string,
  visibility: 'public' | 'private' = 'public',
  visitedAt = 100,
): RecentRepository => ({ repository, visibility, visitedAt });
const setup = (entries: unknown = [], allowPrivate = () => true) => {
  const storage = new MemoryStorage();
  storage.data.set(RECENT_REPOSITORIES_KEY, JSON.stringify(entries));
  let now = 1000;
  const store = new RecentRepositories({ storage: () => storage, now: () => now++, allowPrivate });
  return { store, storage };
};

test('successful visits normalize names, deduplicate and move a revisited repository to the top', () => {
  const { store } = setup();
  store.record('Angular/Angular', false);
  store.record('Other/Project', false);
  store.record('https://github.com/ANGULAR/Angular.git', false);
  assert.deepEqual(store.getSnapshot().entries, [
    row('angular/angular', 'public', 1002),
    row('other/project', 'public', 1001),
  ]);
});
test('only the latest ten visits remain and restore in the same order', () => {
  const { store, storage } = setup();
  for (let i = 0; i < 13; i++) store.record(`owner/repo-${i}`, false);
  assert.equal(store.getSnapshot().entries.length, 10);
  assert.equal(store.getSnapshot().entries[0].repository, 'owner/repo-12');
  assert.equal(store.getSnapshot().entries[9].repository, 'owner/repo-3');
  const restored = new RecentRepositories({ storage: () => storage });
  assert.deepEqual(restored.getSnapshot().entries, store.getSnapshot().entries);
});
test('validation removes malformed fields, duplicates and unknown properties without retaining secrets', () => {
  const { store, storage } = setup([
    row('Owner/Repo', 'public', 9),
    row('owner/repo', 'private', 11),
    {
      ...row('other/valid', 'public', 10),
      token: 'PRIVATE_PAT',
      response: { message: 'PRIVATE_BODY' },
    },
    null,
    [],
    { repository: '../invalid', visibility: 'public', visitedAt: 10 },
    row('bad/date', 'public', -1),
    { repository: 'bad/type', visibility: 'public', visitedAt: '12' },
    { repository: 'bad/visibility', visibility: 'unknown', visitedAt: 12 },
  ]);
  assert.deepEqual(store.getSnapshot().entries, [
    row('owner/repo', 'private', 11),
    row('other/valid', 'public', 10),
  ]);
  const saved = storage.getItem(RECENT_REPOSITORIES_KEY)!;
  assert.ok(!saved.includes('PRIVATE'));
  assert.deepEqual(Object.keys(JSON.parse(saved)[0]).sort(), [
    'repository',
    'visibility',
    'visitedAt',
  ]);
});
test('invalid JSON and non-array values are cleared while the feature remains available', () => {
  for (const raw of ['broken JSON', 'null', '{}', '42']) {
    const storage = new MemoryStorage();
    storage.data.set(RECENT_REPOSITORIES_KEY, raw);
    const store = new RecentRepositories({ storage: () => storage });
    assert.equal(store.getSnapshot().available, true);
    assert.deepEqual(store.getSnapshot().entries, []);
    assert.equal(storage.getItem(RECENT_REPOSITORIES_KEY), null);
  }
});
test('timestamp validation rejects nonfinite and unsafe dates and keeps equal-date input order', () => {
  assert.deepEqual(
    normalizeRecentRepositories([
      row('a/one', 'public', 10),
      row('a/two', 'public', 10),
      row('a/bad', 'public', NaN),
      row('a/huge', 'public', Number.MAX_SAFE_INTEGER + 1),
      row('a/float', 'public', 1.5),
    ]),
    [row('a/one', 'public', 10), row('a/two', 'public', 10)],
  );
});
test('search is a local case-insensitive substring match and supports GitHub URL input', () => {
  const entries = [row('angular/angular'), row('han41858/commit-trail'), row('other/project')];
  assert.deepEqual(matchingRecentRepositories(entries, ''), entries);
  assert.deepEqual(matchingRecentRepositories(entries, 'TRAIL'), [entries[1]]);
  assert.deepEqual(matchingRecentRepositories(entries, '41858'), [entries[1]]);
  assert.deepEqual(matchingRecentRepositories(entries, 'https://github.com/ANGULAR/angular.git/'), [
    entries[0],
  ]);
  assert.deepEqual(matchingRecentRepositories(entries, ':debug'), []);
});
test('the unchanged current address shows all recent visits in visit order, while other input is filtered', () => {
  const entries = [row('angular/angular'), row('han41858/commit-trail'), row('other/project')];
  assert.deepEqual(
    matchingRecentRepositories(entries, 'han41858/commit-trail', 'han41858/commit-trail'),
    entries,
  );
  assert.deepEqual(matchingRecentRepositories(entries, 'angular', 'han41858/commit-trail'), [
    entries[0],
  ]);
  assert.deepEqual(matchingRecentRepositories(entries, 'han41858/commit-trail'), [entries[1]]);
  assert.deepEqual(
    matchingRecentRepositories(entries, 'missing/repo', 'han41858/commit-trail'),
    [],
  );
});
test('first PAT registration, replacement and deletion clear only private visits', () => {
  for (const [previous, next] of [
    ['', 'first-pat'],
    ['old-pat', 'new-pat'],
    ['old-pat', ''],
  ]) {
    const { store, storage } = setup([
      row('public/repository'),
      row('private/repository', 'private', 90),
    ]);
    storage.data.set('unrelated.setting', 'keep');
    store.authenticationChanged(previous, next);
    assert.deepEqual(store.getSnapshot().entries, [row('public/repository')]);
    assert.equal(storage.getItem('unrelated.setting'), 'keep');
    assert.ok(!storage.getItem(RECENT_REPOSITORIES_KEY)!.includes('pat'));
  }
});
test('the same PAT and construction after reload do not erase private visits', () => {
  const { store, storage } = setup([row('private/repository', 'private')]);
  const writes = storage.writes;
  store.authenticationChanged('same-pat', 'same-pat');
  assert.equal(storage.writes, writes);
  assert.deepEqual(new RecentRepositories({ storage: () => storage }).getSnapshot().entries, [
    row('private/repository', 'private'),
  ]);
});
test('a private repository can register again after authentication changes', () => {
  const { store } = setup([row('old/repo', 'private')]);
  store.authenticationChanged('old-pat', 'new-pat');
  store.record('new/repo', true);
  assert.deepEqual(store.getSnapshot().entries, [row('new/repo', 'private', 1000)]);
});
test('visibility is supplied by metadata, including public repositories opened with a PAT', () => {
  const { store } = setup();
  store.record('a/repo', false);
  store.record('a/repo', true);
  assert.equal(store.getSnapshot().entries[0].visibility, 'private');
  store.authenticationChanged('old', 'new');
  assert.deepEqual(store.getSnapshot().entries, []);
  store.record('a/repo', false);
  store.authenticationChanged('new', 'other');
  assert.equal(store.getSnapshot().entries[0].visibility, 'public');
});
test('refresh updates known visibility but never re-adds deleted entries or changes visit time', () => {
  const { store, storage } = setup([row('a/one', 'public', 100), row('a/two', 'public', 90)]);
  const writes = storage.writes;
  store.repositoryMetadata('a/one', false, false);
  assert.equal(storage.writes, writes);
  store.repositoryMetadata('a/one', true, false);
  assert.deepEqual(store.getSnapshot().entries, [
    row('a/one', 'private', 100),
    row('a/two', 'public', 90),
  ]);
  store.clear();
  store.repositoryMetadata('a/one', true, false);
  assert.deepEqual(store.getSnapshot().entries, []);
  store.repositoryMetadata('a/one', true, true);
  assert.deepEqual(store.getSnapshot().entries, [row('a/one', 'private', 1000)]);
});
test('touching the current repository preserves the latest known visibility without a request', () => {
  const { store } = setup([row('a/one', 'public', 10), row('a/two', 'public', 20)]);
  store.updateVisibility('a/one', true);
  store.touch('a/one');
  assert.deepEqual(store.getSnapshot().entries, [
    row('a/one', 'private', 1000),
    row('a/two', 'public', 20),
  ]);
  store.remove('a/one');
  store.touch('a/one');
  assert.equal(store.getSnapshot().entries.length, 1);
});
test('individual and all-history deletion preserve unrelated browser data', () => {
  const { store, storage } = setup([row('a/one'), row('a/two', 'private', 90)]);
  storage.data.set(TOKEN_STORAGE_KEY, 'FAKE_TEST_TOKEN');
  store.remove('A/One');
  assert.deepEqual(store.getSnapshot().entries, [row('a/two', 'private', 90)]);
  store.clear();
  assert.equal(storage.getItem(RECENT_REPOSITORIES_KEY), null);
  assert.equal(storage.getItem(TOKEN_STORAGE_KEY), 'FAKE_TEST_TOKEN');
  store.record('new/visit', false);
  assert.equal(store.getSnapshot().entries[0].repository, 'new/visit');
});
test('unavailable storage disables only the history store and never throws', () => {
  for (const storage of [
    () => {
      throw new Error('denied');
    },
    () => ({
      getItem() {
        throw new Error('read denied');
      },
      setItem() {
        throw new Error('write denied');
      },
      removeItem() {
        throw new Error('remove denied');
      },
    }),
  ]) {
    const store = new RecentRepositories({ storage });
    assert.equal(store.getSnapshot().available, false);
    assert.doesNotThrow(() => {
      store.record('a/repo', false);
      store.authenticationChanged('a', 'b');
      store.remove('a/repo');
      store.clear();
      store.reload();
    });
    assert.deepEqual(store.getSnapshot().entries, []);
  }
});
test('write failures hide the feature and remove stale private data when removal remains available', () => {
  const memory = new MemoryStorage();
  memory.data.set(RECENT_REPOSITORIES_KEY, JSON.stringify([row('private/old', 'private')]));
  const store = new RecentRepositories({
    storage: () => ({
      getItem: memory.getItem,
      setItem() {
        throw new Error('quota exceeded');
      },
      removeItem: memory.removeItem,
    }),
  });
  store.record('new/visit', false);
  assert.equal(store.getSnapshot().available, false);
  assert.deepEqual(store.getSnapshot().entries, []);
  assert.equal(memory.getItem(RECENT_REPOSITORIES_KEY), null);
});
test('an outdated authentication context cannot show or append private visits from another tab', () => {
  let allowed = true;
  const { store, storage } = setup(
    [row('public/one'), row('private/old', 'private', 90)],
    () => allowed,
  );
  const other = new RecentRepositories({ storage: () => storage, now: () => 200 });
  other.authenticationChanged('old', 'new');
  other.record('private/new', true);
  allowed = false;
  store.reload();
  assert.deepEqual(store.getSnapshot().entries, [row('public/one')]);
  store.record('private/old', true);
  store.record('public/two', false);
  assert.ok(!storage.getItem(RECENT_REPOSITORIES_KEY)!.includes('private/old'));
  assert.ok(storage.getItem(RECENT_REPOSITORIES_KEY)!.includes('private/new'));
  allowed = true;
  store.reload();
  assert.ok(store.getSnapshot().entries.some((entry) => entry.repository === 'private/new'));
});
test('mutations re-read shared storage so stale snapshots cannot resurrect deleted private visits', () => {
  const { store, storage } = setup([row('private/old', 'private')]);
  const second = new RecentRepositories({ storage: () => storage });
  second.authenticationChanged('a', 'b');
  store.record('public/new', false);
  assert.deepEqual(
    store.getSnapshot().entries.map((entry) => entry.repository),
    ['public/new'],
  );
});
test('stable snapshots and listeners do not update on unchanged reads or refreshes', () => {
  const { store } = setup([row('a/repo')]);
  const snapshot = store.getSnapshot();
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  store.reload();
  store.updateVisibility('a/repo', false);
  store.remove('missing/repo');
  assert.equal(updates, 0);
  assert.equal(store.getSnapshot(), snapshot);
  store.record('b/repo', false);
  assert.equal(updates, 1);
  unsubscribe();
  store.clear();
  assert.equal(updates, 1);
});
