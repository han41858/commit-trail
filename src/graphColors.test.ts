import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphColors } from './graphColors';
import { layout, type Commit } from './model';
const c = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents: parents.map((sha) => ({ sha })),
  commit: { message: sha, author: null, committer: null },
  html_url: '',
});
const refs = [
  { name: 'main', commit: { sha: 'm' } },
  { name: 'feature', commit: { sha: 'f' } },
];
test('side paths and their merge connectors keep one color until joining the base', () => {
  const commits = [c('m', 'b', 'f'), c('b', 'root'), c('f', 'g'), c('g', 'root'), c('root')];
  const data = layout(commits, new Map(), 'm'),
    colors = graphColors(commits, data.ordered, refs, 'main', data.spine);
  const feature = colors.branches.get('feature')!;
  assert.notEqual(feature, 0);
  assert.equal(colors.nodes.get('f'), feature);
  assert.equal(colors.nodes.get('g'), feature);
  for (const edge of ['m:f', 'f:g', 'g:root']) assert.equal(colors.edges.get(edge), feature);
  for (const sha of ['m', 'b', 'root']) assert.equal(colors.nodes.get(sha), 0);
});
test('a paginated continuation inherits its existing color including unloaded parent reservations', () => {
  const first = [c('m', 'base'), c('f', 'unloaded')];
  const data = layout(first, new Map(), 'm'),
    before = graphColors(first, data.ordered, refs, 'main', data.spine);
  const next = [...first, c('base'), c('unloaded', 'older'), c('older')];
  const afterLayout = layout(next, data.lanes, 'm'),
    after = graphColors(
      next,
      afterLayout.ordered,
      [...refs].reverse(),
      'main',
      afterLayout.spine,
      before,
    );
  for (const sha of ['f', 'unloaded', 'older'])
    assert.equal(after.nodes.get(sha), before.nodes.get('f'));
  assert.equal(after.branches.get('feature'), before.branches.get('feature'));
});
test('previously unnamed merge history keeps its color when a reference becomes available', () => {
  const first = [c('m', 'b', 'f'), c('b'), c('f', 'g'), c('g')],
    data = layout(first, new Map(), 'm');
  const before = graphColors(first, data.ordered, refs.slice(0, 1), 'main', data.spine);
  const after = graphColors(first, data.ordered, refs, 'main', data.spine, before);
  assert.equal(after.nodes.get('f'), before.nodes.get('f'));
  assert.equal(after.nodes.get('g'), before.nodes.get('g'));
  assert.equal(after.edges.get('m:f'), before.edges.get('m:f'));
});
test('a newly exposed shared-parent join preserves the already displayed trunk', () => {
  const first = [c('m'), c('f', 'root'), c('root')],
    data = layout(first, new Map(), 'm');
  const before = graphColors(first, data.ordered, refs, 'main', data.spine);
  const next = [...first, c('another', 'root')],
    nextLayout = layout(next, data.lanes, 'm');
  const after = graphColors(
    next,
    nextLayout.ordered,
    [{ name: 'aaa', commit: { sha: 'another' } }, ...refs],
    'main',
    nextLayout.spine,
    before,
  );
  assert.equal(after.nodes.get('root'), before.nodes.get('root'));
  assert.equal(after.nodes.get('f'), before.nodes.get('f'));
});

test('late ko history cannot repaint the already displayed main path', () => {
  const first = [c('base'), c('m', 'older'), c('older')],
    data = layout(first, new Map(), 'base');
  const initialRefs = [
    { name: 'base', commit: { sha: 'base' } },
    { name: 'main', commit: { sha: 'm' } },
  ];
  const before = graphColors(first, data.ordered, initialRefs, 'base', data.spine);
  const next = [...first, c('ko', 'm')],
    nextLayout = layout(next, data.lanes, 'base');
  const after = graphColors(
    next,
    nextLayout.ordered,
    [...initialRefs, { name: 'ko', commit: { sha: 'ko' } }],
    'base',
    nextLayout.spine,
    before,
  );
  for (const sha of ['m', 'older']) assert.equal(after.nodes.get(sha), before.nodes.get(sha));
  assert.equal(after.branches.get('main'), before.branches.get('main'));
  assert.equal(after.edges.get('m:older'), before.edges.get('m:older'));
});

test('newly identified base ancestry retains its already displayed colors', () => {
  const first = [c('m', 'gap'), c('s', 'older'), c('older')],
    data = layout(first, new Map(), 'm');
  const initialRefs = [
    { name: 'main', commit: { sha: 'm' } },
    { name: 'ko', commit: { sha: 's' } },
  ];
  const before = graphColors(first, data.ordered, initialRefs, 'main', data.spine);
  const next = [...first, c('gap', 's')],
    nextLayout = layout(next, data.lanes, 'm');
  const after = graphColors(
    next,
    nextLayout.ordered,
    initialRefs,
    'main',
    nextLayout.spine,
    before,
  );
  for (const [sha, color] of before.nodes) assert.equal(after.nodes.get(sha), color);
  assert.equal(after.branches.get('ko'), before.branches.get('ko'));
  for (const [edge, color] of before.edges) assert.equal(after.edges.get(edge), color);
});
