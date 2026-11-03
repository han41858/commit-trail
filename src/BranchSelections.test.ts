import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BranchSelections, BRANCH_SELECTIONS_KEY } from './BranchSelections';
import { branchName } from './branchName';
class MemoryStorage {
  data = new Map<string, string>();
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = (key: string, value: string) => {
    this.data.set(key, value);
  };
  removeItem = (key: string) => {
    this.data.delete(key);
  };
}
test('branch records normalize only repository names and restore independently', () => {
  const storage = new MemoryStorage(),
    store = new BranchSelections({ storage: () => storage });
  store.record('Owner/Repo', 'Feature/日本語+Fix', false);
  store.record('other/repo', 'dev', false);
  const restored = new BranchSelections({ storage: () => storage });
  assert.equal(restored.get('OWNER/REPO'), 'Feature/日本語+Fix');
  assert.equal(restored.get('other/repo'), 'dev');
  store.record('owner/repo', 'Main', false);
  assert.equal(store.get('owner/repo'), 'Main');
  assert.equal(store.get('other/repo'), 'dev');
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(BRANCH_SELECTIONS_KEY)!)[0]).sort(), [
    'branch',
    'repository',
    'visibility',
  ]);
});
test('PAT registration, replacement and removal drop private records while retaining public choices', () => {
  for (const [previous, next] of [
    ['', 'first'],
    ['old', 'new'],
    ['old', ''],
  ]) {
    const storage = new MemoryStorage(),
      store = new BranchSelections({ storage: () => storage });
    store.record('a/public', 'dev', false);
    store.record('a/private', 'Secret', true);
    store.authenticationChanged(previous, next);
    assert.equal(store.get('a/public'), 'dev');
    assert.equal(store.get('a/private'), undefined);
    assert.ok(!storage.getItem(BRANCH_SELECTIONS_KEY)!.includes('Secret'));
  }
});
test('metadata updates reuse the existing visibility signal without recording an automatic choice', () => {
  const store = new BranchSelections({ storage: () => new MemoryStorage() });
  store.repositoryMetadata('a/repo', false);
  assert.equal(store.get('a/repo'), undefined);
  store.record('a/repo', 'dev', false);
  store.repositoryMetadata('a/repo', true);
  store.authenticationChanged('a', 'b');
  assert.equal(store.get('a/repo'), undefined);
});
test('old tabs cannot read private choices or overwrite another authentication context', () => {
  const storage = new MemoryStorage();
  let allowed = true;
  const old = new BranchSelections({
    storage: () => storage,
    allowPrivate: () => allowed,
    canWrite: () => allowed,
  });
  old.record('a/private', 'Old', true);
  const next = new BranchSelections({ storage: () => storage });
  next.authenticationChanged('old', 'new');
  next.record('a/private', 'New', true);
  allowed = false;
  assert.equal(old.get('a/private'), undefined);
  old.record('a/public', 'main', false);
  old.record('a/private', 'Old', true);
  assert.equal(next.get('a/private'), 'New');
  assert.equal(next.get('a/public'), undefined);
});
test('missing-record cleanup cannot delete a newer selection written by another tab', () => {
  const storage = new MemoryStorage(),
    first = new BranchSelections({ storage: () => storage }),
    second = new BranchSelections({ storage: () => storage });
  first.record('a/repo', 'old', false);
  second.record('a/repo', 'new', false);
  first.forget('a/repo', 'old');
  assert.equal(second.get('a/repo'), 'new');
});
test('denied reads and failed writes never throw and do not retain private state', () => {
  for (const storage of [
    () => {
      throw Error('denied');
    },
    () => ({
      getItem() {
        throw Error('denied');
      },
      setItem() {
        throw Error('denied');
      },
      removeItem() {
        throw Error('denied');
      },
    }),
  ]) {
    const store = new BranchSelections({ storage });
    assert.doesNotThrow(() => {
      store.record('a/repo', 'dev', false);
      store.authenticationChanged('a', 'b');
    });
    assert.equal(store.get('a/repo'), undefined);
  }
  const memory = new MemoryStorage();
  const store = new BranchSelections({
    storage: () => ({
      getItem: memory.getItem,
      setItem() {
        throw Error('quota');
      },
      removeItem: memory.removeItem,
    }),
  });
  store.record('a/private', 'dev', true);
  assert.equal(store.get('a/private'), undefined);
  assert.equal(memory.getItem(BRANCH_SELECTIONS_KEY), null);
});
test('malformed local values and invalid ref names are ignored without losing valid records', () => {
  const storage = new MemoryStorage();
  storage.setItem(
    BRANCH_SELECTIONS_KEY,
    JSON.stringify([
      null,
      { repository: 'bad', branch: 'x', visibility: 'public' },
      { repository: 'a/repo', branch: '../bad', visibility: 'public' },
      {
        repository: 'a/good',
        branch: 'Feature/Fix',
        visibility: 'public',
        token: 'never retained',
      },
    ]),
  );
  const store = new BranchSelections({ storage: () => storage });
  assert.equal(store.get('a/repo'), undefined);
  assert.equal(store.get('a/good'), 'Feature/Fix');
  store.record('b/good', 'main', false);
  assert.ok(!storage.getItem(BRANCH_SELECTIONS_KEY)!.includes('token'));
  for (const value of [
    '',
    '@',
    'a b',
    'a..b',
    'a//b',
    '/a',
    'a/',
    'a.lock',
    'a/.hidden',
    'a@{b',
    'a?b',
    'a\\b',
    '-a',
    'a\n',
  ])
    assert.equal(branchName(value), undefined, value);
  for (const value of ['main', 'Feature/Fix', 'release+hotfix', '日本語', 'a|b'])
    assert.equal(branchName(value), value);
});
