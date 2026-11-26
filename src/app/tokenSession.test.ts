import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateTokenSession } from './tokenSession';
import { TOKEN_STORAGE_KEY } from '../token/tokenStorage';

for (const { name, next, storageFails } of [
  { name: 'applying a replacement', next: 'new-token', storageFails: false },
  { name: 'removing a token', next: '', storageFails: false },
  { name: 'removing when storage is blocked', next: '', storageFails: true },
]) {
  test(`${name} invalidates old data before changing the session`, (t) => {
    const previous = 'old-token';
    let stored = previous;
    const authToken = { current: previous };
    const calls: string[] = [];
    const storageDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    function save(key: string, value: string) {
      assert.equal(key, TOKEN_STORAGE_KEY);
      calls.push('storage');
      if (storageFails) throw new Error('Storage blocked');
      stored = value;
    }
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: save,
        removeItem: (key: string) => save(key, ''),
      },
    });
    t.after(() => {
      if (storageDescriptor)
        Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    });

    function authenticate(name: string) {
      return (old: string, value: string) => {
        assert.equal(old, previous);
        assert.equal(value, next);
        assert.equal(authToken.current, previous);
        assert.equal(stored, previous);
        calls.push(name);
      };
    }

    const error = updateTokenSession(
      {
        authToken,
        monitor: { authenticationChanged: authenticate('monitor') },
        branchSelections: { authenticationChanged: authenticate('branches') },
        monitorRepositories: {
          authenticationChanged: authenticate('monitor repositories'),
          reconcile: () => {
            calls.push('reconcile');
          },
        },
        recent: {
          authenticationChanged: authenticate('recent'),
          reload: () => {
            assert.equal(authToken.current, next);
            assert.equal(stored, storageFails ? previous : next);
            calls.push('reload');
          },
        },
        ownerRepositories: {
          setToken: (value) => {
            assert.equal(value, next);
            assert.equal(authToken.current, next);
            calls.push('owner');
          },
        },
      },
      previous,
      next,
      next
        ? undefined
        : () => {
            calls.push('cancel');
          },
    );

    assert.deepEqual(calls, [
      'monitor',
      'branches',
      'monitor repositories',
      'recent',
      ...(next ? [] : ['cancel']),
      'storage',
      'owner',
      'reload',
      'reconcile',
    ]);
    if (storageFails) assert.match(error, /Could not remove the saved token/);
    else assert.equal(error, '');
  });
}
