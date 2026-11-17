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

test('new unfocused elements join the common fade without restarting its deadline', () => {
  const { opacity } = started();
  const displayed = opacity.value('nodes', 'b', 40);
  opacity.setTarget(focus('a'), elements(['a', 'b', 'new']), 40);
  close(opacity.value('nodes', 'new', 40), displayed);
  close(opacity.value('nodes', 'b', 70), 0.625);
  close(opacity.value('nodes', 'new', 70), 0.625);
  assert.equal(opacity.active(140), false);
});

test('removed elements cannot retain animation work or revive a stale value', () => {
  const opacity = new GraphOpacity();
  opacity.setTarget(null, elements(), -10);
  opacity.setTarget(focus('a'), elements(), 0);
  opacity.active(140);
  const target = focus('b');
  opacity.setTarget(target, elements(), 200);
  assert.ok(opacity.value('nodes', 'a', 240) > 0.25);
  opacity.setTarget(target, elements(['b']), 240);
  assert.equal(opacity.value('nodes', 'a', 240), 0.25);
  opacity.setTarget(target, elements(), 250);
  assert.equal(opacity.value('nodes', 'a', 250), 0.25);
  assert.equal(opacity.active(340), false);
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

test('an older exception survives A to B to C while the common background keeps fading', () => {
  const opacity = new GraphOpacity();
  const ids = elements(['a', 'b', 'c', 'outside']);
  const c: GraphHoverFocus = {
    nodes: new Set(['c']),
    edges: new Set(),
    branches: new Set(),
  };
  opacity.setTarget(null, ids, -10);
  opacity.setTarget(focus('a'), ids, 0);
  opacity.setTarget(focus('b'), ids, 70);
  const displayed = opacity.value('nodes', 'a', 105);
  close(displayed, 0.8828125);
  close(opacity.value('nodes', 'outside', 105), 0.56640625);
  opacity.setTarget(c, ids, 105);
  close(opacity.value('nodes', 'a', 105), displayed);
  assert.equal(opacity.value('nodes', 'a', 245), 0.25);
  assert.equal(opacity.value('nodes', 'c', 245), 1);
  assert.equal(opacity.active(245), false);
});

test('sparse transitions match a dense reference through retargets, clears and reentry', () => {
  const opacity = new GraphOpacity();
  const ids = elements(['a', 'b', 'c', 'outside']);
  const kinds = ['nodes', 'edges', 'branches'] as const;
  const c: GraphHoverFocus = {
    nodes: new Set(['c']),
    edges: new Set(),
    branches: new Set(),
  };
  const states = kinds.flatMap((kind) =>
    [...ids[kind]].map((id) => ({ kind, id, from: 1, to: 1 })),
  );
  let started = -140;
  const expected = (state: (typeof states)[number], now: number) => {
    const t = Math.max(0, Math.min(1, (now - started) / 140));
    return state.from + (state.to - state.from) * t * t * (3 - 2 * t);
  };
  opacity.setTarget(null, ids, started);
  const targets = [
    focus('a'),
    focus('b'),
    c,
    null,
    focus('a'),
    c,
    null,
    focus('b'),
  ];
  const times = [0, 25, 50, 75, 100, 140, 250, 390];
  targets.forEach((target, index) => {
    const now = times[index];
    for (const state of states) {
      state.from = expected(state, now);
      state.to = !target || target[state.kind].has(state.id) ? 1 : 0.25;
    }
    started = now;
    opacity.setTarget(target, ids, now);
    for (const sample of [now, now + 10, now + 70, now + 140]) {
      for (const state of states)
        close(
          opacity.value(state.kind, state.id, sample),
          expected(state, sample),
        );
    }
  });
  assert.equal(opacity.active(530), false);
});

test('target changes query membership without traversing the loaded history', () => {
  const lookups: number[] = [];
  for (const size of [1000, 30000]) {
    let calls = 0;
    // Deliberately exposes no iterator: existing graph Maps supply only has/size.
    const membership = {
      size,
      has: (_id: string) => {
        calls++;
        return true;
      },
    };
    const ids = { nodes: membership, edges: membership, branches: membership };
    const opacity = new GraphOpacity();
    opacity.setTarget(null, ids, -10);
    opacity.setTarget(focus('a'), ids, 0);
    opacity.active(140);
    calls = 0;
    opacity.setTarget(focus('b'), ids, 200);
    assert.ok(
      calls < 20,
      `unrelated history caused ${calls} membership queries`,
    );
    lookups.push(calls);
  }
  assert.equal(lookups[0], lookups[1]);
});

test('settled older exceptions do not accumulate across many visited flows', () => {
  let calls = 0;
  const membership = {
    size: 1000,
    has: (_id: string) => {
      calls++;
      return true;
    },
  };
  const ids = { nodes: membership, edges: membership, branches: membership };
  const opacity = new GraphOpacity();
  opacity.setTarget(null, ids, -10);
  for (let i = 0; i < 100; i++) {
    opacity.setTarget(
      { nodes: new Set([`node-${i}`]), edges: new Set(), branches: new Set() },
      ids,
      i,
    );
  }
  assert.equal(opacity.active(239), false);
  calls = 0;
  opacity.setTarget(focus('b'), ids, 240);
  assert.ok(calls < 20, `finished exceptions retained ${calls} candidates`);
});

test('a common fade with no unfocused elements needs no scheduled frame', () => {
  const opacity = new GraphOpacity();
  const ids = {
    nodes: new Set(['a']),
    edges: new Set<string>(),
    branches: new Set<string>(),
  };
  const target: GraphHoverFocus = {
    nodes: new Set(['a']),
    edges: new Set(),
    branches: new Set(),
  };
  opacity.setTarget(null, ids, -10);
  opacity.setTarget(target, ids, 0);
  assert.equal(opacity.value('nodes', 'a', 70), 1);
  assert.equal(opacity.active(0), false);
  opacity.setTarget(null, ids, 70);
  assert.equal(opacity.value('nodes', 'a', 100), 1);
  assert.equal(opacity.active(70), false);
});

test('removing the remaining elements ends all visible animation work', () => {
  const { opacity } = started();
  const none: GraphHoverFocus = {
    nodes: new Set(),
    edges: new Set(),
    branches: new Set(),
  };
  opacity.setTarget(null, none, 40);
  assert.equal(opacity.active(40), false);
});
