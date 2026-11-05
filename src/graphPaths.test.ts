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

test('appending heads with inverted dates leaves the observed post-fork age unchanged', () => {
  const original = workingHistory();
  const cases = [
    { commits: [commit('f3', 110, 'f2'), ...original], dev: 'a4', feature: 'f3' },
    { commits: [commit('a5', 120, 'a4'), ...original], dev: 'a5', feature: 'f2' },
    { commits: [commit('a5', 10, 'a4'), ...original], dev: 'a5', feature: 'f2' },
    { commits: [commit('f3', 10, 'f2'), ...original], dev: 'a4', feature: 'f3' },
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

test('an exclusive integration merge outranks an older lower-SHA work head without name heuristics', () => {
  const commits = [
    commit('a-work-tip', 90, 'a3'),
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

test('an interior repository default protects its boundary without treating sync imports as integration', () => {
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
  for (const sha of ['default-middle', 'default-base']) {
    assert.equal(value.colors.paths.nodes.get(sha), 'default-middle');
  }
  assert.equal(value.colors.paths.nodes.get('default-tip'), 'default-tip');
  assert.equal(value.colors.paths.branches.get('baseline'), 'default-middle');
  assert.deepEqual(
    focus({ kind: 'branch', id: 'tracking' }, value).nodes,
    new Set(['default-tip', 'default-middle']),
  );
  assert.equal(value.colors.paths.nodes.get('a3'), 'a-tip');
  assert.equal(value.colors.paths.nodes.get('a2'), 'a-tip');
  assert.equal(value.colors.paths.nodes.get('z-sync'), 'z-sync');
});

test('a repository default inside a newer feature retains ownership and focus across refreshes', () => {
  const ids = {
    main: '89a3ba781a5e65b568c26eb942b26919f10eabd1',
    a3: '650f734ca0ce11925420650792660aae88cca452',
    a2: '43cd0dda857ed533ad2a6331d029c5e2c8d024bf',
    a1: 'dd5ebbe6847792fe919539a3b95f05de210406d6',
    root: '1edcaf3c6c126e130e28004a421f11d4a240ebdb',
    f2: '0c1d956c69e0c2a3c20fc288e67856a3b950cb21',
    f1: '7a86eaf098cacb367fd2619e14bfbf79c82d0c67',
    f3: '519f0051033950dab84cc22d6c954ff296fddaa9',
  };
  const original = [
    commit(ids.f2, 150, ids.f1),
    commit(ids.f1, 140, ids.a3),
    commit(ids.main, 90, ids.root),
    commit(ids.a3, 80, ids.a2),
    commit(ids.a2, 70, ids.a1),
    commit(ids.a1, 60, ids.root),
    commit(ids.root, 0),
  ];
  let defaultColor: number | undefined;
  for (const advanced of [false, true]) {
    const commits = advanced ? [commit(ids.f3, 200, ids.f2), ...original] : original;
    const references = [
      ref('main', ids.main),
      ref('arbitraryriver', ids.a3),
      ref('feature', advanced ? ids.f3 : ids.f2),
      ref('marker', ids.a2),
    ];
    for (const values of [commits, [...commits].reverse()]) {
      const value = graph(values, [...references].reverse(), 'arbitraryriver');
      for (const sha of [ids.a3, ids.a2, ids.a1]) {
        assert.equal(value.colors.paths.nodes.get(sha), ids.a3);
        assert.equal(value.colors.nodes.get(sha), value.colors.branches.get('arbitraryriver'));
      }
      assert.equal(value.colors.paths.branches.get('marker'), ids.a3);
      assert.notEqual(
        value.colors.branches.get('feature'),
        value.colors.branches.get('arbitraryriver'),
      );
      const expectedDefault = new Set([ids.a3, ids.a2, ids.a1, ids.root]);
      for (const target of [
        { kind: 'branch', id: 'arbitraryriver' },
        { kind: 'commit', id: ids.a2 },
        { kind: 'edge', id: `${ids.a3}:${ids.a2}` },
      ] as const) {
        assert.deepEqual(focus(target, value).nodes, expectedDefault);
      }
      assert.deepEqual(
        focus({ kind: 'branch', id: 'feature' }, value).nodes,
        new Set([...(advanced ? [ids.f3] : []), ids.f2, ids.f1, ids.a3]),
      );
      const actualColor = value.colors.branches.get('arbitraryriver');
      if (defaultColor === undefined) defaultColor = actualColor;
      else assert.equal(actualColor, defaultColor);
    }
  }
});

test('rewriting the actual first post-fork commit can change the observed ownership age', () => {
  const before = graph(workingHistory());
  assertWorkingOwnership(before);
  const commits = [
    commit('rewritten-dev-start', 200, 'a3'),
    ...workingHistory().filter((value) => value.sha !== 'a4'),
  ];
  const references = [
    ref('main', 'm'),
    ref('dev', 'rewritten-dev-start'),
    ref('feature', 'f2'),
    ref('topic', 'a2'),
  ];
  const after = graph(commits, references);
  for (const sha of ['a1', 'a2', 'a3']) assert.equal(after.colors.paths.nodes.get(sha), 'f2');
  assert.deepEqual(
    focus({ kind: 'branch', id: 'dev' }, after).nodes,
    new Set(['rewritten-dev-start', 'a3']),
  );
});

const competitionIds = {
  lowHead: '519f0051033950dab84cc22d6c954ff296fddaa9',
  highHead: 'b385cad883d919c83e3ac010159c0c16d899726f',
  leftStart: 'ee6e8f07cfcdf861b3884c8e05d8336b2222acd1',
  rightStart: '2ff220ef2bde830876fd21570d6750869bfc4024',
  fork: 'a1bb5a5937e5a7eab78eaf65d9c06b0a473835ff',
  main: '89a3ba781a5e65b568c26eb942b26919f10eabd1',
  root: '1edcaf3c6c126e130e28004a421f11d4a240ebdb',
};

function competition(leftHead: string, rightHead: string, leftMinute = 40, rightMinute = 60) {
  const ids = competitionIds;
  const leftStart = commit(ids.leftStart, leftMinute, ids.fork);
  const rightStart = commit(ids.rightStart, rightMinute, ids.fork);
  return {
    leftStart,
    rightStart,
    commits: [
      commit(leftHead, 300, ids.leftStart),
      commit(rightHead, 200, ids.rightStart),
      leftStart,
      rightStart,
      commit(ids.main, 90, ids.root),
      commit(ids.fork, 20, ids.root),
      commit(ids.root, 0),
    ],
    references: [ref('main', ids.main), ref('left-work', leftHead), ref('right-work', rightHead)],
  };
}

test('first post-fork age wins for real SHAs in either ordering and after inverted new head dates', () => {
  const ids = competitionIds;
  for (const [leftHead, rightHead] of [
    [ids.lowHead, ids.highHead],
    [ids.highHead, ids.lowHead],
  ]) {
    const original = competition(leftHead, rightHead);
    const nextHead = '3ee710aa8e2e687c07f5df21ece3919f51261a3c';
    for (const advanced of [false, true]) {
      const commits = advanced
        ? [commit(nextHead, 1, leftHead), ...original.commits]
        : original.commits;
      const references = advanced
        ? [ref('main', ids.main), ref('left-work', nextHead), ref('right-work', rightHead)]
        : original.references;
      for (const values of [commits, [...commits].reverse()]) {
        const value = graph(values, [...references].reverse());
        assert.equal(value.colors.paths.nodes.get(ids.fork), advanced ? nextHead : leftHead);
        assert.equal(value.colors.nodes.get(ids.fork), value.colors.branches.get('left-work'));
      }
    }
  }
});

test('path age uses the topologically first post-fork commit rather than the minimum timestamp', () => {
  const ids = competitionIds;
  const fixture = competition(ids.lowHead, ids.highHead, 90, 60);
  fixture.commits[0] = commit(ids.lowHead, 1, ids.leftStart);
  const value = graph(fixture.commits, fixture.references);
  assert.equal(value.colors.paths.nodes.get(ids.fork), ids.highHead);
});

test('equal first post-fork dates use the fixed HEAD SHA tie-breaker', () => {
  const ids = competitionIds;
  const fixture = competition(ids.highHead, ids.lowHead, 60, 60);
  for (const values of [fixture.commits, [...fixture.commits].reverse()]) {
    const value = graph(values, [...fixture.references].reverse());
    assert.equal(value.colors.paths.nodes.get(ids.fork), ids.lowHead);
  }
});

test('unknown and malformed post-fork dates fall after known dates and remain deterministic', () => {
  const ids = competitionIds;
  for (const unknownRight of [false, true]) {
    const fixture = competition(ids.lowHead, ids.highHead);
    fixture.leftStart.commit.author = null;
    fixture.leftStart.commit.committer = { date: 'not-a-date' };
    if (unknownRight) {
      fixture.rightStart.commit.author = { name: 'Author', date: 'invalid-author-date' };
      fixture.rightStart.commit.committer = null;
    }
    const expected = unknownRight ? ids.lowHead : ids.highHead;
    for (const values of [fixture.commits, [...fixture.commits].reverse()]) {
      assert.equal(graph(values, fixture.references).colors.paths.nodes.get(ids.fork), expected);
    }
  }
});

test('post-fork age uses committer dates first and valid author dates as a fallback', () => {
  const ids = competitionIds;
  const fixture = competition(ids.lowHead, ids.highHead, 40, 60);
  fixture.leftStart.commit.committer = {
    date: new Date(Date.UTC(2026, 10, 5, 0, 90)).toISOString(),
  };
  const committerWins = graph(fixture.commits, fixture.references);
  assert.equal(committerWins.colors.paths.nodes.get(ids.fork), ids.highHead);
  fixture.leftStart.commit.committer = { date: 'invalid-committer-date' };
  const authorFallback = graph(fixture.commits, fixture.references);
  assert.equal(authorFallback.colors.paths.nodes.get(ids.fork), ids.lowHead);
});
