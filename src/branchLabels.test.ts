import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchTracks,
  branchLabelContentBottom,
  visibleBranchLabels,
  type BranchTrack,
  type BranchLabel,
  type BranchLabelObstacle,
} from './branchLabels';
import { layout, type Commit } from './model';
import { graphColors } from './graphColors';
const commit = (sha: string, parent?: string): Commit => ({
  sha,
  parents: parent ? [{ sha: parent }] : [],
  commit: { message: sha, author: null, committer: null },
  html_url: '',
});
test('a blocked short branch badge stays near its path instead of moving onto older commits', () => {
  for (const reverse of [false, true]) {
    const point = (x: number, y: number) => ({ x, y: reverse ? 340 - y : y });
    const tracks: BranchTrack[] = [
      {
        name: 'main',
        lane: 0,
        points: [point(48, 127), point(48, 220)],
      },
      {
        name: 'dev',
        lane: 1,
        points: [65, 96, 158, 189, 251].map((y) => point(65.4, y)),
      },
      {
        name: 'feat/compact-action-rows',
        lane: 1,
        points: [point(65.4, 34), point(65.4, 65)],
      },
    ];
    const obstacles = [
      point(65.4, 34),
      point(65.4, 65),
      point(65.4, 96),
      point(48, 127),
      point(65.4, 158),
      point(65.4, 189),
      point(48, 220),
      point(65.4, 251),
    ].map((p) => ({ ...p, radius: 12 }));
    const labels = visibleBranchLabels(
      tracks,
      14,
      340,
      0,
      173,
      (names) => (names[0] === 'main' ? 36 : names[0] === 'dev' ? 29 : 86),
      18,
      2,
      obstacles,
    );
    const label = labels.find((entry) => entry.names.includes('feat/compact-action-rows'))!;
    assert.ok(label);
    assert.ok(label.boxY! + 9 >= Math.min(...tracks[2].points.map((p) => p.y)) - 31);
    assert.ok(label.boxY! + 9 <= Math.max(...tracks[2].points.map((p) => p.y)) + 31);
  }
});
function clearOfNodes(label: BranchLabel, width: number, nodes: BranchLabelObstacle[]) {
  for (const node of nodes)
    assert.ok(
      label.boxX! + width <= node.x - node.radius - 3 ||
        label.boxX! >= node.x + node.radius + 3 ||
        label.boxY! + label.boxHeight! <= node.y - node.radius - 3 ||
        label.boxY! >= node.y + node.radius + 3,
      `${label.names} obscures the node at ${node.x},${node.y}`,
    );
}
function clearOfLabels(labels: BranchLabel[], width: (label: BranchLabel) => number) {
  for (let i = 0; i < labels.length; i++) {
    for (const other of labels.slice(i + 1)) {
      const label = labels[i];
      assert.ok(
        label.boxX! + width(label) <= other.boxX! ||
          other.boxX! + width(other) <= label.boxX! ||
          label.boxY! + label.boxHeight! <= other.boxY! ||
          other.boxY! + other.boxHeight! <= label.boxY!,
        `${label.names} overlaps ${other.names}`,
      );
    }
  }
}
test('a short merge connector and a long merge-head name both fit without overlapping labels or nodes', () => {
  const tracks: BranchTrack[] = [
    {
      name: 'main',
      lane: 0,
      points: [
        { x: 48, y: 141 },
        { x: 48, y: 234 },
      ],
    },
    {
      name: 'ko',
      lane: 1,
      points: [
        { x: 82, y: 172 },
        { x: 82, y: 234 },
      ],
      connections: [
        [
          { x: 82, y: 110 },
          { x: 82, y: 172 },
        ],
      ],
    },
    {
      name: 'sync/main-stable-ko-20261103',
      lane: 1,
      points: [
        { x: 82, y: 110 },
        { x: 48, y: 141 },
      ],
    },
  ];
  const widths = new Map([
    ['main', 34],
    ['ko', 22],
    ['sync/main-stable-ko-20261103', 106],
  ]);
  const nodes = [
    { x: 82, y: 110, radius: 12 },
    { x: 48, y: 141, radius: 12 },
    { x: 82, y: 172, radius: 12 },
  ];
  const measure = (names: string[]) => widths.get(names[0])!;
  const labels = visibleBranchLabels(tracks, 90, 500, 0, 212, measure, 18, 2, nodes);
  assert.deepEqual(
    new Set(labels.flatMap((label) => label.names)),
    new Set(tracks.map((track) => track.name)),
  );
  assert.deepEqual(labels[0].names, ['main']);
  clearOfLabels(labels, (label) => measure(label.names));
  for (const label of labels) clearOfNodes(label, measure(label.names), nodes);
  assert.equal(
    labels.find((label) => label.names.includes('sync/main-stable-ko-20261103'))!.y,
    110,
  );
});
test('a cramped viewport uses an existing badge edge before accepting label overlap', () => {
  const tracks = [
    { name: 'main', lane: 0, points: [{ x: 48, y: 200 }] },
    { name: 'side', lane: 1, points: [{ x: 52, y: 210 }] },
  ];
  const measure = (names: string[]) => (names[0] === 'main' ? 90 : 30);
  const labels = visibleBranchLabels(tracks, 184, 223, 0, 390, measure, 20);
  const side = labels.find((label) => label.names.includes('side'))!;
  assert.ok(Math.abs(side.boxY! - 200) <= 31);
  assert.ok(side.boxX! >= labels[0].boxX! + 90 + 4);
  clearOfLabels(labels, (label) => measure(label.names));
});
test('unavoidable node overlap does not force three separate branch names on top of each other', () => {
  const tracks = ['main', 'side', 'other'].map((name, index) => ({
    name,
    lane: index,
    points: [{ x: 48 + index * 34, y: 200 }],
  }));
  const labels = visibleBranchLabels(tracks, 100, 400, 0, 180, () => 80, 18, 2, [
    { x: 48, y: 200, radius: 120 },
  ]);
  assert.equal(labels.length, 3);
  clearOfLabels(labels, () => 80);
  assert.ok(labels.every((label) => Math.abs(label.boxY! - 191) <= 31));
});
test('branch labels follow visible paths after heads leave the viewport and disappear after the path ends', () => {
  const tracks: BranchTrack[] = [
    {
      name: 'main',
      lane: 0,
      points: [
        { x: 48, y: 100 },
        { x: 48, y: 500 },
        { x: 48, y: 1000 },
      ],
    },
  ];
  assert.equal(visibleBranchLabels(tracks, 250, 600)[0].names[0], 'main');
  assert.equal(visibleBranchLabels(tracks, 250, 600)[0].y, 250);
  assert.deepEqual(visibleBranchLabels(tracks, 1100, 1500), []);
  assert.deepEqual(visibleBranchLabels(tracks, -500, 0), []);
});
test('a side branch ends at its first-parent join with the base instead of naming the shared trunk', () => {
  const commits = [
    commit('m', 'root'),
    commit('f', 'join'),
    commit('join', 'root'),
    commit('root'),
  ];
  const positions = new Map([
    ['m', { x: 48, y: 100 }],
    ['f', { x: 82, y: 150 }],
    ['join', { x: 82, y: 300 }],
    ['root', { x: 48, y: 500 }],
  ]);
  const tracks = branchTracks(
    commits,
    [
      { name: 'main', commit: { sha: 'm' } },
      { name: 'feature', commit: { sha: 'f' } },
    ],
    'main',
    new Set(['m', 'root']),
    positions,
    false,
  );
  assert.deepEqual(
    tracks.find((t) => t.name === 'feature')!.points.map((p) => p.y),
    [150, 300, 500],
  );
  assert.ok(visibleBranchLabels(tracks, 200, 400).some((l) => l.names.includes('feature')));
  assert.ok(!visibleBranchLabels(tracks, 501, 800).some((l) => l.names.includes('feature')));
});
test('reversed tracks and curved joins place labels beside the actual visible line', () => {
  const track: BranchTrack = {
    name: 'feature',
    lane: 1,
    points: [
      { x: 82, y: 500 },
      { x: 48, y: 100 },
    ],
  };
  const label = visibleBranchLabels([track], 200, 300)[0];
  assert.ok(label.x > 48 && label.x < 82);
  assert.ok(label.y >= 200 && label.y <= 300);
  assert.deepEqual(visibleBranchLabels([track], 501, 800), []);
});
test('unloaded heads have no labels and references at the same head share a full vertical stack', () => {
  const tracks = branchTracks(
    [commit('root')],
    [
      { name: 'main', commit: { sha: 'root' } },
      { name: 'release', commit: { sha: 'root' } },
      { name: 'unloaded', commit: { sha: 'missing' } },
    ],
    'main',
    new Set(['root']),
    new Map([['root', { x: 48, y: 200 }]]),
    false,
  );
  const labels = visibleBranchLabels(tracks, 100, 300);
  assert.equal(labels.length, 1);
  assert.deepEqual(labels[0].names, ['main', 'release']);
  assert.equal(labels[0].boxHeight, 46);
});
test('shared heads keep the selected branch first and include every other name in stable order', () => {
  const refs = ['release', 'zebra', 'dev', 'main'].map((name) => ({
    name,
    commit: { sha: 'root' },
  }));
  for (const branches of [refs, [...refs].reverse()]) {
    const tracks = branchTracks(
      [commit('root')],
      branches,
      'dev',
      new Set(['root']),
      new Map([['root', { x: 48, y: 200 }]]),
      false,
    );
    const labels = visibleBranchLabels(tracks, 100, 400, 0, 390, () => 90, 20);
    assert.equal(labels.length, 1);
    assert.deepEqual(labels[0].names, ['dev', 'main', 'release', 'zebra']);
    assert.equal(labels[0].boxHeight, 86);
  }
});
test('the whole shared-head stack avoids neighboring badges, including short one-commit paths', () => {
  const tracks: BranchTrack[] = [
    { name: 'main', lane: 0, points: [{ x: 48, y: 200 }] },
    { name: 'dev', lane: 0, points: [{ x: 48, y: 200 }] },
    { name: 'feature', lane: 1, points: [{ x: 55, y: 220 }] },
  ];
  const labels = visibleBranchLabels(tracks, 100, 400, 0, 390, () => 90, 20);
  assert.equal(labels.length, 2);
  assert.deepEqual(labels[0].names, ['main', 'dev']);
  const [first, second] = labels;
  assert.ok(
    first.boxY! + first.boxHeight! + 2 <= second.boxY! ||
      second.boxY! + second.boxHeight! + 2 <= first.boxY!,
  );
});
test('badges use available space beside the anchor instead of covering the commit node', () => {
  for (const [x, right, expectedX] of [
    [48, 118, 60],
    [180, 220, 120],
  ]) {
    const tracks = [
      { name: 'main', lane: 0, points: [{ x, y: 200 }] },
      { name: 'dev', lane: 0, points: [{ x, y: 200 }] },
    ];
    const [label] = visibleBranchLabels(
      tracks,
      100,
      400,
      0,
      right,
      (_names, point) => {
        assert.equal(point.x, x);
        return 48;
      },
      18,
    );
    assert.equal(label.boxX, expectedX);
    assert.ok(label.boxX! > x + 10.5 || label.boxX! + 48 < x - 10.5);
  }
});
test('a badge moves right at the same height to reveal a neighboring node and Actions ring', () => {
  const track: BranchTrack = { name: 'main', lane: 0, points: [{ x: 48, y: 200 }] };
  const nodes = [
    { x: 48, y: 200, radius: 12 },
    { x: 82, y: 200, radius: 12 },
  ];
  const [label] = visibleBranchLabels([track], 100, 400, 0, 390, () => 80, 20, 2, nodes);
  assert.equal(label.x, 48);
  assert.equal(label.y, 200);
  assert.equal(label.boxY, 190);
  assert.equal(label.boxX, 97);
  clearOfNodes(label, 80, nodes);
});
test('near the right edge a badge uses clear space on the left without covering adjacent rings', () => {
  const nodes = [
    { x: 180, y: 200, radius: 12 },
    { x: 140, y: 200, radius: 12 },
  ];
  const [label] = visibleBranchLabels(
    [{ name: 'main', lane: 0, points: [{ x: 180, y: 200 }] }],
    100,
    400,
    0,
    220,
    () => 48,
    20,
    2,
    nodes,
  );
  assert.equal(label.boxX, 77);
  assert.equal(label.boxY, 190);
  clearOfNodes(label, 48, nodes);
});
test('a right-side badge stays on the right when a clear gap is available there', () => {
  const nodes = [
    { x: 300, y: 200, radius: 12 },
    { x: 426, y: 200, radius: 12 },
  ];
  const [label] = visibleBranchLabels(
    [{ name: 'main', lane: 0, points: [{ x: 300, y: 200 }] }],
    100,
    400,
    0,
    600,
    () => 100,
    20,
    2,
    nodes,
  );
  assert.equal(label.boxX, 441);
  assert.equal(label.boxY, 190);
  clearOfNodes(label, 100, nodes);
});
test('every row in a shared-head stack avoids nodes beside its lower branch names', () => {
  const tracks = ['main', 'dev', 'release'].map((name) => ({
    name,
    lane: 0,
    points: [{ x: 48, y: 200 }],
  }));
  const nodes = [
    { x: 48, y: 200, radius: 12 },
    { x: 82, y: 222, radius: 12 },
    { x: 116, y: 244, radius: 12 },
  ];
  const [label] = visibleBranchLabels(tracks, 100, 400, 0, 400, () => 100, 20, 2, nodes);
  assert.deepEqual(label.names, ['main', 'dev', 'release']);
  assert.equal(label.boxX, 131);
  assert.equal(label.boxY, 190);
  clearOfNodes(label, 100, nodes);
});
test('a short path moves vertically if neither side has space beside its nodes', () => {
  const nodes = [
    { x: 48, y: 200, radius: 12 },
    { x: 82, y: 200, radius: 12 },
  ];
  const [label] = visibleBranchLabels(
    [{ name: 'main', lane: 0, points: [{ x: 48, y: 200 }] }],
    100,
    400,
    0,
    110,
    () => 60,
    20,
    2,
    nodes,
  );
  assert.ok(label.boxX! >= 8 && label.boxX! + 60 <= 102);
  assert.notEqual(label.boxY, 190);
  clearOfNodes(label, 60, nodes);
});
test('nodes outside a badge height do not push it away from its branch', () => {
  const track: BranchTrack = { name: 'main', lane: 0, points: [{ x: 48, y: 200 }] };
  const nodes = [{ x: 48, y: 200, radius: 12 }];
  const baseline = visibleBranchLabels([track], 100, 500, 0, 390, () => 80, 20, 2, nodes);
  assert.deepEqual(
    visibleBranchLabels([track], 100, 500, 0, 390, () => 80, 20, 2, [
      ...nodes,
      { x: 82, y: 400, radius: 12 },
    ]),
    baseline,
  );
});
test('scrolled reversed paths keep their badges clear of visible commit rings', () => {
  const track: BranchTrack = {
    name: 'feature',
    lane: 1,
    points: [
      { x: 116, y: 800 },
      { x: 48, y: 100 },
    ],
  };
  const nodes = [
    { x: 48, y: 300, radius: 12 },
    { x: 82, y: 331, radius: 12 },
    { x: 116, y: 362, radius: 12 },
  ];
  const [label] = visibleBranchLabels([track], 300, 500, 0, 390, () => 90, 18, 2, nodes);
  assert.equal(label.names[0], 'feature');
  assert.ok(label.boxY! >= 306 && label.boxY! + 18 <= 500);
  clearOfNodes(label, 90, nodes);
});
test('oversized stacks retain every name while moving aside for nodes along the stack', () => {
  const tracks = Array.from({ length: 30 }, (_, index) => ({
    name: `branch-${index}`,
    lane: 0,
    points: [{ x: 48, y: 100 }],
  }));
  const nodes = [
    { x: 48, y: 100, radius: 12 },
    { x: 82, y: 131, radius: 12 },
    { x: 116, y: 162, radius: 12 },
  ];
  const [label] = visibleBranchLabels(tracks, 80, 280, 0, 390, () => 90, 18, 2, nodes);
  assert.equal(label.names.length, 30);
  assert.equal(label.boxY, 91);
  assert.equal(label.boxX, 131);
  clearOfNodes(label, 90, nodes);
});
test('crowded viewports retain branch names even when every available position overlaps a node', () => {
  const tracks: BranchTrack[] = [{ name: 'main', lane: 0, points: [{ x: 48, y: 200 }] }];
  const [label] = visibleBranchLabels(tracks, 180, 222, 0, 100, () => 80, 18, 2, [
    { x: 48, y: 200, radius: 40 },
  ]);
  assert.deepEqual(label.names, ['main']);
  assert.ok(label.boxX! >= 8 && label.boxX! + 80 <= 92);
});
test('a stack near the bottom moves above the edge without omitting or reversing names', () => {
  const tracks = ['main', 'dev', 'release'].map((name) => ({
    name,
    lane: 0,
    points: [{ x: 48, y: 295 }],
  }));
  const [label] = visibleBranchLabels(tracks, 100, 300, 0, 390, () => 90, 18);
  assert.deepEqual(label.names, ['main', 'dev', 'release']);
  assert.equal(label.boxHeight, 58);
  assert.ok(label.boxY! >= 100 && label.boxY! + label.boxHeight! <= 300);
});
test('different heads sharing a visible trunk retain separate names instead of becoming a count', () => {
  const tracks: BranchTrack[] = [
    {
      name: 'main',
      lane: 0,
      points: [
        { x: 48, y: 0 },
        { x: 48, y: 1000 },
      ],
    },
    {
      name: 'dev',
      lane: 0,
      points: [
        { x: 48, y: 50 },
        { x: 48, y: 1000 },
      ],
    },
  ];
  const labels = visibleBranchLabels(tracks, 200, 400, 0, 390, () => 90, 18);
  assert.equal(labels.length, 2);
  assert.deepEqual(
    labels.map((label) => label.names),
    [['main'], ['dev']],
  );
  assert.ok(labels[0].boxY! + 20 <= labels[1].boxY!);
});
test('oversized shared-head stacks stay fixed while scrolling and reserve enough content for every name', () => {
  const tracks = Array.from({ length: 30 }, (_, index) => ({
    name: `branch-${index}`,
    lane: 0,
    points: [{ x: 48, y: 100 }],
  }));
  const first = visibleBranchLabels(tracks, 80, 280, 0, 390, () => 90, 18)[0],
    scrolled = visibleBranchLabels(tracks, 400, 600, 0, 390, () => 90, 18)[0];
  assert.equal(first.names.length, 30);
  assert.deepEqual(scrolled.names, first.names);
  assert.equal(first.boxY, 91);
  assert.equal(scrolled.boxY, first.boxY);
  assert.equal(first.boxHeight, 598);
  assert.equal(branchLabelContentBottom(tracks, 18), 689);
  assert.deepEqual(
    visibleBranchLabels(tracks, 700, 900, 0, 390, () => 90, 18),
    [],
  );
  assert.equal(branchLabelContentBottom([], 18), 0);
});

test('a branch outside the horizontal viewport does not leave a stray name behind', () => {
  const tracks: BranchTrack[] = [
    {
      name: 'main',
      lane: 0,
      points: [
        { x: 48, y: 100 },
        { x: 48, y: 900 },
      ],
    },
  ];
  assert.equal(visibleBranchLabels(tracks, 200, 600, 0, 390).length, 1);
  assert.equal(visibleBranchLabels(tracks, 200, 600, 100, 490).length, 0);
});

test('labels use a visible curve segment even when their former preferred anchor is horizontally outside', () => {
  const track: BranchTrack = {
    name: 'crossing',
    lane: 0,
    points: [
      { x: 0, y: 0 },
      { x: 500, y: 1000 },
    ],
  };
  const labels = visibleBranchLabels([track], 100, 900, 200, 300);
  assert.equal(labels.length, 1);
  assert.ok(labels[0].x >= 200 && labels[0].x <= 300);
  assert.ok(labels[0].y >= 100 && labels[0].y <= 900);
});
test('merge connectors remain labeled when the branch head is below the viewport', () => {
  const track: BranchTrack = {
    name: 'feature',
    lane: 1,
    points: [
      { x: 82, y: 700 },
      { x: 48, y: 1000 },
    ],
    connections: [
      [
        { x: 48, y: 0 },
        { x: 82, y: 700 },
      ],
    ],
  };
  const labels = visibleBranchLabels([track], 100, 300, 0, 390);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].names[0], 'feature');
});
test('a reference on the base keeps its name on visible shared history after its head scrolls out', () => {
  const commits = [commit('dev', 'main'), commit('main', 'root'), commit('root')];
  const positions = new Map([
    ['dev', { x: 48, y: 100 }],
    ['main', { x: 48, y: 300 }],
    ['root', { x: 48, y: 900 }],
  ]);
  const tracks = branchTracks(
    commits,
    [
      { name: 'dev', commit: { sha: 'dev' } },
      { name: 'main', commit: { sha: 'main' } },
    ],
    'dev',
    new Set(['dev', 'main', 'root']),
    positions,
    false,
  );
  const names = visibleBranchLabels(tracks, 500, 700).flatMap((l) => l.names);
  assert.ok(names.includes('main'));
  assert.ok(names.includes('dev'));
});

test('nearby merge and trunk badges move along their paths to stay readable', () => {
  const tracks: BranchTrack[] = [
    {
      name: 'main',
      lane: 0,
      points: [
        { x: 48, y: 136 },
        { x: 48, y: 1000 },
      ],
    },
    {
      name: 'feature',
      lane: 1,
      points: [
        { x: 82, y: 700 },
        { x: 48, y: 1000 },
      ],
      connections: [
        [
          { x: 48, y: 136 },
          { x: 82, y: 700 },
        ],
      ],
    },
  ];
  const labels = visibleBranchLabels(tracks, 115, 600, 0, 390, () => 80);
  assert.equal(labels.length, 2);
  assert.ok(Math.abs(labels[0].boxY! - labels[1].boxY!) >= 24);
});
test('compressed drawing coordinates retain the real lane identity and compact badge bounds', () => {
  const commits = [commit('main'), commit('side')],
    positions = new Map([
      ['main', { x: 48, y: 100 }],
      ['side', { x: 58, y: 150 }],
    ]);
  const tracks = branchTracks(
    commits,
    [
      { name: 'main', commit: { sha: 'main' } },
      { name: 'side', commit: { sha: 'side' } },
    ],
    'main',
    new Set(['main']),
    positions,
    false,
    undefined,
    new Map([
      ['main', 0],
      ['side', 20],
    ]),
  );
  assert.equal(tracks.find((track) => track.name === 'side')!.lane, 20);
  const dense = Array.from({ length: 10 }, (_, index) => ({
    name: `branch-${index}`,
    lane: index,
    points: [
      { x: 48 + index * 3, y: 0 },
      { x: 48 + index * 3, y: 900 },
    ],
  }));
  const labels = visibleBranchLabels(dense, 100, 500, 0, 320, () => 90, 18);
  assert.equal(labels.length, 10);
  assert.ok(
    labels.every(
      (label) =>
        label.boxX! >= 8 &&
        label.boxX! + 90 <= 312 &&
        label.boxY! >= 100 &&
        label.boxY! + 18 <= 500,
    ),
  );
});

test('identical colors cannot extend a badge path beyond a non-base fork or collect its merge connectors', () => {
  const merge = (sha: string, first: string, incoming: string): Commit => ({
    ...commit(sha, first),
    parents: [{ sha: first }, { sha: incoming }],
  });
  const commits = [
    merge('main-merge', 'main-base', 'dev-tip'),
    merge('dev-tip', 'dev-base', 'feature'),
    merge('other-merge', 'other-base', 'dev-base'),
    commit('feature', 'dev-base'),
    commit('dev-base', 'root'),
    commit('other-base', 'root'),
    commit('main-base', 'root'),
    commit('root', 'older'),
    commit('older'),
  ];
  const branches = [
    { name: 'main', commit: { sha: 'main-merge' } },
    { name: 'dev', commit: { sha: 'dev-tip' } },
    { name: 'feature', commit: { sha: 'feature' } },
  ];
  const data = layout(commits, new Map(), 'main-merge');
  const colors = graphColors(commits, branches, 'main');
  for (const map of [colors.nodes, colors.edges, colors.branches])
    for (const id of map.keys()) map.set(id, 0);
  assert.notEqual(colors.paths.nodes.get('feature'), colors.paths.nodes.get('dev-base'));
  assert.equal(data.spine.has('dev-base'), false);

  for (const reverse of [false, true]) {
    const positions = new Map(
      data.ordered.map((c, index) => [
        c.sha,
        { x: 48 + data.lanes.get(c.sha)! * 34, y: (reverse ? commits.length - index : index) * 31 },
      ]),
    );
    const feature = branchTracks(
      commits,
      branches,
      'main',
      data.spine,
      positions,
      reverse,
      colors,
      data.lanes,
    ).find((track) => track.name === 'feature')!;
    assert.deepEqual(feature.points, [positions.get('feature'), positions.get('dev-base')]);
    assert.equal(feature.headSha, 'feature');
    assert.deepEqual(feature.connections, [[positions.get('dev-tip'), positions.get('feature')]]);
  }
});
