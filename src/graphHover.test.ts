import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Commit, Branch } from './model';
import { branchTracks, type BranchTrack } from './branchLabels';
import { emptyGraphColors, graphColors } from './graphColors';
import {
  graphHoverIndex,
  graphHoverAlpha,
  graphCommitFocus,
  resolveGraphHover,
} from './graphHover';

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

test('a branch badge follows all HEAD ancestors beyond joins and excludes newer merge descendants', () => {
  const { tracks, index: paths } = index(merged());
  const focus = resolveGraphHover({ kind: 'branch', id: 'feature' }, paths)!;
  assert.deepEqual([...focus.nodes].sort(), ['base', 'feature', 'root']);
  assert.deepEqual([...focus.edges].sort(), ['base:root', 'feature:base']);
  assert.deepEqual([...focus.branches], ['feature']);
  assert.equal(graphHoverAlpha(focus, 'edges', 'base:root'), 1);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:feature'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:base'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'other'), 0.25);
  assert.equal(tracks.find((track) => track.name === 'feature')!.points.length, 2);
});

test('a commit hover and selection resolve to the exact same cached ancestor focus', () => {
  const { index: paths } = index(merged());
  assert.equal(
    resolveGraphHover({ kind: 'commit', id: 'feature' }, paths),
    resolveGraphHover({ kind: 'commit', id: 'feature' }, paths),
  );
  assert.deepEqual([...resolveGraphHover({ kind: 'commit', id: 'feature' }, paths)!.nodes].sort(), [
    'base',
    'feature',
    'root',
  ]);
});

test('shared join and merge commits follow actual ancestry without choosing one branch', () => {
  const { index: paths } = index(merged());
  const expected: Record<string, string[]> = {
    merge: ['base', 'feature', 'merge', 'root'],
    base: ['base', 'root'],
    root: ['root'],
  };
  for (const [sha, nodes] of Object.entries(expected)) {
    const focus = resolveGraphHover({ kind: 'commit', id: sha }, paths)!;
    assert.deepEqual([...focus.nodes].sort(), nodes);
  }
});

test('shared HEAD aliases retain separate badge focus and common commit ancestry', () => {
  const { index: paths } = index(
    merged(),
    refs({ main: 'merge', alias: 'merge', feature: 'feature' }),
  );
  const alias = resolveGraphHover({ kind: 'branch', id: 'alias' }, paths)!;
  assert.equal(graphHoverAlpha(alias, 'branches', 'alias'), 1);
  assert.equal(graphHoverAlpha(alias, 'branches', 'main'), 0.25);
  const node = resolveGraphHover({ kind: 'commit', id: 'merge' }, paths)!;
  assert.deepEqual([...node.nodes].sort(), ['base', 'feature', 'merge', 'root']);
  assert.ok(node.edges.has('merge:feature'));
  assert.ok(node.branches.has('main') && node.branches.has('alias'));
});

test('older references on the base spine cannot change commit ancestry', () => {
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
    assert.deepEqual(
      resolveGraphHover({ kind: 'commit', id: sha }, paths)!.nodes,
      new Set(sha === 'd4' ? ['d4', 'd3', 'd2', 'd1'] : ['d3', 'd2', 'd1']),
    );
  }
  for (const sha of ['d2', 'd1']) {
    const shared = resolveGraphHover({ kind: 'commit', id: sha }, paths)!;
    assert.deepEqual([...shared.nodes], sha === 'd2' ? ['d2', 'd1'] : ['d1']);
    assert.equal(shared.edges.size, sha === 'd2' ? 1 : 0);
  }
});

test('dev badge includes merged PR commits through every parent and excludes unmerged and release siblings', () => {
  const commits = [
    commit('unmerged', 'dev'),
    commit('dev', 'previous', 'pr-latest'),
    commit('pr-latest', 'previous'),
    commit('previous', 'older', 'pr-previous'),
    commit('pr-previous', 'older'),
    commit('older', 'root', 'pr-older', 'octopus'),
    commit('pr-older', 'root'),
    commit('octopus', 'root'),
    commit('production', 'root'),
    commit('root'),
  ];
  const { index: paths } = index(
    commits,
    refs({ main: 'unmerged', dev: 'dev', previous: 'previous', production: 'production' }),
  );
  const badge = resolveGraphHover({ kind: 'branch', id: 'dev' }, paths)!;
  const node = resolveGraphHover({ kind: 'commit', id: 'dev' }, paths)!;
  assert.deepEqual(badge.nodes, node.nodes);
  assert.deepEqual(badge.edges, node.edges);
  for (const sha of ['pr-latest', 'pr-previous', 'pr-older', 'octopus', 'root']) {
    assert.equal(graphHoverAlpha(badge, 'nodes', sha), 1);
  }
  assert.ok(badge.edges.has('dev:pr-latest'));
  assert.ok(badge.edges.has('previous:pr-previous'));
  assert.ok(badge.edges.has('older:octopus'));
  for (const sha of ['unmerged', 'production']) {
    assert.equal(graphHoverAlpha(badge, 'nodes', sha), 0.25);
  }
  assert.deepEqual([...badge.branches].sort(), ['dev', 'previous']);
});

test('identical lane coordinates and palette colors cannot join unrelated paths', () => {
  const { index: paths } = index(merged(), undefined, false, true);
  const focus = resolveGraphHover({ kind: 'branch', id: 'feature' }, paths)!;
  assert.equal(graphHoverAlpha(focus, 'nodes', 'other'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'other:root'), 0.25);
  const unclassified: BranchTrack = { name: 'guess', lane: 0, color: 0, points: [{ x: 48, y: 0 }] };
  const unknown = graphHoverIndex(merged(), [unclassified]);
  assert.equal(resolveGraphHover({ kind: 'branch', id: 'guess' }, unknown), null);
  assert.deepEqual(
    [...resolveGraphHover({ kind: 'commit', id: 'feature' }, unknown)!.nodes].sort(),
    ['base', 'feature', 'root'],
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
        commitShas: ['a', 'c'],
      },
    ],
  );
  const focus = resolveGraphHover({ kind: 'branch', id: 'feature' }, paths)!;
  assert.deepEqual([...focus.edges], ['a:b']);
  assert.deepEqual([...focus.nodes], ['a', 'b']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'a'), 1);
  assert.equal(0.65 * graphHoverAlpha(focus, 'edges', 'a:c'), 0.1625);
  assert.equal(0.35 * graphHoverAlpha(focus, 'branches', 'other'), 0.0875);
  assert.equal(0.65 * graphHoverAlpha(resolveGraphHover(null, paths), 'edges', 'a:c'), 0.65);
});

test('commit selection follows every parent through joins without highlighting unrelated descendants', () => {
  const commits = [commit('newer', 'merge'), ...merged()];
  const { tracks } = index(commits);
  const focus = graphCommitFocus('merge', commits, tracks)!;
  assert.deepEqual([...focus.nodes].sort(), ['base', 'feature', 'merge', 'root']);
  assert.deepEqual([...focus.edges].sort(), [
    'base:root',
    'feature:base',
    'merge:base',
    'merge:feature',
  ]);
  assert.deepEqual([...focus.branches].sort(), ['feature', 'main']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'other'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'newer:merge'), 0.25);
});

test('a commit inside a branch keeps that branch badge but excludes its newer commits and merge connector', () => {
  const commits = [commit('tip', 'feature'), ...merged()];
  const { tracks } = index(commits, refs({ main: 'merge', feature: 'tip', older: 'base' }));
  const focus = graphCommitFocus('feature', commits, tracks)!;
  assert.deepEqual([...focus.nodes].sort(), ['base', 'feature', 'root']);
  assert.deepEqual([...focus.edges].sort(), ['base:root', 'feature:base']);
  assert.deepEqual([...focus.branches].sort(), ['feature', 'older']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'tip'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:feature'), 0.25);
});

test('commit ancestry stays deterministic for shared commits and does not need surviving branch names', () => {
  const commits = merged();
  const { tracks } = index(commits, refs({ main: 'merge', alias: 'merge', feature: 'feature' }));
  const focus = graphCommitFocus('merge', commits, tracks)!;
  assert.deepEqual([...focus.branches].sort(), ['alias', 'feature', 'main']);
  const unnamed = graphCommitFocus('merge', commits, [])!;
  assert.deepEqual(unnamed.nodes, focus.nodes);
  assert.deepEqual(unnamed.edges, focus.edges);
  assert.equal(unnamed.branches.size, 0);
});

test('commit ancestry includes all octopus parents, keeps existing unloaded stubs and expands on loaded data', () => {
  const commits = [commit('merge', 'base', 'feature', 'other'), ...merged().slice(1)];
  const focus = graphCommitFocus('merge', commits, [])!;
  assert.equal(focus.nodes.size, 5);
  assert.ok(focus.edges.has('merge:other'));
  const partial = graphCommitFocus('tip', [commit('tip', 'unloaded')], [])!;
  assert.deepEqual([...partial.nodes], ['tip']);
  assert.deepEqual([...partial.edges], ['tip:unloaded']);
  const complete = graphCommitFocus('tip', [commit('tip', 'unloaded'), commit('unloaded')], [])!;
  assert.deepEqual([...complete.nodes], ['tip', 'unloaded']);
  assert.equal(graphCommitFocus('', commits, []), null);
  assert.equal(graphCommitFocus('deleted', commits, []), null);
});

test('commit focus is identical for hover and selection regardless of display direction', () => {
  const commits = merged();
  const normal = index(commits);
  const reverse = index(commits, undefined, true);
  assert.deepEqual(
    graphCommitFocus('feature', commits, normal.tracks),
    graphCommitFocus('feature', commits, reverse.tracks),
  );
  const selection = graphCommitFocus('base', commits, normal.tracks)!;
  const hover = resolveGraphHover({ kind: 'commit', id: 'base' }, normal.index)!;
  assert.deepEqual([...selection.nodes].sort(), ['base', 'root']);
  assert.deepEqual(hover, selection);
});

test('commit focus caching stays bounded while hover visits many ancestors', () => {
  const commits = Array.from({ length: 50 }, (_, i) =>
    commit(String(i), ...(i < 49 ? [String(i + 1)] : [])),
  );
  const paths = graphHoverIndex(commits, []);
  for (let i = 0; i < commits.length; i++) {
    const target = { kind: 'commit', id: String(i) } as const;
    const focus = resolveGraphHover(target, paths)!;
    assert.equal(focus.nodes.size, commits.length - i);
    assert.equal(resolveGraphHover(target, paths), focus);
    assert.ok(paths.commitFocus.size <= 2);
  }
  assert.equal(resolveGraphHover({ kind: 'commit', id: '0' }, paths)!.nodes.size, 50);
});
