import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Commit, Branch } from './model';
import { branchTracks, type BranchTrack } from './branchLabels';
import { emptyGraphColors, graphColors } from './graphColors';
import { graphHoverIndex, graphHoverAlpha, resolveGraphHover } from './graphHover';

const commit = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents: parents.map((sha) => ({ sha })),
  commit: { message: sha, author: null, committer: null },
  html_url: '',
});
const refs = (names: Record<string, string>): Branch[] =>
  Object.entries(names).map(([name, sha]) => ({ name, commit: { sha } }));

function index(
  commits: Commit[],
  branches = refs({ main: 'merge', feature: 'feature', other: 'other' }),
  reverse = false,
  sameColors = false,
) {
  const spine = new Set(['merge', 'base', 'root']);
  const positions = new Map(
    commits.map((c, i) => [c.sha, { x: 48, y: (reverse ? commits.length - i : i) * 31 }]),
  );
  const colors = sameColors
    ? emptyGraphColors()
    : graphColors(commits, commits, branches, 'main', spine);
  if (sameColors) {
    for (const c of commits) colors.nodes.set(c.sha, 0);
    for (const b of branches) colors.branches.set(b.name, 0);
  }
  const tracks = branchTracks(commits, branches, 'main', spine, positions, reverse, colors);
  return { tracks, index: graphHoverIndex(commits, tracks) };
}

const merged = () => [
  commit('merge', 'base', 'feature'),
  commit('feature', 'base'),
  commit('other', 'root'),
  commit('base', 'root'),
  commit('root'),
];

test('a branch focuses its first-parent segment and real incoming merge connector, stopping at the join', () => {
  const { tracks, index: paths } = index(merged());
  const focus = resolveGraphHover({ kind: 'branch', id: 'feature' }, paths)!;
  assert.deepEqual([...focus.nodes].sort(), ['base', 'feature', 'merge']);
  assert.deepEqual([...focus.edges].sort(), ['feature:base', 'merge:feature']);
  assert.deepEqual([...focus.branches], ['feature']);
  assert.equal(graphHoverAlpha(focus, 'edges', 'base:root'), 0.5);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:base'), 0.5);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'other'), 0.5);
  assert.equal(tracks.find((track) => track.name === 'feature')!.points.length, 2);
});

test('a unique commit and its message resolve to the exact same cached branch focus', () => {
  const { index: paths } = index(merged());
  assert.equal(
    resolveGraphHover({ kind: 'commit', id: 'feature' }, paths),
    resolveGraphHover({ kind: 'branch', id: 'feature' }, paths),
  );
});

test('shared join and merge commits are highlighted alone without guessing a branch', () => {
  const { index: paths } = index(merged());
  for (const sha of ['merge', 'base', 'root']) {
    const focus = resolveGraphHover({ kind: 'commit', id: sha }, paths)!;
    assert.deepEqual([...focus.nodes], [sha]);
    assert.equal(focus.edges.size, 0);
    assert.equal(focus.branches.size, 0);
  }
});

test('shared HEAD aliases retain separate badge focus and ambiguous commit focus', () => {
  const { index: paths } = index(
    merged(),
    refs({ main: 'merge', alias: 'merge', feature: 'feature' }),
  );
  const alias = resolveGraphHover({ kind: 'branch', id: 'alias' }, paths)!;
  assert.equal(graphHoverAlpha(alias, 'branches', 'alias'), 1);
  assert.equal(graphHoverAlpha(alias, 'branches', 'main'), 0.5);
  const node = resolveGraphHover({ kind: 'commit', id: 'merge' }, paths)!;
  assert.equal(node.nodes.size, 1);
  assert.equal(node.edges.size, 0);
});

test('an older reference on the base spine keeps shared commits ambiguous while badges choose their paths', () => {
  const commits = [commit('d4', 'd3'), commit('d3', 'd2'), commit('d2', 'd1'), commit('d1')];
  const branches = refs({ dev: 'd4', main: 'd2' });
  const spine = new Set(commits.map((c) => c.sha));
  const positions = new Map(commits.map((c, i) => [c.sha, { x: 48, y: i * 31 }]));
  const colors = graphColors(commits, commits, branches, 'dev', spine);
  const tracks = branchTracks(commits, branches, 'dev', spine, positions, false, colors);
  const paths = graphHoverIndex(commits, tracks);
  const dev = resolveGraphHover({ kind: 'branch', id: 'dev' }, paths)!;
  const main = resolveGraphHover({ kind: 'branch', id: 'main' }, paths)!;

  assert.deepEqual([...dev.nodes], ['d4', 'd3', 'd2', 'd1']);
  assert.deepEqual([...main.nodes], ['d2', 'd1']);
  assert.deepEqual([...main.edges], ['d2:d1']);
  assert.deepEqual([...main.branches], ['main']);
  for (const sha of ['d4', 'd3']) {
    assert.equal(resolveGraphHover({ kind: 'commit', id: sha }, paths), dev);
  }
  for (const sha of ['d2', 'd1']) {
    const shared = resolveGraphHover({ kind: 'commit', id: sha }, paths)!;
    assert.deepEqual([...shared.nodes], [sha]);
    assert.equal(shared.edges.size, 0);
    assert.equal(shared.branches.size, 0);
  }
});

test('identical lane coordinates and palette colors cannot join unrelated paths', () => {
  const { index: paths } = index(merged(), undefined, false, true);
  const focus = resolveGraphHover({ kind: 'branch', id: 'feature' }, paths)!;
  assert.equal(graphHoverAlpha(focus, 'nodes', 'other'), 0.5);
  assert.equal(graphHoverAlpha(focus, 'edges', 'other:root'), 0.5);
  const unclassified: BranchTrack = { name: 'guess', lane: 0, color: 0, points: [{ x: 48, y: 0 }] };
  const unknown = graphHoverIndex(merged(), [unclassified]);
  assert.equal(resolveGraphHover({ kind: 'branch', id: 'guess' }, unknown), null);
  assert.deepEqual(
    [...resolveGraphHover({ kind: 'commit', id: 'feature' }, unknown)!.nodes],
    ['feature'],
  );
});

test('an unresolved parent keeps only its existing real stub edge; unloaded HEADs have no focus', () => {
  const commits = [commit('tip', 'unloaded')];
  const { index: paths } = index(commits, refs({ feature: 'tip', absent: 'unloaded' }));
  const focus = resolveGraphHover({ kind: 'branch', id: 'feature' }, paths)!;
  assert.deepEqual([...focus.nodes], ['tip']);
  assert.deepEqual([...focus.edges], ['tip:unloaded']);
  assert.equal(resolveGraphHover({ kind: 'branch', id: 'absent' }, paths), null);
  assert.equal(resolveGraphHover({ kind: 'commit', id: 'unloaded' }, paths), null);
});

test('updated HEADs and deleted references use rebuilt paths and cannot revive stale focus', () => {
  const before = merged();
  const initial = index(before).index;
  const target = { kind: 'branch', id: 'feature' } as const;
  const original = resolveGraphHover(target, initial)!;
  const next = index(
    [commit('new', 'feature'), ...before],
    refs({ main: 'merge', feature: 'new' }),
  ).index;
  assert.ok(resolveGraphHover(target, next)!.nodes.has('new'));
  assert.ok(!original.nodes.has('new'));
  const deleted = index(before, refs({ main: 'merge' })).index;
  assert.equal(resolveGraphHover(target, deleted), null);
  const retired = index(
    before.filter((c) => c.sha !== 'other'),
    refs({ main: 'merge' }),
  ).index;
  assert.equal(resolveGraphHover({ kind: 'commit', id: 'other' }, retired), null);
});

test('direction reversal changes positions without changing semantic hover membership', () => {
  const normal = resolveGraphHover({ kind: 'branch', id: 'feature' }, index(merged()).index)!;
  const reverse = resolveGraphHover(
    { kind: 'branch', id: 'feature' },
    index(merged(), undefined, true).index,
  )!;
  assert.deepEqual(reverse, normal);
});

test('only actual parent edges are accepted and relative alpha returns exactly to its baseline', () => {
  const paths = graphHoverIndex(
    [commit('a', 'b'), commit('b'), commit('c')],
    [
      {
        name: 'feature',
        lane: 0,
        points: [],
        commitShas: ['a', 'b'],
        edgeKeys: ['a:b', 'a:c'],
      },
    ],
  );
  const focus = resolveGraphHover({ kind: 'branch', id: 'feature' }, paths)!;
  assert.deepEqual([...focus.edges], ['a:b']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'a'), 1);
  assert.equal(0.65 * graphHoverAlpha(focus, 'edges', 'a:c'), 0.325);
  assert.equal(0.35 * graphHoverAlpha(focus, 'branches', 'other'), 0.175);
  assert.equal(0.65 * graphHoverAlpha(resolveGraphHover(null, paths), 'edges', 'a:c'), 0.65);
});
