import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphOpacity } from './graphOpacity';
import type { GraphHoverFocus } from './graphHover';

const elements = (nodes = ['a', 'b']): GraphHoverFocus => ({
  nodes: new Set(nodes),
  edges: new Set(['a:b', 'b:c']),
  branches: new Set(['main', 'work']),
});
const focus = (name: 'a' | 'b'): GraphHoverFocus => ({
  nodes: new Set([name]),
  edges: new Set([name === 'a' ? 'a:b' : 'b:c']),
  branches: new Set([name === 'a' ? 'main' : 'work']),
});
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

function started() {
  const opacity = new GraphOpacity();
  const ids = elements();
  opacity.setTarget(null, ids, -10);
  opacity.setTarget(focus('a'), ids, 0);
  return { opacity, ids };
}

test('initial graph and initial selection appear without an entrance animation', () => {
  for (const target of [null, focus('a')]) {
    const opacity = new GraphOpacity();
    opacity.setTarget(target, elements(), 0);
    assert.equal(opacity.value('nodes', 'a', 0), 1);
    assert.equal(opacity.value('nodes', 'b', 0), target ? 0.25 : 1);
    assert.equal(opacity.active(0), false);
  }
});

test('node, edge and badge factors ease to the target over 140ms', () => {
  const { opacity } = started();
  assert.equal(opacity.value('nodes', 'b', 0), 1);
  close(opacity.value('nodes', 'b', 70), 0.625);
  close(opacity.value('edges', 'b:c', 70), 0.625);
  close(opacity.value('branches', 'work', 70), 0.625);
  assert.equal(opacity.value('nodes', 'a', 70), 1);
  assert.equal(opacity.active(70), true);
  assert.equal(opacity.value('nodes', 'b', 140), 0.25);
  assert.equal(opacity.active(140), false);
  assert.equal(opacity.active(1000), false);
});

test('an interrupted transition starts from the displayed values without jumping', () => {
  const { opacity, ids } = started();
  const displayed = opacity.value('nodes', 'b', 70);
  opacity.setTarget(focus('b'), ids, 70);
  close(opacity.value('nodes', 'b', 70), displayed);
  assert.equal(opacity.value('nodes', 'a', 70), 1);
  assert.equal(opacity.value('nodes', 'a', 210), 0.25);
  assert.equal(opacity.value('nodes', 'b', 210), 1);
  assert.equal(opacity.active(210), false);
});

test('clearing a focus reverses smoothly toward normal opacity', () => {
  const { opacity, ids } = started();
  const displayed = opacity.value('nodes', 'b', 70);
  opacity.setTarget(null, ids, 70);
  close(opacity.value('nodes', 'b', 70), displayed);
  close(opacity.value('nodes', 'b', 140), 0.8125);
  assert.equal(opacity.value('nodes', 'b', 210), 1);
});

test('rapid alternating targets preserve continuity for every element kind', () => {
  const { opacity, ids } = started();
  for (const time of [10, 20, 30, 40, 50]) {
    const before = [
      opacity.value('nodes', 'b', time),
      opacity.value('edges', 'b:c', time),
      opacity.value('branches', 'work', time),
    ];
    opacity.setTarget(focus(time % 20 ? 'b' : 'a'), ids, time);
    close(opacity.value('nodes', 'b', time), before[0]);
    close(opacity.value('edges', 'b:c', time), before[1]);
    close(opacity.value('branches', 'work', time), before[2]);
  }
  assert.equal(opacity.value('nodes', 'b', 190), 1);
  assert.equal(opacity.active(190), false);
});

test('equivalent focus and data objects do not postpone the original deadline', () => {
  const { opacity } = started();
  opacity.setTarget(focus('a'), elements(), 40);
  close(opacity.value('nodes', 'b', 70), 0.625);
  assert.equal(opacity.active(140), false);
  assert.equal(opacity.value('nodes', 'b', 140), 0.25);
});

test('new elements start at their target while existing fades retain their deadline', () => {
  const { opacity } = started();
  opacity.setTarget(focus('a'), elements(['a', 'b', 'new']), 40);
  assert.equal(opacity.value('nodes', 'new', 40), 0.25);
  close(opacity.value('nodes', 'b', 70), 0.625);
  assert.equal(opacity.active(140), false);
});

test('removed elements cannot retain animation work or revive a stale value', () => {
  const opacity = new GraphOpacity();
  opacity.setTarget(
    null,
    { nodes: new Set(['a', 'b']), edges: new Set(), branches: new Set() },
    -10,
  );
  const target: GraphHoverFocus = { nodes: new Set(['a']), edges: new Set(), branches: new Set() };
  opacity.setTarget(target, elements(), 0);
  opacity.setTarget(target, { nodes: new Set(['a']), edges: new Set(), branches: new Set() }, 40);
  assert.equal(opacity.active(40), false);
  opacity.setTarget(target, elements(), 50);
  assert.equal(opacity.value('nodes', 'b', 50), 0.25);
  assert.equal(opacity.active(50), false);
});

test('canceling a target before the first frame leaves no animation running', () => {
  const opacity = new GraphOpacity();
  const ids = elements();
  opacity.setTarget(null, ids, -10);
  opacity.setTarget(focus('a'), ids, 0);
  opacity.setTarget(null, ids, 0);
  assert.equal(opacity.value('nodes', 'b', 0), 1);
  assert.equal(opacity.active(0), false);
});
