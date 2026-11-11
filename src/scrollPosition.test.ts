import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollPosition, scrollAnchor } from './scrollPosition';
import { ROW } from './model';
const rows = Array.from({ length: 100 }, (_, i) => 'c' + i);
test('newest-first refresh follows the top but anchors a reader in the past', () => {
  const after = ['new', ...rows];
  assert.equal(scrollPosition(rows, after, 0, 600, 100, false, true), 0);
  assert.equal(
    scrollPosition(rows, after, 1000, 600, 100, false, true),
    1000 + ROW,
  );
});
test('oldest-first refresh follows the pre-update bottom but pagination does not jump', () => {
  const after = [...rows, 'new'],
    bottom = rows.length * ROW + 180 - 600;
  assert.equal(
    scrollPosition(rows, after, bottom, 600, 100, true, true),
    bottom + ROW,
  );
  assert.equal(
    scrollPosition(rows, after, bottom, 600, 100, true, false),
    bottom,
  );
  assert.equal(scrollPosition(rows, after, 500, 600, 100, true, true), 500);
});
test('metadata-only changes keep the exact scroll offset and removed anchors find a survivor', () => {
  assert.equal(scrollPosition(rows, rows, 712, 600, 100, false, true), 712);
  const after = rows.filter((sha) => sha !== 'c19');
  assert.ok(
    Number.isFinite(scrollPosition(rows, after, 700, 600, 100, false, true)),
  );
});
test('newer branch commits discovered after main keep a newest-first viewer at the latest edge', () => {
  const first = ['side-new', ...rows],
    second = ['side-newer', ...first];
  assert.equal(scrollPosition(rows, first, 0, 600, 100, false, false), 0);
  assert.equal(scrollPosition(rows, first, ROW, 600, 100, false, false), 0);
  assert.equal(scrollPosition(first, second, 0, 600, 100, false, false), 0);
  assert.equal(
    scrollPosition(rows, second, 1000, 600, 100, false, false),
    1000 + ROW * 2,
  );
});
test('older pagination and unchanged refreshes do not snap a near-top reader to zero', () => {
  assert.equal(
    scrollPosition(rows, [...rows, 'older'], ROW, 600, 100, false, false),
    ROW,
  );
  assert.equal(scrollPosition(rows, rows, ROW, 600, 100, false, false), ROW);
  assert.equal(scrollPosition(rows, rows, ROW, 600, 100, false, true), ROW);
});
test('following animation starts at the anchored commit while historical reading needs no animation', () => {
  const after = ['first', 'second', 'third', ...rows];
  assert.equal(scrollAnchor(rows, after, 0, 600, 100), ROW * 3);
  assert.equal(scrollPosition(rows, after, 0, 600, 100, false, false), 0);
  assert.equal(
    scrollAnchor(rows, after, 1000, 600, 100),
    scrollPosition(rows, after, 1000, 600, 100, false, false),
  );
  const bottom = rows.length * ROW + 180 - 600;
  assert.equal(scrollAnchor(rows, [...rows, 'new'], bottom, 600, 100), bottom);
  assert.equal(
    scrollPosition(rows, [...rows, 'new'], bottom, 600, 100, true, true),
    bottom + ROW,
  );
});
