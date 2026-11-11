import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, type Commit, type Branch } from './model';
import { branchTracks, type BranchTrack } from './branchLabels';
import { graphColors } from './graphColors';
import {
  graphHoverIndex,
  graphHoverOwner,
  graphHoverAlpha,
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
const merged = () => [
  commit('merge', 'base', 'feature'),
  commit('feature', 'base'),
  commit('other', 'root'),
  commit('base', 'root'),
  commit('root'),
];

function index(
  commits: Commit[],
  names = { main: 'merge', feature: 'feature', other: 'other' } as Record<
    string,
    string
  >,
  base = 'main',
  reverse = false,
  sameColors = false,
) {
  const branches = refs(names);
  const head = names[base];
  const data = layout(commits, new Map(), head);
  const positions = new Map(
    data.ordered.map((c, i) => [
      c.sha,
      { x: 48, y: (reverse ? commits.length - i : i) * 31 },
    ]),
  );
  const colors = graphColors(commits, branches, base, head);
  if (sameColors) {
    for (const c of commits) colors.nodes.set(c.sha, 0);
    for (const b of branches) colors.branches.set(b.name, 0);
    for (const id of colors.edges.keys()) colors.edges.set(id, 0);
  }
  const tracks = branchTracks(
    commits,
    branches,
    base,
    data.spine,
    positions,
    reverse,
    colors,
  );
  return graphHoverIndex(data.ordered, tracks, colors.paths);
}

const branch = (id: string, paths: ReturnType<typeof index>) =>
  resolveGraphHover({ kind: 'branch', id }, paths)!;
const node = (id: string, paths: ReturnType<typeof index>) =>
  resolveGraphHover({ kind: 'commit', id }, paths)!;
const edge = (id: string, paths: ReturnType<typeof index>) =>
  resolveGraphHover({ kind: 'edge', id }, paths)!;

const promotionHistory = () => [
  commit('e1ac3b8', 'f2ec8d4', 'a4304a2'),
  commit('new-dev', 'a4304a2'),
  commit('f2ec8d4', 'old-main', '98b49e1'),
  commit('a4304a2', '98b49e1'),
  commit('98b49e1', 'fork'),
  commit('old-main', 'fork'),
  commit('fork', 'root'),
  commit('root'),
];

const intermediateRefHistory = () => [
  commit('M', 'P1', 'a4'),
  commit('a6', 'a5'),
  commit('a5', 'a4'),
  commit('P1', 'm0', 'a1'),
  commit('a4', 'a3'),
  commit('a3', 'a2'),
  commit('a2', 'a1'),
  commit('a1', 'b'),
  commit('m0', 'b'),
  commit('b', 'older'),
  commit('older'),
];

const boundaryHistory = () => [
  commit('c-head', 'c-merge'),
  commit('c-merge', 'c-base', 'b-head'),
  commit('b-head', 'b-middle'),
  commit('b-middle', 'b-first'),
  commit('b-first', 'a-fork'),
  commit('a-head', 'a-fork'),
  commit('a-fork', 'a-base'),
  commit('a-base', 'ancestor-head'),
  commit('c-base', 'ancestor-head'),
  commit('unrelated-head', 'ancestor-head'),
  commit('ancestor-head', 'root'),
  commit('root'),
];
const boundaryNames = {
  ancestor: 'ancestor-head',
  a: 'a-head',
  'a-alias': 'a-head',
  'a-marker': 'a-base',
  b: 'b-head',
  'b-alias': 'b-head',
  'b-marker': 'b-middle',
  c: 'c-head',
  'c-alias': 'c-head',
  'c-marker': 'c-base',
  unrelated: 'unrelated-head',
};
const boundaryBadges = ['a', 'a-alias', 'a-marker', 'c', 'c-alias', 'c-marker'];

test('first-parent line hover reuses its child path including the fork boundary', () => {
  const paths = index(merged());
  assert.equal(edge('feature:base', paths), node('feature', paths));
  assert.notEqual(edge('feature:base', paths), node('base', paths));
  assert.equal(edge('merge:base', paths), node('merge', paths));
});

test('a merge connector follows the incoming path rather than the destination path', () => {
  const paths = index(merged());
  assert.deepEqual(edge('merge:feature', paths), branch('feature', paths));
  assert.equal(
    graphHoverOwner({ kind: 'edge', id: 'merge:feature' }, paths),
    'edge:merge:feature',
  );
  assert.notEqual(edge('merge:feature', paths), node('merge', paths));
});

test('each octopus connector remains separate even when every palette value is identical', () => {
  const commits = [
    commit('merge', 'base', 'work', 'other'),
    commit('work', 'base'),
    commit('other', 'base'),
    commit('base'),
  ];
  const paths = index(
    commits,
    { main: 'merge', work: 'work', other: 'other' },
    'main',
    false,
    true,
  );
  assert.deepEqual(edge('merge:work', paths), branch('work', paths));
  assert.deepEqual(edge('merge:other', paths), branch('other', paths));
  assert.equal(edge('merge:work', paths).nodes.has('other'), false);
});

test('historical connectors cap the incoming path at that merge and exclude future work', () => {
  const commits = [
    commit('new-work', 'old-work'),
    commit('merge', 'base', 'old-work'),
    commit('old-work', 'base'),
    commit('base'),
  ];
  const paths = index(commits, { main: 'merge', work: 'new-work' });
  const focus = edge('merge:old-work', paths);
  assert.deepEqual([...focus.nodes], ['merge', 'old-work', 'base']);
  assert.deepEqual([...focus.edges], ['merge:old-work', 'old-work:base']);
  assert.equal(focus.nodes.has('new-work'), false);
  assert.deepEqual(focus.branches, new Set(['main']));
  assert.equal(branch('work', paths).nodes.has('merge'), false);
});

test('dev promotion includes the full incoming colored path through its fork, including prior promotions', () => {
  const paths = index(promotionHistory(), { main: 'e1ac3b8', dev: 'new-dev' });
  const focus = edge('e1ac3b8:a4304a2', paths);
  assert.deepEqual([...focus.nodes], ['e1ac3b8', 'a4304a2', '98b49e1', 'fork']);
  assert.deepEqual(
    [...focus.edges],
    ['e1ac3b8:a4304a2', 'a4304a2:98b49e1', '98b49e1:fork'],
  );
  assert.equal(focus.branches.has('dev'), false);
  for (const sha of ['new-dev', 'f2ec8d4', 'old-main', 'root'])
    assert.equal(focus.nodes.has(sha), false);
});

test('an intermediate ref cannot split the colored path for badges, nodes or merge connectors', () => {
  const commits = intermediateRefHistory();
  const paths = index(commits, { main: 'M', dev: 'a6', topic: 'a3' });
  const focus = edge('M:a4', paths);
  assert.deepEqual([...focus.nodes], ['M', 'a4', 'a3', 'a2', 'a1', 'b']);
  assert.deepEqual(
    [...focus.edges],
    ['M:a4', 'a4:a3', 'a3:a2', 'a2:a1', 'a1:b'],
  );
  assert.equal(focus.nodes.has('a5'), false);
  assert.equal(focus.nodes.has('older'), false);
  assert.deepEqual(focus.branches, new Set(['main', 'topic']));
  assert.equal(focus.branches.has('dev'), false);
  assert.equal(focus.branches.has('main'), true);
  assert.deepEqual(branch('dev', paths).nodes, branch('topic', paths).nodes);
  assert.equal(node('a3', paths).nodes, branch('dev', paths).nodes);
  assert.deepEqual(branch('topic', paths).branches, new Set(['main', 'topic']));
  assert.equal(paths.owners.get('a6'), paths.owners.get('a3'));
});

test('unknown destination ancestry does not truncate an incoming path at an intermediate ref', () => {
  const commits = [
    commit('M', 'destination', 'a4'),
    commit('a6', 'a5'),
    commit('a5', 'a4'),
    commit('a4', 'a3'),
    commit('a3', 'a2'),
    commit('a2', 'missing'),
    commit('destination'),
  ];
  const focus = edge(
    'M:a4',
    index(commits, { main: 'M', dev: 'a6', topic: 'a3' }),
  );
  assert.deepEqual([...focus.nodes], ['M', 'a4', 'a3', 'a2']);
  assert.deepEqual([...focus.edges], ['M:a4', 'a4:a3', 'a3:a2', 'a2:missing']);
});

test('each merge of the same parent highlights that destination and the same incoming path', () => {
  const commits = [
    commit('m2', 'm1', 'work'),
    commit('m1', 'base', 'work'),
    commit('work', 'base'),
    commit('base'),
  ];
  const paths = index(commits, { main: 'm2', work: 'work' });
  assert.deepEqual([...edge('m1:work', paths).nodes], ['m1', 'work', 'base']);
  assert.deepEqual([...edge('m2:work', paths).nodes], ['m2', 'work', 'base']);
  assert.deepEqual([...edge('m2:work', paths).edges], ['m2:work', 'work:base']);
  assert.equal(edge('m2:work', paths).nodes.has('m1'), false);
});

test('first-parent colored path boundaries also bound merges when the selected base changes', () => {
  const commits = intermediateRefHistory();
  const branches = refs({ main: 'M', dev: 'a6', topic: 'a3' });
  for (const base of ['main', 'dev']) {
    const colors = graphColors(commits, branches, base);
    const paths = index(commits, { main: 'M', dev: 'a6', topic: 'a3' }, base);
    const focus = edge('M:a4', paths);
    const owner = colors.paths.nodes.get('a4');
    let sha: string | undefined = 'a4';
    const expected = new Set(['M']);
    while (sha) {
      expected.add(sha);
      if (colors.paths.nodes.get(sha) !== owner) break;
      sha = commits.find((c) => c.sha === sha)?.parents[0]?.sha;
    }
    assert.deepEqual(focus.nodes, expected);
  }
});

test('loading missing history rebuilds the path without mutating an already resolved focus', () => {
  const commits = [
    commit('merge', 'destination', 'work'),
    commit('future', 'work'),
    commit('work', 'prior'),
  ];
  const names = { main: 'merge', work: 'future' };
  const partial = edge('merge:work', index(commits, names));
  assert.deepEqual([...partial.nodes], ['merge', 'work']);
  assert.deepEqual([...partial.edges], ['merge:work', 'work:prior']);
  const complete = edge(
    'merge:work',
    index(
      [
        ...commits,
        commit('destination', 'fork'),
        commit('prior', 'fork'),
        commit('fork'),
      ],
      names,
    ),
  );
  assert.deepEqual([...complete.nodes], ['merge', 'work', 'prior', 'fork']);
  assert.deepEqual([...partial.nodes], ['merge', 'work']);
});

test('resolving a short incoming path does not scan unrelated loaded history', () => {
  const commits = [
    ...promotionHistory(),
    ...Array.from({ length: 1000 }, (_, i) => commit(`unrelated-${i}`)),
  ];
  const paths = index(commits, { main: 'e1ac3b8', dev: 'new-dev' });
  const original = paths.commits;
  let lookups = 0;
  paths.commits = new Proxy(original, {
    get(target, property) {
      if (property === 'get')
        return (sha: string) => {
          lookups++;
          return original.get(sha);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  assert.equal(edge('e1ac3b8:a4304a2', paths).nodes.size, 4);
  assert.ok(lookups < 30, `${lookups} unrelated lookups`);
});

test('merge scopes and ordinary paths share the two-entry cache limit', () => {
  const commits = [
    ...Array.from({ length: 20 }, (_, i) =>
      commit(`merge-${i}`, 'base', `work-${i}`),
    ),
    ...Array.from({ length: 20 }, (_, i) => commit(`work-${i}`, 'base')),
    commit('base'),
  ];
  const paths = index(commits, { main: 'merge-0' });
  for (let i = 0; i < 20; i++) {
    const id = `merge-${i}:work-${i}`;
    const focus = edge(id, paths);
    assert.equal(edge(id, paths), focus);
    node(`work-${i}`, paths);
    assert.ok(paths.flows.size <= 2);
  }
});

test('edge hover never invents connections or unknown incoming paths', () => {
  const paths = index([commit('tip', 'missing', 'other-missing')], {
    main: 'tip',
  });
  assert.equal(edge('tip:missing', paths), node('tip', paths));
  for (const id of [
    'tip:other-missing',
    'tip:fake',
    'missing:tip',
    'tip',
    'tip:missing:extra',
  ])
    assert.equal(resolveGraphHover({ kind: 'edge', id }, paths), null);
});

test('a branch includes its fork and terminal merge without following either neighboring path', () => {
  const focus = branch('feature', index(merged()));
  assert.deepEqual([...focus.nodes], ['feature', 'base', 'merge']);
  assert.deepEqual([...focus.edges], ['feature:base', 'merge:feature']);
  assert.deepEqual(focus.branches, new Set(['main', 'feature']));
  assert.equal(graphHoverAlpha(focus, 'nodes', 'base'), 1);
  assert.equal(graphHoverAlpha(focus, 'edges', 'base:root'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:feature'), 1);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'root'), 0.25);
});

test('path focus includes existing source and destination badges without extending either path', () => {
  const paths = index(
    boundaryHistory(),
    boundaryNames,
    'ancestor',
    false,
    true,
  );
  const focus = node('b-middle', paths);
  assert.deepEqual(
    focus.nodes,
    new Set(['b-head', 'b-middle', 'b-first', 'a-fork', 'c-merge']),
  );
  assert.deepEqual(
    focus.edges,
    new Set([
      'b-head:b-middle',
      'b-middle:b-first',
      'b-first:a-fork',
      'c-merge:b-head',
    ]),
  );
  assert.deepEqual(
    focus.branches,
    new Set([...boundaryBadges, 'b', 'b-alias', 'b-marker']),
  );
  assert.equal(edge('b-first:a-fork', paths), focus);
  assert.deepEqual(edge('c-merge:b-head', paths), focus);
  assert.equal(paths.owners.get('a-fork'), paths.owners.get('a-head'));
  assert.equal(paths.owners.get('c-merge'), paths.owners.get('c-head'));
  assert.notEqual(paths.owners.get('a-head'), paths.owners.get('c-head'));
  for (const name of [...boundaryBadges, 'b', 'b-alias', 'b-marker'])
    assert.equal(graphHoverAlpha(focus, 'branches', name), 1, name);
  for (const name of ['ancestor', 'unrelated'])
    assert.equal(graphHoverAlpha(focus, 'branches', name), 0.25, name);
  for (const sha of [
    'a-head',
    'a-base',
    'c-head',
    'c-base',
    'ancestor-head',
    'unrelated-head',
  ])
    assert.equal(graphHoverAlpha(focus, 'nodes', sha), 0.25, sha);
  for (const id of [
    'a-fork:a-base',
    'c-head:c-merge',
    'c-merge:c-base',
    'c-base:ancestor-head',
  ])
    assert.equal(graphHoverAlpha(focus, 'edges', id), 0.25, id);
});

test('an explicit badge filters its own aliases while preserving all boundary owner aliases', () => {
  const paths = index(boundaryHistory(), boundaryNames, 'ancestor');
  const ordinary = node('b-middle', paths);
  for (const name of ['b', 'b-alias', 'b-marker']) {
    const selected = branch(name, paths);
    assert.equal(selected.nodes, ordinary.nodes);
    assert.equal(selected.edges, ordinary.edges);
    assert.deepEqual(selected.branches, new Set([...boundaryBadges, name]));
    for (const alias of ['b', 'b-alias', 'b-marker'])
      assert.equal(
        graphHoverAlpha(selected, 'branches', alias),
        alias === name ? 1 : 0.25,
      );
    assert.equal(node('b-first', paths), ordinary);
    assert.deepEqual(
      ordinary.branches,
      new Set([...boundaryBadges, 'b', 'b-alias', 'b-marker']),
    );
  }
  assert.equal(paths.flows.size, 1);
});

test('historical merge badges include only the selected destination and source boundary owners', () => {
  const commits = [
    commit('later-head', 'later-merge'),
    commit('later-merge', 'later-base', 'b-head'),
    commit('later-base', 'ancestor-head'),
    ...boundaryHistory().map((c) =>
      c.sha === 'c-merge' ? commit('c-merge', 'c-base', 'b-middle') : c,
    ),
  ];
  const paths = index(
    commits,
    { ...boundaryNames, later: 'later-head', 'later-alias': 'later-merge' },
    'ancestor',
    false,
    true,
  );
  const focus = edge('c-merge:b-middle', paths);
  assert.deepEqual(
    focus.nodes,
    new Set(['c-merge', 'b-middle', 'b-first', 'a-fork']),
  );
  assert.deepEqual(
    focus.edges,
    new Set(['c-merge:b-middle', 'b-middle:b-first', 'b-first:a-fork']),
  );
  assert.deepEqual(focus.branches, new Set([...boundaryBadges, 'b-marker']));
  for (const name of [
    'b',
    'b-alias',
    'later',
    'later-alias',
    'ancestor',
    'unrelated',
  ])
    assert.equal(graphHoverAlpha(focus, 'branches', name), 0.25, name);
  for (const sha of ['b-head', 'c-head', 'a-head', 'later-head', 'later-merge'])
    assert.equal(graphHoverAlpha(focus, 'nodes', sha), 0.25, sha);
  assert.equal(graphHoverAlpha(focus, 'edges', 'later-merge:b-head'), 0.25);
  assert.equal(edge('c-merge:b-middle', paths), focus);
});

test('an unloaded source boundary adds no guessed badge while a known destination keeps its aliases', () => {
  const commits = boundaryHistory().filter(
    (c) => !['a-head', 'a-fork', 'a-base'].includes(c.sha),
  );
  const paths = index(commits, boundaryNames, 'ancestor');
  const focus = node('b-middle', paths);
  assert.deepEqual(
    focus.nodes,
    new Set(['b-head', 'b-middle', 'b-first', 'c-merge']),
  );
  assert.deepEqual(
    focus.edges,
    new Set([
      'b-head:b-middle',
      'b-middle:b-first',
      'b-first:a-fork',
      'c-merge:b-head',
    ]),
  );
  assert.deepEqual(
    focus.branches,
    new Set(['b', 'b-alias', 'b-marker', 'c', 'c-alias', 'c-marker']),
  );
  for (const name of ['a', 'a-alias', 'a-marker']) {
    assert.equal(graphHoverAlpha(focus, 'branches', name), 0.25);
    assert.equal(resolveGraphHover({ kind: 'branch', id: name }, paths), null);
  }
});

test('an intermediate promotion does not terminate work that continued after it', () => {
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

test('multiple terminal merges add only their endpoints and exact incoming connectors', () => {
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
  assert.deepEqual([...focus.nodes].sort(), [
    'base',
    'feature',
    'merge',
    'release',
  ]);
  assert.deepEqual([...focus.edges].sort(), [
    'feature:base',
    'merge:feature',
    'release:feature',
  ]);
  for (const sha of ['other', 'root', 'after-merge'])
    assert.equal(focus.nodes.has(sha), false);
  for (const id of [
    'merge:base',
    'merge:other',
    'release:root',
    'after-merge:merge',
  ])
    assert.equal(focus.edges.has(id), false);
});

test('syncing the current reference into work does not end the reference path', () => {
  const commits = [
    commit('f3', 'f2', 'm2'),
    commit('g3', 'g2', 'm2'),
    commit('f2', 'f1'),
    commit('f1', 'm1'),
    commit('g2', 'm1'),
    commit('m2', 'm1'),
    commit('m1'),
  ];
  for (const reference of ['main', 'release/custom']) {
    const paths = index(
      commits,
      { [reference]: 'm2', feature: 'f3', other: 'g3' },
      reference,
    );
    assert.deepEqual([...branch(reference, paths).nodes], ['m2', 'm1']);
    assert.deepEqual([...branch(reference, paths).edges], ['m2:m1']);
    assert.equal(paths.ends.has('m2'), false);
    assert.equal(
      graphHoverAlpha(branch(reference, paths), 'edges', 'f3:m2'),
      0.25,
    );
  }
});

test('landing synced work still adds its terminal merge while leaving sync connectors dim', () => {
  const commits = [
    commit('m3', 'm2', 'f3'),
    commit('f3', 'f2', 'm2'),
    commit('f2', 'f1'),
    commit('f1', 'm1'),
    commit('m2', 'm1'),
    commit('m1'),
  ];
  const paths = index(commits, { main: 'm3', feature: 'f3' });
  assert.deepEqual(
    [...branch('feature', paths).nodes],
    ['f3', 'f2', 'f1', 'm1', 'm3'],
  );
  assert.equal(
    graphHoverAlpha(branch('feature', paths), 'edges', 'f3:m2'),
    0.25,
  );
  assert.deepEqual([...branch('main', paths).nodes], ['m3', 'm2', 'm1']);
});

test('hover and selection at a middle commit reuse its entire shared colored path', () => {
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
  assert.deepEqual(
    [...focus.edges],
    ['feature2:feature1', 'feature1:base', 'merge:feature2'],
  );
  assert.equal(node('feature2', paths), focus);
  assert.equal(branch('feature', paths), focus);
});

test('the integration path excludes all incoming branches and secondary connectors', () => {
  const paths = index(merged());
  const focus = branch('main', paths);
  assert.deepEqual([...focus.nodes], ['merge', 'base', 'root']);
  assert.deepEqual([...focus.edges], ['merge:base', 'base:root']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'feature'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'merge:feature'), 0.25);
});

test('deleted branches retain their own path without a name', () => {
  const commits = [
    commit('merge', 'base', 'tip'),
    commit('tip', 'work'),
    commit('work', 'base'),
    commit('base', 'root'),
    commit('root'),
  ];
  const paths = index(commits, { main: 'merge' });
  assert.deepEqual(
    [...node('work', paths).nodes],
    ['tip', 'work', 'base', 'merge'],
  );
  assert.equal(node('work', paths), node('tip', paths));
  assert.deepEqual(node('work', paths).branches, new Set(['main']));
});

test('same-HEAD aliases share a path while the explicit badge keeps only its own name bright', () => {
  const paths = index(merged(), {
    main: 'merge',
    alias: 'merge',
    feature: 'feature',
  });
  const alias = branch('alias', paths);
  assert.deepEqual(alias.nodes, branch('main', paths).nodes);
  assert.deepEqual([...alias.branches], ['alias']);
  assert.deepEqual([...node('merge', paths).branches].sort(), [
    'alias',
    'main',
  ]);
});

test('identical palette colors and coordinates cannot combine distinct path identities', () => {
  const paths = index(merged(), undefined, 'main', false, true);
  const focus = branch('feature', paths);
  assert.deepEqual([...focus.nodes], ['feature', 'base', 'merge']);
  assert.equal(graphHoverAlpha(focus, 'nodes', 'other'), 0.25);
  assert.equal(graphHoverAlpha(focus, 'edges', 'other:root'), 0.25);
  assert.notEqual(paths.owners.get('feature'), paths.owners.get('other'));
});

test('label-only geometry cannot invent a branch identity', () => {
  const commits = merged();
  const unclassified: BranchTrack = {
    name: 'guess',
    lane: 0,
    color: 0,
    points: [{ x: 48, y: 0 }],
  };
  const colors = graphColors(commits, [], 'main', 'merge');
  const paths = graphHoverIndex(commits, [unclassified], colors.paths);
  assert.equal(resolveGraphHover({ kind: 'branch', id: 'guess' }, paths), null);
  assert.deepEqual(
    [...node('feature', paths).nodes],
    ['feature', 'base', 'merge'],
  );
  assert.equal(node('feature', paths).branches.size, 0);
});

test('unloaded parents preserve the stub but do not become selectable targets', () => {
  const paths = index(
    [commit('tip', 'unloaded')],
    { feature: 'tip', absent: 'unloaded' },
    'feature',
  );
  assert.deepEqual([...branch('feature', paths).nodes], ['tip']);
  assert.deepEqual([...branch('feature', paths).edges], ['tip:unloaded']);
  assert.equal(
    resolveGraphHover({ kind: 'branch', id: 'absent' }, paths),
    null,
  );
  assert.equal(
    resolveGraphHover({ kind: 'commit', id: 'unloaded' }, paths),
    null,
  );
  assert.equal(resolveGraphHover(null, paths), null);
});

test('changed HEADs extend the path while deleted refs cannot revive a badge', () => {
  const commits = merged();
  const original = branch('feature', index(commits));
  const next = index([commit('new', 'feature'), ...commits], {
    main: 'merge',
    feature: 'new',
  });
  assert.deepEqual(
    [...branch('feature', next).nodes],
    ['new', 'feature', 'base'],
  );
  assert.equal(branch('feature', next).nodes.has('merge'), false);
  assert.equal(original.nodes.has('new'), false);
  const deleted = index(commits, { main: 'merge' });
  assert.equal(
    resolveGraphHover({ kind: 'branch', id: 'feature' }, deleted),
    null,
  );
  assert.deepEqual(
    [...node('feature', deleted).nodes],
    ['feature', 'base', 'merge'],
  );
});

test('reverse direction changes geometry without changing path or merge-scope membership', () => {
  const normal = index(merged());
  const reverse = index(merged(), undefined, 'main', true);
  assert.deepEqual(branch('feature', normal), branch('feature', reverse));
  assert.deepEqual(
    edge('merge:feature', normal),
    edge('merge:feature', reverse),
  );
  const forwardBoundaries = index(boundaryHistory(), boundaryNames, 'ancestor');
  const reverseBoundaries = index(
    boundaryHistory(),
    boundaryNames,
    'ancestor',
    true,
  );
  assert.deepEqual(
    node('b-middle', forwardBoundaries),
    node('b-middle', reverseBoundaries),
  );
  assert.deepEqual(
    branch('b', forwardBoundaries),
    branch('b', reverseBoundaries),
  );
  assert.deepEqual(
    edge('c-merge:b-head', forwardBoundaries),
    edge('c-merge:b-head', reverseBoundaries),
  );
});

test('track geometry cannot extend a path into unrelated colored history', () => {
  const commits = merged();
  const colors = graphColors(
    commits,
    refs({ main: 'merge', feature: 'feature' }),
    'main',
  );
  const paths = graphHoverIndex(
    commits,
    [
      { name: 'main', lane: 0, points: [], headSha: 'merge' },
      {
        name: 'feature',
        lane: 1,
        headSha: 'feature',
        points: [
          { x: 48, y: 0 },
          { x: 82, y: 62 },
          { x: 48, y: 124 },
        ],
      },
    ],
    colors.paths,
  );
  assert.deepEqual(
    [...branch('feature', paths).edges],
    ['feature:base', 'merge:feature'],
  );
  assert.deepEqual(
    [...branch('feature', paths).nodes],
    ['feature', 'base', 'merge'],
  );
});

test('all commits in one path reuse one cached result', () => {
  const paths = index(merged());
  const focus = node('merge', paths);
  assert.equal(node('base', paths), focus);
  assert.equal(node('root', paths), focus);
  assert.equal(paths.flows.size, 1);
});

test('visiting many separate paths retains at most two cached results', () => {
  const commits = [
    ...Array.from({ length: 30 }, (_, i) => commit(`tip${i}`, 'root')),
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
});

test('directly selecting the shared fork resolves the parent path', () => {
  const paths = index(merged());
  assert.ok(branch('feature', paths).nodes.has('base'));
  assert.equal(paths.owners.get('base'), 'merge');
  assert.equal(node('base', paths), node('merge', paths));
  assert.equal(graphHoverAlpha(node('base', paths), 'nodes', 'feature'), 0.25);
});

test('long paths are iterative and intermediate commits reuse the result', () => {
  const commits = Array.from({ length: 10000 }, (_, i) =>
    commit(String(i), ...(i < 9999 ? [String(i + 1)] : [])),
  );
  const colors = graphColors(commits, [], 'main', '0');
  const paths = graphHoverIndex(commits, [], colors.paths);
  const focus = node('5000', paths);
  assert.equal(focus.nodes.size, 10000);
  assert.equal(focus.edges.size, 9999);
  assert.equal(node('9999', paths), focus);
});

test('an active base HEAD outside the refs still claims its entire colored path', () => {
  const commits = [
    commit('active', 'base'),
    commit('base', 'root'),
    commit('root'),
  ];
  const colors = graphColors(commits, refs({ main: 'base' }), 'main', 'active');
  const paths = graphHoverIndex(
    commits,
    [{ name: 'main', lane: 0, points: [], headSha: 'base' }],
    colors.paths,
  );
  assert.deepEqual(
    [...node('active', paths).nodes],
    ['active', 'base', 'root'],
  );
  assert.deepEqual([...node('active', paths).branches], ['main']);
  assert.equal(graphHoverAlpha(null, 'nodes', 'active'), 1);
});
