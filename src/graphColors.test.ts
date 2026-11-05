import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphColors } from './graphColors';
import { GRAPH_COLOR_COUNT } from './graphPalette';
import type { Branch, Commit } from './model';

const c = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents: parents.map((sha) => ({ sha })),
  commit: { message: sha, author: null, committer: null },
  html_url: '',
});

const ref = (name: string, sha: string): Branch => ({ name, commit: { sha } });
const refs = [ref('main', 'm'), ref('feature', 'f')];

test('side paths and their merge connectors keep one color until joining the base', () => {
  const commits = [c('m', 'b', 'f'), c('b', 'root'), c('f', 'g'), c('g', 'root'), c('root')];
  const colors = graphColors(commits, refs, 'main');
  const feature = colors.branches.get('feature')!;
  const path = colors.paths.branches.get('feature');

  assert.notEqual(feature, colors.branches.get('main'));
  for (const sha of ['f', 'g']) {
    assert.equal(colors.nodes.get(sha), feature);
    assert.equal(colors.paths.nodes.get(sha), path);
  }
  for (const edge of ['m:f', 'f:g', 'g:root']) {
    assert.equal(colors.edges.get(edge), feature);
    assert.equal(colors.paths.edges.get(edge), path);
  }
  for (const sha of ['m', 'b', 'root']) assert.equal(colors.nodes.get(sha), 0);
  assert.notEqual(colors.paths.nodes.get('root'), path);
});

test('pagination with the same named paths keeps their colors and fills parent reservations', () => {
  const first = [c('m', 'base'), c('f', 'unloaded')];
  const before = graphColors(first, refs, 'main');
  const next = [...first, c('base'), c('unloaded', 'older'), c('older')];
  const after = graphColors([...next].reverse(), [...refs].reverse(), 'main');

  assert.equal(before.nodes.get('unloaded'), before.nodes.get('f'));
  for (const sha of ['f', 'unloaded', 'older']) {
    assert.equal(after.nodes.get(sha), before.nodes.get('f'));
    assert.equal(after.paths.nodes.get(sha), after.paths.nodes.get('f'));
  }
  for (const branch of refs) {
    assert.equal(after.branches.get(branch.name), before.branches.get(branch.name));
  }
});

test('a late reference inside anonymous merged history is an alias of that path', () => {
  const commits = [c('m', 'b', 'f'), c('b', 'root'), c('f', 'g'), c('g', 'root'), c('root')];
  const before = graphColors(commits, [ref('main', 'm')], 'main');
  const after = graphColors(commits, [ref('middle-alias', 'g'), ref('main', 'm')], 'main');

  for (const sha of ['f', 'g']) {
    assert.equal(after.paths.nodes.get(sha), before.paths.nodes.get(sha));
    assert.equal(after.nodes.get(sha), before.nodes.get(sha));
  }
  assert.equal(after.paths.branches.get('middle-alias'), after.paths.nodes.get('f'));
  assert.equal(after.branches.get('middle-alias'), after.nodes.get('f'));
  assert.equal(after.edges.get('m:f'), before.edges.get('m:f'));
});

test('a named path retains its color as its head advances with the same neighbors', () => {
  const first = [c('m', 'root'), c('f', 'older'), c('older', 'root'), c('root')];
  const before = graphColors(first, refs, 'main');
  const after = graphColors(
    [c('feature-next', 'f'), ...first],
    [ref('feature', 'feature-next'), ref('main', 'm')],
    'main',
  );

  assert.equal(after.branches.get('feature'), before.branches.get('feature'));
  for (const sha of ['feature-next', 'f', 'older']) {
    assert.equal(after.nodes.get(sha), before.branches.get('feature'));
    assert.equal(after.paths.nodes.get(sha), after.paths.nodes.get('feature-next'));
  }
  assert.equal(after.edges.get('feature-next:f'), before.branches.get('feature'));
  assert.equal(after.nodes.get('root'), before.nodes.get('root'));
});

test('each base selection is deterministic and returning to a base restores its allocation', () => {
  const commits = [c('m', 'b', 'g'), c('b', 'root'), c('f', 'g'), c('g', 'root'), c('root')];

  for (const base of ['main', 'feature', 'main']) {
    const first = graphColors(commits, refs, base);
    const second = graphColors([...commits].reverse(), [...refs].reverse(), base);

    assert.equal(first.branches.get(base), 0);
    for (const kind of ['nodes', 'edges', 'branches'] as const) {
      const sorted = (values: ReadonlyMap<string, number>) =>
        [...values].sort(([left], [right]) => left.localeCompare(right));
      assert.deepEqual(sorted(first[kind]), sorted(second[kind]));
    }
  }
});

test('a newly adjacent colliding path may recolor an existing path deterministically', () => {
  const seen = new Map<number, string>();
  let names: [string, string] | undefined;
  for (let index = 0; index < GRAPH_COLOR_COUNT * 4 && !names; index++) {
    const name = `topic-${index}`;
    const colors = graphColors(
      [c('m', 'root', 'probe'), c('probe', 'root'), c('root')],
      [ref('main', 'm'), ref(name, 'probe')],
      'main',
    );
    const color = colors.branches.get(name)!;
    const existing = seen.get(color);
    if (existing) names = [existing, name];
    else seen.set(color, name);
  }

  assert.ok(names);
  const [existingName, incomingName] = names;
  const first = [c('m', 'root', 'z-side'), c('z-side', 'root'), c('root')];
  const before = graphColors(first, [ref('main', 'm'), ref(existingName, 'z-side')], 'main');
  const next = [c('main-next', 'm', 'a-side'), c('a-side', 'root'), ...first];
  const branches = [
    ref('main', 'main-next'),
    ref(existingName, 'z-side'),
    ref(incomingName, 'a-side'),
  ];
  const after = graphColors(next, branches, 'main');
  const fresh = graphColors([...next].reverse(), [...branches].reverse(), 'main');

  assert.notEqual(after.branches.get(existingName), before.branches.get(existingName));
  assert.notEqual(after.branches.get(existingName), after.branches.get(incomingName));
  for (const branch of branches) {
    assert.equal(after.branches.get(branch.name), fresh.branches.get(branch.name));
  }
});
