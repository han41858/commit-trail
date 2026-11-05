import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, type Commit, type Branch } from './model';
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
const merged = () => [
  commit('merge', 'base', 'feature'),
  commit('feature', 'base'),
  commit('other', 'root'),
  commit('base', 'root'),
  commit('root'),
];

function index(
  commits: Commit[],
  names = { main: 'merge', feature: 'feature', other: 'other' } as Record<string, string>,
  base = 'main',
  reverse = false,
  sameColors = false,
) {
  const branches = refs(names);
  const head = names[base];
  const data = layout(commits, new Map(), head);
  const positions = new Map(
    data.ordered.map((c, i) => [c.sha, { x: 48, y: (reverse ? commits.length - i : i) * 31 }]),
  );
  const colors = sameColors
    ? emptyGraphColors()
    : graphColors(commits, data.ordered, branches, base, data.spine);
  if (sameColors) {
    for (const c of commits) colors.nodes.set(c.sha, 0);
    for (const b of branches) colors.branches.set(b.name, 0);
  }
  const tracks = branchTracks(commits, branches, base, data.spine, positions, reverse, colors);
  return graphHoverIndex(data.ordered, tracks, head);
}

const branch = (id: string, paths: ReturnType<typeof index>) =>
  resolveGraphHover({ kind: 'branch', id }, paths)!;
const node = (id: string, paths: ReturnType<typeof index>) =>
  resolveGraphHover({ kind: 'commit', id }, paths)!;

test('a branch includes its start and terminal merge without traversing either neighboring flow', () => {
  const focus = branch('feature', index(merged()));
  assert.deepEqual([...focus.nodes], ['feature', 'base', 'merge']);
  assert.deepEqual([...focus.edges], ['feature:base', 'merge:feature']);
  assert.deepEqual([...focus.branches], ['feature']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'base'), 1);
  assert.equal(graphHoverAlpha(focus, 'edges', 'base:root'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:feature'), 1);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'root'), 0.25);
});

test('merging an intermediate commit does not terminate a branch that has continued', () => {
  const commits = [
    commit('new-work', 'old-work'),
    commit('old-merge', 'base', 'old-work'),
    commit('old-work', 'base'),
    commit('base', 'root'),
    commit('root'),
  ];
  const paths = index(commits, { main: 'old-merge', feature: 'new-work' });
  const focus = branch('feature', paths);
  assert.deepEqual([...focus.nodes], ['new-work', 'old-work', 'base']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'old-merge'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'old-merge:old-work'), 0.25);
});

test('multiple terminal merges include only their endpoint and the exact connector', () => {
  const commits = [
    commit('after-merge', 'merge'),
    commit('merge', 'base', 'feature', 'other'),
    commit('release', 'root', 'feature'),
    commit('feature', 'base'),
    commit('other', 'root'),
    commit('base', 'root'),
    commit('root'),
  ];
  const paths = index(commits, {
    main: 'after-merge',
    feature: 'feature',
    release: 'release',
    other: 'other',
  });
  const focus = branch('feature', paths);
  assert.deepEqual([...focus.nodes].sort(), ['base', 'feature', 'merge', 'release']);
  assert.deepEqual([...focus.edges].sort(), ['feature:base', 'merge:feature', 'release:feature']);
  for (const sha of ['other', 'root', 'after-merge']) {
    assert.equal(graphHoverAlpha(focus, 'nodes', sha), 0.25);
  }
  for (const key of ['merge:base', 'merge:other', 'release:root', 'after-merge:merge']) {
    assert.equal(graphHoverAlpha(focus, 'edges', key), 0.25);
  }
  assert.deepEqual([...focus.branches], ['feature']);
});

test('first-parent continuations never end the original flow, whether ordinary or merge commits', () => {
  const commits = [
    commit('merge', 'feature', 'other'),
    commit('continuation', 'feature'),
    commit('feature', 'base'),
    commit('other', 'root'),
    commit('base', 'root'),
    commit('root'),
  ];
  const paths = index(commits, {
    main: 'merge',
    feature: 'feature',
    baseline: 'base',
    continuation: 'continuation',
    other: 'other',
  });
  const focus = branch('feature', paths);
  assert.deepEqual([...focus.nodes], ['feature', 'base']);
  assert.deepEqual([...focus.edges], ['feature:base']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'continuation'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'merge'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:feature'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:other'), 0.25);
  assert.ok(branch('other', paths).nodes.has('merge'));
  assert.ok(branch('other', paths).edges.has('merge:other'));
});

test('importing the current reference HEAD into work is not an ending of the reference flow', () => {
  const commits = [
    commit('f3', 'f2', 'm2'),
    commit('f2', 'f1'),
    commit('f1', 'm1'),
    commit('m2', 'm1'),
    commit('m1'),
  ];
  for (const reference of ['main', 'release/custom']) {
    const paths = index(commits, { [reference]: 'm2', feature: 'f3' }, reference);
    const focus = branch(reference, paths);
    assert.deepEqual([...focus.nodes], ['m2', 'm1']);
    assert.deepEqual([...focus.edges], ['m2:m1']);
    assert.equal(graphHoverAlpha(focus, 'edges', 'f3:m2'), 0.25);
    assert.equal(node('m2', paths), focus);
  }
});

test('several work branches syncing the same reference HEAD do not create several false endings', () => {
  const commits = [
    commit('f3', 'f2', 'm2'),
    commit('g3', 'g2', 'm2'),
    commit('f2', 'm1'),
    commit('g2', 'm1'),
    commit('m2', 'm1'),
    commit('m1'),
  ];
  const paths = index(commits, { main: 'm2', feature: 'f3', other: 'g3' });
  assert.deepEqual([...branch('main', paths).nodes], ['m2', 'm1']);
  assert.deepEqual([...branch('main', paths).edges], ['m2:m1']);
  assert.equal(paths.ends.has('m2'), false);
});

test('landing the synced work in the reference flow still marks the work ending', () => {
  const commits = [
    commit('m3', 'm2', 'f3'),
    commit('f3', 'f2', 'm2'),
    commit('f2', 'f1'),
    commit('f1', 'm1'),
    commit('m2', 'm1'),
    commit('m1'),
  ];
  const paths = index(commits, { main: 'm3', feature: 'f3' });
  const focus = branch('feature', paths);
  assert.deepEqual([...focus.nodes], ['f3', 'f2', 'f1', 'm1', 'm3']);
  assert.ok(focus.edges.has('m3:f3'));
  assert.equal(graphHoverAlpha(focus, 'edges', 'f3:m2'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'm3:m2'), 0.25);
  assert.deepEqual([...branch('main', paths).nodes], ['m3', 'm2', 'm1']);
});

test('ending detection only exempts the selected reference, including promotions out of it', () => {
  const commits = [
    commit('promotion', 'm1', 'd2'),
    commit('sync', 'f1', 'd2'),
    commit('f1', 'd1'),
    commit('m1', 'd1'),
    commit('d2', 'd1'),
    commit('d1'),
  ];
  const names = { main: 'promotion', dev: 'd2', feature: 'sync' };
  const fromMain = branch('dev', index(commits, names, 'main'));
  assert.deepEqual([...fromMain.nodes].sort(), ['d1', 'd2', 'promotion', 'sync']);
  assert.deepEqual([...fromMain.edges].sort(), ['d2:d1', 'promotion:d2', 'sync:d2']);
  const fromDev = branch('dev', index(commits, names, 'dev'));
  assert.deepEqual([...fromDev.nodes], ['d2', 'd1']);
  assert.deepEqual([...fromDev.edges], ['d2:d1']);
});

test('loading a terminal merge rebuilds the endpoints without changing an older focus', () => {
  const commits = [commit('feature', 'base'), commit('base', 'root'), commit('root')];
  const original = branch('feature', index(commits, { main: 'base', feature: 'feature' }));
  const refreshed = index([commit('merge', 'base', 'feature'), ...commits], {
    main: 'merge',
    feature: 'feature',
  });
  assert.deepEqual([...original.nodes], ['feature', 'base']);
  assert.deepEqual([...branch('feature', refreshed).nodes], ['feature', 'base', 'merge']);
  assert.ok(branch('feature', refreshed).edges.has('merge:feature'));
});

test('hovering or selecting a middle commit highlights its whole flow through the branch start', () => {
  const commits = [
    commit('merge', 'base', 'feature2'),
    commit('feature2', 'feature1'),
    commit('feature1', 'base'),
    commit('base', 'root'),
    commit('root'),
  ];
  const paths = index(commits, { main: 'merge', feature: 'feature2' });
  const focus = node('feature1', paths);
  assert.deepEqual([...focus.nodes], ['feature2', 'feature1', 'base', 'merge']);
  assert.deepEqual([...focus.edges], ['feature2:feature1', 'feature1:base', 'merge:feature2']);
  assert.equal(node('feature2', paths), focus);
  assert.equal(branch('feature', paths), focus);
  assert.equal(branch('feature', paths).nodes, focus.nodes);
  assert.equal(branch('feature', paths).edges, focus.edges);
});

test('the integration flow excludes merged work and all second-parent connectors', () => {
  const paths = index(merged());
  const focus = branch('main', paths);
  assert.deepEqual([...focus.nodes], ['merge', 'base', 'root']);
  assert.deepEqual([...focus.edges], ['merge:base', 'base:root']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'feature'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:feature'), 0.25);
  assert.equal(node('merge', paths).nodes, focus.nodes);
});

test('deleted or unnamed branches retain their own first-parent flow', () => {
  const commits = [
    commit('merge', 'base', 'tip'),
    commit('tip', 'work'),
    commit('work', 'base'),
    commit('base', 'root'),
    commit('root'),
  ];
  const paths = index(commits, { main: 'merge' });
  assert.deepEqual([...node('work', paths).nodes], ['tip', 'work', 'base', 'merge']);
  assert.equal(node('work', paths), node('tip', paths));
  assert.equal(node('work', paths).branches.size, 0);
  assert.equal(graphHoverAlpha(node('work', paths), 'nodes', 'merge'), 1);
});

test('same-HEAD aliases share a flow while an explicit badge keeps only its own name bright', () => {
  const paths = index(merged(), { main: 'merge', alias: 'merge', feature: 'feature' });
  const alias = branch('alias', paths);
  assert.deepEqual(alias.nodes, branch('main', paths).nodes);
  assert.deepEqual([...alias.branches], ['alias']);
  assert.equal(graphHoverAlpha(alias, 'branches', 'main'), 0.25);
  assert.deepEqual([...node('merge', paths).branches].sort(), ['alias', 'main']);
  assert.equal(graphHoverAlpha(alias, 'nodes', 'feature'), 0.25);
});

test('older named HEADs bound a newer flow without following the previous branch', () => {
  const commits = [commit('d4', 'd3'), commit('d3', 'd2'), commit('d2', 'd1'), commit('d1')];
  const names = { dev: 'd4', main: 'd2' };
  for (const base of ['dev', 'main']) {
    const paths = index(commits, names, base);
    assert.deepEqual([...branch('dev', paths).nodes], ['d4', 'd3', 'd2']);
    assert.deepEqual([...branch('dev', paths).edges], ['d4:d3', 'd3:d2']);
    assert.equal(graphHoverAlpha(branch('dev', paths), 'nodes', 'd1'), 0.25);
    assert.equal(graphHoverAlpha(branch('dev', paths), 'branches', 'main'), 0.25);
    assert.deepEqual([...branch('main', paths).nodes], ['d2', 'd1']);
    assert.equal(node('d3', paths).nodes, branch('dev', paths).nodes);
  }
});

test('octopus parents remain separate flows instead of highlighting every merged branch', () => {
  const commits = [commit('merge', 'base', 'feature', 'other'), ...merged().slice(1)];
  const paths = index(commits);
  assert.deepEqual([...branch('main', paths).nodes], ['merge', 'base', 'root']);
  assert.equal(graphHoverAlpha(branch('main', paths), 'edges', 'merge:other'), 0.25);
  assert.deepEqual([...branch('feature', paths).nodes], ['feature', 'base', 'merge']);
  assert.deepEqual([...branch('other', paths).nodes], ['other', 'root', 'merge']);
  assert.equal(graphHoverAlpha(branch('feature', paths), 'nodes', 'other'), 0.25);
});

test('identical palette colors and coordinates cannot combine different flows', () => {
  const paths = index(merged(), undefined, 'main', false, true);
  const focus = branch('feature', paths);
  assert.deepEqual([...focus.nodes], ['feature', 'base', 'merge']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'other'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'other:root'), 0.25);
  assert.notEqual(paths.owners.get('feature'), paths.owners.get('other'));
});

test('label-only tracks do not invent branch names from geometry', () => {
  const unclassified: BranchTrack = { name: 'guess', lane: 0, color: 0, points: [{ x: 48, y: 0 }] };
  const paths = graphHoverIndex(merged(), [unclassified], 'merge');
  assert.equal(resolveGraphHover({ kind: 'branch', id: 'guess' }, paths), null);
  assert.deepEqual([...node('feature', paths).nodes], ['feature', 'base', 'merge']);
  assert.equal(node('feature', paths).branches.size, 0);
});

test('unloaded parents keep only the existing stub and unavailable targets have no focus', () => {
  const paths = index(
    [commit('tip', 'unloaded')],
    { feature: 'tip', absent: 'unloaded' },
    'feature',
  );
  const focus = branch('feature', paths);
  assert.deepEqual([...focus.nodes], ['tip']);
  assert.deepEqual([...focus.edges], ['tip:unloaded']);
  assert.equal(resolveGraphHover({ kind: 'branch', id: 'absent' }, paths), null);
  assert.equal(resolveGraphHover({ kind: 'commit', id: 'unloaded' }, paths), null);
  assert.equal(resolveGraphHover(null, paths), null);
});

test('a changed HEAD extends only its own flow and deleted references cannot revive a badge', () => {
  const commits = merged();
  const original = branch('feature', index(commits));
  const next = index([commit('new', 'feature'), ...commits], { main: 'merge', feature: 'new' });
  assert.deepEqual([...branch('feature', next).nodes], ['new', 'feature', 'base']);
  assert.equal(graphHoverAlpha(branch('feature', next), 'nodes', 'merge'), 0.25);
  assert.ok(!original.nodes.has('new'));
  const deleted = index(commits, { main: 'merge' });
  assert.equal(resolveGraphHover({ kind: 'branch', id: 'feature' }, deleted), null);
  assert.deepEqual([...node('feature', deleted).nodes], ['feature', 'base', 'merge']);
});

test('direction reversal changes geometry without changing flow membership', () => {
  const normal = index(merged());
  const reverse = index(merged(), undefined, 'main', true);
  assert.deepEqual(branch('feature', normal), branch('feature', reverse));
  assert.deepEqual(node('feature', normal), node('feature', reverse));
});

test('parent edges define flows even if track membership extends into unrelated history', () => {
  const commits = merged();
  const paths = graphHoverIndex(
    commits,
    [
      { name: 'main', lane: 0, points: [], commitShas: ['merge'] },
      { name: 'feature', lane: 1, points: [], commitShas: ['feature', 'other', 'root'] },
    ],
    'merge',
  );
  assert.deepEqual([...branch('feature', paths).edges], ['feature:base', 'merge:feature']);
  assert.deepEqual([...branch('feature', paths).nodes], ['feature', 'base', 'merge']);
});

test('moving among commits in one flow shares one cached focus across hover and selection', () => {
  const paths = index(merged());
  const focus = node('merge', paths);
  assert.equal(node('base', paths), focus);
  assert.equal(node('root', paths), focus);
  assert.equal(paths.flows.size, 1);
});

test('visiting many separate flows retains at most two cached results', () => {
  const commits = [
    ...Array.from({ length: 30 }, (_, i) => commit('tip' + i, 'root')),
    commit('root'),
  ];
  const names = {
    main: 'root',
    ...Object.fromEntries(commits.slice(0, -1).map((c) => [c.sha, c.sha])),
  };
  const paths = index(commits, names);
  for (const c of commits.slice(0, -1)) {
    assert.deepEqual([...node(c.sha, paths).nodes], [c.sha, 'root']);
    assert.ok(paths.flows.size <= 2);
  }
  assert.deepEqual([...node('tip0', paths).nodes], ['tip0', 'root']);
});

test('the shared fork node belongs to the parent flow when directly selected', () => {
  const paths = index(merged());
  assert.ok(branch('feature', paths).nodes.has('base'));
  assert.equal(paths.owners.get('base'), 'merge');
  assert.equal(node('base', paths), node('merge', paths));
  assert.equal(graphHoverAlpha(node('base', paths), 'nodes', 'feature'), 0.25);
});

test('long first-parent flows are iterative and intermediate commits reuse the result', () => {
  const commits = Array.from({ length: 10000 }, (_, i) =>
    commit(String(i), ...(i < 9999 ? [String(i + 1)] : [])),
  );
  const paths = graphHoverIndex(commits, [], '0');
  const focus = node('5000', paths);
  assert.equal(focus.nodes.size, 10000);
  assert.equal(focus.edges.size, 9999);
  assert.equal(node('9999', paths), focus);
});

test('an active base HEAD outside a partial reference list still defines its own flow', () => {
  const commits = [commit('active', 'base'), commit('base', 'root'), commit('root')];
  const paths = graphHoverIndex(
    commits,
    [{ name: 'main', lane: 0, points: [], commitShas: ['base'] }],
    'active',
  );
  assert.deepEqual([...node('active', paths).nodes], ['active', 'base']);
  assert.equal(node('active', paths).branches.size, 0);
  assert.equal(graphHoverAlpha(node('active', paths), 'nodes', 'root'), 0.25);
  assert.equal(graphHoverAlpha(null, 'nodes', 'active'), 1);
});
