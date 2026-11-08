import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monitorDetailsFrame } from './monitorDetailsPosition';

const bounds = { left: 0, right: 1280, top: 38, bottom: 800 };
test('a wide details panel centers on its column and spans neighboring columns', () => {
  const frame = monitorDetailsFrame({ left: 320, width: 320 }, bounds);
  assert.equal(frame.width, 480);
  assert.equal(frame.left, 240);
  assert.equal(frame.left + frame.width / 2, 480);
  assert.ok(frame.left < 320 && frame.left + frame.width > 640);
  assert.equal(frame.bottom, 792);
  assert.ok(frame.maxHeight <= bounds.bottom - bounds.top - 16);
});
test('edge columns clamp the wider panel within the monitor area', () => {
  const first = monitorDetailsFrame({ left: 0, width: 320 }, bounds),
    last = monitorDetailsFrame({ left: 960, width: 320 }, bounds);
  assert.equal(first.left, 8);
  assert.equal(last.left, 792);
  assert.equal(last.left + last.width, 1272);
});
test('narrow widths keep the full panel visible regardless of the selected column', () => {
  for (const left of [0, 195]) {
    const frame = monitorDetailsFrame(
      { left, width: 195 },
      { left: 0, right: 390, top: 38, bottom: 844 },
    );
    assert.equal(frame.width, 374);
    assert.equal(frame.left, 8);
    assert.equal(frame.bottom, 836);
  }
});
test('safe areas and a shortened visual viewport constrain both axes', () => {
  const frame = monitorDetailsFrame(
    { left: 304, width: 195 },
    { left: 44, right: 823, top: 100, bottom: 500 },
  );
  assert.equal(frame.left + frame.width / 2, 401.5);
  assert.ok(frame.left >= 52);
  assert.ok(frame.left + frame.width <= 815);
  assert.equal(frame.bottom, 492);
  assert.equal(frame.maxHeight, 260);
  assert.ok(frame.bottom - frame.maxHeight >= 108);
});
test('a column outside the visible area and a collapsed viewport never yield negative dimensions', () => {
  assert.equal(monitorDetailsFrame({ left: -500, width: 100 }, bounds).left, 8);
  const frame = monitorDetailsFrame(
    { left: 0, width: 0 },
    { left: 0, right: 0, top: 38, bottom: 20 },
  );
  assert.equal(frame.width, 0);
  assert.equal(frame.maxHeight, 0);
});

test('notices lift every column and reduce maximum height by the same distance', () => {
  for (const left of [0, 960]) {
    const anchor = { left, width: 320 };
    const before = monitorDetailsFrame(anchor, bounds);
    const raised = monitorDetailsFrame(anchor, bounds, 700);
    assert.equal(raised.left, before.left);
    assert.equal(raised.width, before.width);
    assert.equal(raised.bottom, 692);
    assert.equal(raised.maxHeight, before.maxHeight - 100);
    assert.equal(raised.bottom - raised.maxHeight, before.bottom - before.maxHeight);
    assert.ok(raised.bottom - raised.maxHeight >= bounds.top);
    assert.deepEqual(monitorDetailsFrame(anchor, bounds, 900), before);
  }
});

test('a tall wrapped notice cannot produce a negative panel height', () => {
  const frame = monitorDetailsFrame({ left: 195, width: 195 }, {
    left: 0, right: 390, top: 136, bottom: 844,
  }, 140);
  assert.equal(frame.maxHeight, 0);
  assert.ok(frame.bottom >= 136);
});
