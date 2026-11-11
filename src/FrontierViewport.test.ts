import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrontierViewport, type GraphViewport } from './FrontierViewport';
const view = (top = 0, left = 0): GraphViewport => ({
  top,
  left,
  width: 390,
  height: 600,
  inset: 100,
});

test('a large downward scroll captures boundaries skipped between frames', () => {
  const visited = new FrontierViewport();
  visited.visit(view());
  assert.equal(visited.contains({ x: 82, y: 1800 }), false);
  visited.visit(view(4000));
  assert.equal(visited.contains({ x: 82, y: 1800 }), true);
  assert.equal(visited.contains({ x: 82, y: 4901 }), false);
});

test('passed intervals remain eligible for late responses after scrolling back', () => {
  const visited = new FrontierViewport();
  visited.visit(view());
  visited.visit(view(4000));
  visited.visit(view());
  assert.equal(visited.contains({ x: 116, y: 2200 }), true);
  assert.equal(visited.contains({ x: 116, y: 4800 }), true);
  assert.equal(visited.contains({ x: 116, y: 5000 }), false);
});

test('upward jumps capture crossed boundaries too', () => {
  const visited = new FrontierViewport();
  visited.visit(view(4000));
  visited.visit(view());
  assert.equal(visited.contains({ x: 48, y: 2000 }), true);
});

test('horizontally unseen lanes and vertical gaps are not treated as visited', () => {
  const visited = new FrontierViewport();
  visited.visit(view());
  visited.visit(view(0, 1000));
  visited.visit(view(5000, 1000));
  visited.visit(view(5000, 0));
  assert.equal(visited.contains({ x: 48, y: 100 }), true);
  assert.equal(visited.contains({ x: 48, y: 5200 }), true);
  assert.equal(visited.contains({ x: 48, y: 2500 }), false);
  assert.equal(visited.contains({ x: 1068, y: 2500 }), true);
  assert.equal(visited.contains({ x: 2000, y: 2500 }), false);
});

test('diagonal movement only records a lane while that lane crosses the viewport', () => {
  const visited = new FrontierViewport();
  visited.visit(view());
  visited.visit(view(4000, 1000));
  assert.equal(visited.contains({ x: 48, y: 3900 }), false);
  assert.equal(visited.contains({ x: 1068, y: 100 }), false);
  assert.equal(visited.contains({ x: 1068, y: 4200 }), true);
});

test('resize and initial hidden measurements do not lose visited intervals', () => {
  const visited = new FrontierViewport();
  visited.visit({ ...view(), width: 0 });
  assert.equal(visited.contains({ x: 48, y: 100 }), false);
  visited.visit(view());
  visited.visit({ ...view(1000), width: 800, height: 900 });
  assert.equal(visited.contains({ x: 796, y: 1600 }), true);
  assert.equal(visited.contains({ x: 48, y: 100 }), true);
});

test('parallel insertions rebase passed main boundaries even after returning to the top', () => {
  const visited = new FrontierViewport();
  const rows = Array.from({ length: 100 }, (_, i) => `m${i}`);
  visited.rebase(rows, 100, 31);
  visited.visit(view());
  visited.visit(view(2580));
  visited.visit(view());
  const fork = Array.from({ length: 100 }, (_, i) => `fork${i}`);
  visited.rebase([...rows.slice(0, 71), ...fork, ...rows.slice(71)], 100, 31);
  assert.equal(visited.contains({ x: 48, y: 100 + 200 * 31 }), true);
  assert.equal(visited.contains({ x: 48, y: 100 + 220 * 31 }), false);
  // Appending a full main page must not drag the visited tail along indefinitely.
  visited.rebase(
    [
      ...rows.slice(0, 71),
      ...fork,
      ...rows.slice(71),
      ...Array.from({ length: 100 }, (_, i) => `m${i + 100}`),
    ],
    100,
    31,
  );
  assert.equal(visited.contains({ x: 48, y: 100 + 299 * 31 }), false);
});

test('rebasing preserves unvisited lanes and separated intervals after row insertion', () => {
  const visited = new FrontierViewport();
  const rows = Array.from({ length: 300 }, (_, i) => `m${i}`);
  visited.rebase(rows, 100, 31);
  visited.visit(view());
  visited.visit(view(0, 1000));
  visited.visit(view(5000, 1000));
  visited.visit(view(5000, 0));
  visited.rebase(
    [...Array.from({ length: 50 }, (_, i) => `new${i}`), ...rows],
    120,
    31,
  );
  assert.equal(visited.contains({ x: 48, y: 2500 + 1570 }), false);
  assert.equal(visited.contains({ x: 48, y: 5200 + 1570 }), true);
  assert.equal(visited.contains({ x: 1068, y: 2500 + 1570 }), true);
  assert.equal(visited.contains({ x: 2000, y: 2500 + 1570 }), false);
});

test('rebasing follows visited commits that move outside their old neighbors', () => {
  const visited = new FrontierViewport();
  const rows = Array.from({ length: 100 }, (_, i) => `m${i}`);
  visited.rebase(rows, 100, 31);
  visited.visit(view());
  const reordered = [...rows.slice(0, 10), ...rows.slice(11), 'm10'];
  visited.rebase(reordered, 100, 31);
  assert.equal(visited.contains({ x: 48, y: 100 + 99 * 31 }), true);
  // A new traversal has no shared anchors and must not inherit the old ranges.
  visited.rebase(['other'], 100, 31);
  assert.equal(visited.contains({ x: 48, y: 100 + 99 * 31 }), false);
});
