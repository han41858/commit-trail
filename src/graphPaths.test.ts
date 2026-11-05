import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphColors } from './graphColors';
import { graphHoverIndex, resolveGraphHover, type GraphHoverTarget } from './graphHover';
import { branchTracks } from './branchLabels';
import { layout, type Branch, type Commit } from './model';

function commit(sha: string, minute: number, ...parents: string[]): Commit {
  const date = new Date(Date.UTC(2026, 10, 5, 0, minute)).toISOString();
  return {
    sha,
    parents: parents.map((sha) => ({ sha })),
    commit: { message: sha, author: { name: 'Author', date }, committer: { date } },
    html_url: '',
  };
}

const ref = (name: string, sha: string): Branch => ({ name, commit: { sha } });
const branches = [ref('main', 'm'), ref('dev', 'a4'), ref('feature', 'f2'), ref('topic', 'a2')];
const workingHistory = () => [
  commit('f2', 100, 'f1'),
  commit('f1', 90, 'a3'),
  commit('a4', 80, 'a3'),
  commit('m', 70, 'root'),
  commit('a3', 60, 'a2'),
  commit('a2', 50, 'a1'),
  commit('a1', 40, 'root'),
  commit('root', 0),
];

function graph(commits: Commit[], references = branches, defaultBranch?: string) {
  const colors = graphColors(commits, references, 'main', undefined, defaultBranch);
  const data = layout(
    commits,
    new Map(),
    references.find((branch) => branch.name === 'main')?.commit.sha,
  );
  const positions = new Map(
    data.ordered.map((commit, rank) => [
      commit.sha,
      { x: 48 + data.lanes.get(commit.sha)! * 34, y: rank * 31 },
    ]),
  );
  const tracks = branchTracks(
    commits,
    references,
    'main',
    data.spine,
    positions,
    false,
    colors,
    data.lanes,
  );
  return { colors, index: graphHoverIndex(data.ordered, tracks, colors.paths), tracks };
}

function focus(target: GraphHoverTarget, value: ReturnType<typeof graph>) {
  const result = resolveGraphHover(target, value.index);
  assert.ok(result);
  return result;
}

function assertWorkingOwnership(
  value: ReturnType<typeof graph>,
  devHead = 'a4',
  featureHead = 'f2',
) {
  const { colors } = value;
  for (const sha of ['a1', 'a2', 'a3', 'a4']) {
    assert.equal(
      colors.paths.nodes.get(sha),
      colors.paths.nodes.get(devHead),
      `${sha} belongs to dev`,
    );
    assert.equal(colors.nodes.get(sha), colors.branches.get('dev'), `${sha} keeps dev's color`);
  }
  for (const sha of ['f1', 'f2']) {
    assert.equal(colors.paths.nodes.get(sha), colors.paths.nodes.get(featureHead));
    assert.equal(colors.nodes.get(sha), colors.branches.get('feature'));
  }
  assert.notEqual(colors.paths.nodes.get(devHead), colors.paths.nodes.get(featureHead));
  assert.notEqual(colors.branches.get('dev'), colors.branches.get('feature'));
  assert.equal(colors.paths.branches.get('topic'), colors.paths.branches.get('dev'));
}

test('a newer feature from the middle of dev cannot take ownership of dev history', () => {
  const value = graph(workingHistory());
  assertWorkingOwnership(value);

  const dev = focus({ kind: 'branch', id: 'dev' }, value);
  const feature = focus({ kind: 'branch', id: 'feature' }, value);
  assert.deepEqual(dev.nodes, new Set(['a4', 'a3', 'a2', 'a1', 'root']));
  assert.deepEqual(feature.nodes, new Set(['f2', 'f1', 'a3']));
  assert.deepEqual(feature.edges, new Set(['f2:f1', 'f1:a3']));
  assert.deepEqual(focus({ kind: 'commit', id: 'a2' }, value).nodes, dev.nodes);
  assert.deepEqual(focus({ kind: 'branch', id: 'topic' }, value).nodes, dev.nodes);
  assert.deepEqual(focus({ kind: 'edge', id: 'a3:a2' }, value).nodes, dev.nodes);
  assert.deepEqual(focus({ kind: 'edge', id: 'f1:a3' }, value).nodes, feature.nodes);
  assert.deepEqual(value.tracks.find((track) => track.name === 'feature')!.commitShas, [
    'f2',
    'f1',
    'a3',
  ]);
});

test('independent arrival orders give the same named owners and colors', () => {
  const commits = workingHistory();
  const expected = graph(commits);
  const sorted = <T>(values: ReadonlyMap<string, T>) =>
    [...values].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const permutation of [
    [...commits].reverse(),
    [...commits.slice(3), ...commits.slice(0, 3)],
  ]) {
    const actual = graph(permutation, [...branches].reverse());
    assertWorkingOwnership(actual);
    for (const kind of ['nodes', 'edges', 'branches'] as const) {
      assert.deepEqual(sorted(actual.colors.paths[kind]), sorted(expected.colors.paths[kind]));
      assert.deepEqual(sorted(actual.colors[kind]), sorted(expected.colors[kind]));
    }
  }
});

test('advancing either branch or inverting commit dates cannot transfer shared dev history', () => {
  const original = workingHistory();
  const cases = [
    { commits: [commit('f3', 110, 'f2'), ...original], dev: 'a4', feature: 'f3' },
    { commits: [commit('a5', 120, 'a4'), ...original], dev: 'a5', feature: 'f2' },
    {
      commits: original.map((value) => (value.sha === 'a4' ? commit('a4', 200, 'a3') : value)),
      dev: 'a4',
      feature: 'f2',
    },
  ];
  for (const scenario of cases) {
    const references = [
      ref('main', 'm'),
      ref('dev', scenario.dev),
      ref('feature', scenario.feature),
      ref('topic', 'a2'),
    ];
    assertWorkingOwnership(graph(scenario.commits, references), scenario.dev, scenario.feature);
  }
});

test('a synchronization merge preserves the known repository default as a separate flow', () => {
  const commits = [commit('feature-sync', 110, 'f2', 'a4'), ...workingHistory()];
  const references = [
    ref('main', 'm'),
    ref('dev', 'a4'),
    ref('feature', 'feature-sync'),
    ref('topic', 'a2'),
  ];
  const value = graph(commits, references, 'dev');
  assertWorkingOwnership(value, 'a4', 'feature-sync');
  assert.equal(
    value.colors.paths.edges.get('feature-sync:a4'),
    value.colors.paths.branches.get('dev'),
  );
  assert.equal(
    value.colors.paths.edges.get('feature-sync:f2'),
    value.colors.paths.branches.get('feature'),
  );
  assert.deepEqual(
    focus({ kind: 'branch', id: 'feature' }, value).nodes,
    new Set(['feature-sync', 'f2', 'f1', 'a3']),
  );
});

test('a ref inside an unnamed merged path stays an alias of the actual path head', () => {
  const commits = [
    commit('m', 100, 'base', 'former-tip'),
    commit('base', 80, 'root'),
    commit('former-tip', 90, 'middle'),
    commit('middle', 60, 'root'),
    commit('root', 0),
  ];
  const value = graph(commits, [ref('main', 'm'), ref('middle-ref', 'middle')]);
  assert.equal(value.colors.paths.nodes.get('middle'), value.colors.paths.nodes.get('former-tip'));
  assert.equal(
    value.colors.paths.branches.get('middle-ref'),
    value.colors.paths.nodes.get('former-tip'),
  );
  assert.deepEqual(
    focus({ kind: 'branch', id: 'middle-ref' }, value).nodes,
    new Set(['former-tip', 'middle', 'root', 'm']),
  );
});

test('a branch reached only through a merge parent retains its own terminal flow', () => {
  const commits = [
    commit('m', 120, 'base', 'a4'),
    commit('base', 100, 'root'),
    commit('a4', 90, 'a3'),
    commit('a3', 60, 'root'),
    commit('root', 0),
  ];
  const value = graph(commits, [ref('main', 'm'), ref('dev', 'a4')]);
  assert.notEqual(value.colors.paths.branches.get('dev'), value.colors.paths.branches.get('main'));
  assert.equal(value.colors.paths.nodes.get('a3'), value.colors.paths.branches.get('dev'));
  assert.deepEqual(
    focus({ kind: 'branch', id: 'dev' }, value).nodes,
    new Set(['a4', 'a3', 'root', 'm']),
  );
});

test('an exclusive integration merge outranks a newer lower-SHA work head without name heuristics', () => {
  const commits = [
    commit('a-work-tip', 150, 'a3'),
    commit('z-line-tip', 100, 'a3', 'merged-work'),
    commit('m', 90, 'root'),
    commit('merged-work', 70, 'a2'),
    commit('a3', 60, 'a2'),
    commit('a2', 50, 'a1'),
    commit('a1', 40, 'root'),
    commit('root', 0),
  ];
  const references = [
    ref('main', 'm'),
    ref('harbor', 'z-line-tip'),
    ref('experiment', 'a-work-tip'),
    ref('old-marker', 'a2'),
  ];
  for (const ordered of [commits, [...commits].reverse()]) {
    const value = graph(ordered, [...references].reverse());
    for (const sha of ['a3', 'a2', 'a1']) {
      assert.equal(value.colors.paths.nodes.get(sha), 'z-line-tip');
      assert.equal(value.colors.nodes.get(sha), value.colors.branches.get('harbor'));
    }
    assert.equal(value.colors.paths.branches.get('old-marker'), 'z-line-tip');
    assert.deepEqual(
      focus({ kind: 'branch', id: 'experiment' }, value).nodes,
      new Set(['a-work-tip', 'a3']),
    );
    assert.equal(value.colors.paths.nodes.get('merged-work'), 'merged-work');
  }
});

test('repository default metadata outranks integration evidence and SHA without overriding the selected base', () => {
  const commits = [
    commit('a-integration', 150, 'a3', 'merged-work'),
    commit('z-default', 100, 'a3'),
    commit('m', 90, 'root'),
    commit('merged-work', 70, 'a2'),
    commit('a3', 60, 'a2'),
    commit('a2', 50, 'a1'),
    commit('a1', 40, 'root'),
    commit('root', 0),
  ];
  const references = [
    ref('main', 'm'),
    ref('unexpected-name', 'z-default'),
    ref('integration', 'a-integration'),
  ];
  const value = graph(commits, references, 'unexpected-name');
  for (const sha of ['a3', 'a2', 'a1'])
    assert.equal(value.colors.paths.nodes.get(sha), 'z-default');
  for (const sha of ['m', 'root']) assert.equal(value.colors.paths.nodes.get(sha), 'm');
  assert.equal(value.colors.paths.nodes.get('a-integration'), 'a-integration');
});

test('an inherited merge before a common fork does not promote every descendant as integration', () => {
  const commits = [
    commit('z-tip', 150, 'common-merge'),
    commit('a-tip', 100, 'common-merge'),
    commit('m', 90, 'root'),
    commit('common-merge', 80, 'a2', 'old-work'),
    commit('old-work', 70, 'root'),
    commit('a2', 50, 'root'),
    commit('root', 0),
  ];
  const value = graph(commits, [ref('main', 'm'), ref('dev', 'z-tip'), ref('feature', 'a-tip')]);
  assert.equal(value.colors.paths.nodes.get('common-merge'), 'a-tip');
  assert.equal(value.colors.paths.nodes.get('a2'), 'a-tip');
  assert.equal(value.colors.paths.nodes.get('z-tip'), 'z-tip');
});

test('imports of the selected base or repository default are not integration evidence', () => {
  const common = [
    commit('a-tip', 150, 'a3'),
    commit('m', 90, 'root'),
    commit('default-tip', 80, 'root'),
    commit('a3', 60, 'a2'),
    commit('a2', 50, 'root'),
    commit('root', 0),
  ];
  for (const source of ['m', 'default-tip']) {
    const commits = [commit('z-sync', 200, 'a3', source), ...common];
    const references = [
      ref('main', 'm'),
      ref('baseline', 'default-tip'),
      ref('dev', 'z-sync'),
      ref('feature', 'a-tip'),
    ];
    const value = graph(commits, references, 'baseline');
    assert.equal(value.colors.paths.nodes.get('a3'), 'a-tip');
    assert.equal(value.colors.paths.nodes.get('a2'), 'a-tip');
    assert.equal(value.colors.paths.nodes.get('z-sync'), 'z-sync');
  }
});

test('a redundant secondary first-parent ancestor does not supply integration priority', () => {
  const commits = [
    commit('z-redundant', 200, 'a3', 'a2'),
    commit('a-tip', 150, 'a3'),
    commit('m', 90, 'root'),
    commit('a3', 60, 'a2'),
    commit('a2', 50, 'root'),
    commit('root', 0),
  ];
  const value = graph(commits, [
    ref('main', 'm'),
    ref('harbor', 'z-redundant'),
    ref('work', 'a-tip'),
  ]);
  assert.equal(value.colors.paths.nodes.get('a3'), 'a-tip');
  assert.equal(value.colors.paths.nodes.get('a2'), 'a-tip');
  assert.deepEqual(
    focus({ kind: 'branch', id: 'harbor' }, value).nodes,
    new Set(['z-redundant', 'a3']),
  );
});

test('an interior default ref stays an alias while its synchronization imports remain protected', () => {
  const commits = [
    commit('z-sync', 200, 'a3', 'default-middle'),
    commit('a-tip', 150, 'a3'),
    commit('default-tip', 140, 'default-middle'),
    commit('m', 90, 'root'),
    commit('default-middle', 80, 'default-base'),
    commit('default-base', 70, 'root'),
    commit('a3', 60, 'a2'),
    commit('a2', 50, 'root'),
    commit('root', 0),
  ];
  const references = [
    ref('main', 'm'),
    ref('baseline', 'default-middle'),
    ref('tracking', 'default-tip'),
    ref('harbor', 'z-sync'),
    ref('work', 'a-tip'),
  ];
  const value = graph(commits, references, 'baseline');
  for (const sha of ['default-tip', 'default-middle', 'default-base']) {
    assert.equal(value.colors.paths.nodes.get(sha), 'default-tip');
  }
  assert.equal(value.colors.paths.branches.get('baseline'), 'default-tip');
  assert.equal(value.colors.paths.nodes.get('a3'), 'a-tip');
  assert.equal(value.colors.paths.nodes.get('a2'), 'a-tip');
  assert.equal(value.colors.paths.nodes.get('z-sync'), 'z-sync');
});
