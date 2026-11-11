import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshProgress, refreshAnimationStart } from './refreshProgress';
import { RefreshLoop, type RefreshClock } from './RefreshLoop';

test('the sweep follows elapsed time for all supported intervals', () => {
  for (const duration of [30000, 60000, 300000]) {
    const start = 1000,
      next = start + duration;
    for (const fraction of [0, 0.25, 0.5, 0.75, 1])
      assert.deepEqual(
        refreshProgress(next, duration, start + duration * fraction),
        {
          duration,
          delay: fraction === 0 ? 0 : -duration * fraction,
          offset: 100 * (1 - fraction),
        },
      );
  }
});

test('future starts and overdue deadlines clamp to empty and full', () => {
  assert.deepEqual(refreshProgress(90000, 60000, 0), {
    duration: 60000,
    delay: 0,
    offset: 100,
  });
  assert.deepEqual(refreshProgress(90000, 60000, 120000), {
    duration: 60000,
    delay: -60000,
    offset: 0,
  });
});

test('invalid or unset scheduling data cannot produce invalid CSS timings', () => {
  for (const interval of [0, -1, NaN, Infinity])
    assert.deepEqual(refreshProgress(60000, interval, 30000), {
      duration: 1,
      delay: 0,
      offset: 100,
    });
  for (const nextAt of [0, -1, NaN, Infinity])
    assert.deepEqual(refreshProgress(nextAt, 60000, 30000), {
      duration: 60000,
      delay: 0,
      offset: 100,
    });
  assert.equal(refreshProgress(60000, 60000, NaN).offset, 100);
});

test('manual completion and interval changes reset the sweep using actual loop deadlines', async () => {
  let now = 1000;
  const clock: RefreshClock = { now: () => now, set: () => 0, clear: () => {} };
  const loop = new RefreshLoop(
    async () => ({}),
    () => true,
    clock,
  );
  loop.configure('repo', true, 60000);
  loop.loaded();
  now += 15000;
  assert.equal(
    refreshProgress(loop.getSnapshot().nextAt, 60000, now).offset,
    75,
  );
  await loop.refresh();
  assert.equal(
    refreshProgress(loop.getSnapshot().nextAt, 60000, now).offset,
    100,
  );
  loop.configure('repo', true, 300000);
  assert.deepEqual(refreshProgress(loop.getSnapshot().nextAt, 300000, now), {
    duration: 300000,
    delay: 0,
    offset: 100,
  });
  now += 30000;
  assert.equal(
    refreshProgress(loop.getSnapshot().nextAt, 300000, now).offset,
    90,
  );
  loop.stop();
});
test('animation alignment uses the committed deadline instead of restarting after a slow render', () => {
  const nextAt = 61000,
    interval = 60000;
  assert.equal(refreshAnimationStart(nextAt, interval, 1000, 200), 200);
  assert.equal(refreshAnimationStart(nextAt, interval, 31000, 30200), 200);
  assert.equal(refreshAnimationStart(nextAt, interval, 61000, 60200), 200);
  assert.equal(refreshAnimationStart(nextAt, interval, 71000, 70200), 200);
});
test('a retry deadline beyond one interval holds the animation start in the future', () => {
  assert.equal(refreshAnimationStart(121000, 60000, 1000, 200), 60200);
});
test('unset or invalid animation deadlines cannot create a sweep', () => {
  for (const next of [0, NaN, Infinity])
    assert.equal(refreshAnimationStart(next, 60000, 1000, 200), null);
  assert.equal(refreshAnimationStart(61000, 0, 1000, 200), null);
  assert.equal(refreshAnimationStart(61000, 60000, NaN, 200), null);
  assert.equal(refreshAnimationStart(61000, 60000, 1000, NaN), null);
});
