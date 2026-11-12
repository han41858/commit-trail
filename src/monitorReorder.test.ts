import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorDropTarget } from './monitorReorder';
import { moveMonitorRepository } from './MonitorRepositories';

test('drop boundaries account for the removed source while retaining the actual insertion line', () => {
  const bounds = Array.from({ length: 4 }, (_, index) => ({
    left: 101 * index,
    right: 101 * index + 100,
  }));
  for (const [from, x, boundary, to, left] of [
    [0, 500, 4, 3, 403],
    [3, -20, 0, 0, 0],
    [1, 110, 1, 1, 100.5],
    [1, 195, 2, 1, 201.5],
    [0, 280, 3, 2, 302.5],
    [3, 110, 1, 1, 100.5],
  ])
    assert.deepEqual(monitorDropTarget(bounds, x, from), {
      boundary,
      to,
      left,
    });
});

test('32-column first-to-last and last-to-first drops preserve every repository exactly once', () => {
  const names = Array.from({ length: 32 }, (_, index) => `owner/repo-${index}`);
  const bounds = names.map((_, index) => ({
    left: index * 9.03125,
    right: (index + 1) * 9.03125 - 1,
  }));
  const end = monitorDropTarget(bounds, 400, 0)!;
  assert.deepEqual(moveMonitorRepository(names, names[0], end.to), [
    ...names.slice(1),
    names[0],
  ]);
  const start = monitorDropTarget(bounds, -10, 31)!;
  assert.deepEqual(moveMonitorRepository(names, names[31], start.to), [
    names[31],
    ...names.slice(0, 31),
  ]);
  assert.equal(new Set(names).size, 32);
});

test('unavailable bounds and invalid pointer or source positions cannot produce a drop', () => {
  assert.equal(monitorDropTarget([], 1, 0), undefined);
  const bounds = [{ left: 0, right: 100 }];
  for (const [x, from] of [
    [NaN, 0],
    [Infinity, 0],
    [0, -1],
    [0, 1],
    [0, 0.5],
  ])
    assert.equal(monitorDropTarget(bounds, x, from), undefined);
});
