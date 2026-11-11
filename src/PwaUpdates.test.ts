import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PwaUpdates } from './PwaUpdates';

test('a ready version waits for consent; closing suppresses the same version only', () => {
  const updates = new PwaUpdates(
      async () => {},
      () => {},
    ),
    first = {},
    second = {};
  let changes = 0;
  updates.subscribe(() => changes++);
  updates.ready(first);
  assert.equal(updates.getSnapshot().visible, true);
  updates.dismiss();
  assert.equal(updates.getSnapshot().visible, false);
  const dismissedChanges = changes;
  updates.ready(first);
  assert.equal(changes, dismissedChanges);
  updates.ready(second);
  assert.equal(updates.getSnapshot().visible, true);
  assert.equal(changes, dismissedChanges + 1);
});

test('approval activates once and reloads only after the new worker controls the page', async () => {
  let activated = 0,
    reloaded = 0;
  const updates = new PwaUpdates(
      async () => {
        activated++;
      },
      () => {
        reloaded++;
      },
    ),
    worker = {};
  updates.ready(worker);
  assert.equal(activated + reloaded, 0);
  await updates.apply();
  await updates.apply();
  assert.equal(activated, 1);
  assert.equal(reloaded, 0);
  assert.equal(updates.getSnapshot().applying, true);
  updates.controlled(worker);
  updates.controlled(worker);
  assert.equal(reloaded, 1);
});

test('another tab activating an update cannot reload an unapproved tab or repeat a dismissed notice', async () => {
  let reloaded = 0;
  const worker = {},
    updates = new PwaUpdates(
      async () => {},
      () => {
        reloaded++;
      },
    );
  updates.ready(worker);
  updates.dismiss();
  updates.controlled(worker);
  assert.equal(reloaded, 0);
  assert.equal(updates.getSnapshot().visible, false);
  const next = {};
  updates.controlled(next);
  assert.equal(reloaded, 0);
  assert.equal(updates.getSnapshot().visible, true);
});

test('activation failure leaves the page available, shows a fixed error and allows retry', async () => {
  let calls = 0,
    reloaded = 0;
  const updates = new PwaUpdates(
    async () => {
      calls++;
      if (calls === 1) throw new Error('PRIVATE_TOKEN https://private.example');
    },
    () => {
      reloaded++;
    },
  );
  const worker = {};
  updates.ready(worker);
  await updates.apply();
  assert.equal(reloaded, 0);
  assert.equal(updates.getSnapshot().applying, false);
  assert.ok(updates.getSnapshot().error);
  assert.ok(!JSON.stringify(updates.getSnapshot()).includes('PRIVATE'));
  await updates.apply();
  updates.controlled(worker);
  assert.equal(calls, 2);
  assert.equal(reloaded, 1);
});

test('a worker that never activates times out without forcing a reload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reloaded = 0;
  const updates = new PwaUpdates(
      async () => {},
      () => {
        reloaded++;
      },
    ),
    worker = {};
  updates.ready(worker);
  await updates.apply();
  t.mock.timers.tick(15000);
  assert.equal(updates.getSnapshot().applying, false);
  assert.ok(updates.getSnapshot().error);
  assert.equal(reloaded, 0);
  updates.controlled(worker);
  assert.equal(reloaded, 0);
});

test('unsupported or unavailable updates do not start activation or notifications', async () => {
  let calls = 0;
  const updates = new PwaUpdates(
    async () => {
      calls++;
    },
    () => {
      calls++;
    },
  );
  await updates.apply();
  assert.equal(calls, 0);
  assert.deepEqual(updates.getSnapshot(), {
    visible: false,
    applying: false,
    error: '',
  });
});
