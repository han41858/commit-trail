import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  graphFrame,
  branchDisplayNames,
  branchLabelText,
  commitVersionIcons,
  visibleHistorySources,
  visibleGraphEdges,
  GRAPH_ORIGIN,
} from './graphView';
import type { CommitInfo, TagInfo, ReleaseInfo } from './CommitInfo';
import { layout, type Commit } from './model';

const edgeCommit = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents: parents.map((sha) => ({ sha })),
  commit: { message: sha, author: null, committer: null },
  html_url: '',
});

test('visible edge geometry preserves first-parent spines and secondary merge curves', () => {
  const positions = new Map([
    ['merge', { x: 48, y: 20 }],
    ['base', { x: 48, y: 82 }],
    ['work', { x: 82, y: 51 }],
  ]);
  const edges = visibleGraphEdges(
    [edgeCommit('merge', 'base', 'work')],
    positions,
    new Set(['merge']),
    48,
    false,
    0,
    200,
  );
  assert.deepEqual(edges, [
    {
      id: 'merge:base',
      from: positions.get('merge'),
      to: positions.get('base'),
      primary: true,
      dashed: false,
    },
    {
      id: 'merge:work',
      from: positions.get('merge'),
      to: positions.get('work'),
      primary: false,
      dashed: false,
    },
  ]);
});

test('edge visibility includes crossing segments with both endpoints outside the viewport', () => {
  const positions = new Map([
    ['above', { x: 48, y: 0 }],
    ['above-parent', { x: 48, y: 50 }],
    ['crossing', { x: 82, y: 40 }],
    ['far-parent', { x: 116, y: 600 }],
    ['below', { x: 48, y: 700 }],
  ]);
  const commits = [
    edgeCommit('above', 'above-parent'),
    edgeCommit('crossing', 'far-parent'),
    edgeCommit('below', 'far-parent'),
  ];
  const edges = visibleGraphEdges(
    commits,
    positions,
    new Set(),
    48,
    false,
    200,
    400,
  );
  assert.deepEqual(
    edges.map((edge) => edge.id),
    ['crossing:far-parent'],
  );
});

test('unloaded parents keep the same half-row dashed stub in both directions', () => {
  const positions = new Map([['tip', { x: 82, y: 100 }]]);
  for (const reverse of [false, true]) {
    const edges = visibleGraphEdges(
      [edgeCommit('tip', 'missing', 'other')],
      positions,
      new Set(['tip']),
      48,
      reverse,
      0,
      200,
    );
    assert.deepEqual(
      edges.map((edge) => edge.to),
      [
        { x: 48, y: 100 + (reverse ? -15.5 : 15.5) },
        { x: 82, y: 100 + (reverse ? -15.5 : 15.5) },
      ],
    );
    assert.ok(edges.every((edge) => edge.dashed));
  }
});

test('edges without a source position are ignored rather than inferred from geometry', () => {
  assert.deepEqual(
    visibleGraphEdges(
      [edgeCommit('missing', 'parent')],
      new Map(),
      new Set(),
      48,
      false,
      0,
      200,
    ),
    [],
  );
});

test('commits show at most one version icon, preferring releases and preserving tooltip names and position', () => {
  const tag = (name: string): TagInfo => ({
    name,
    sha: 'a',
    url: `https://github.com/a/b/tree/${name}`,
  });
  const release = (
    id: number,
    name: string | null,
    tag_name: string,
  ): ReleaseInfo => ({
    id,
    name,
    tag_name,
    draft: false,
    prerelease: false,
    published_at: null,
    created_at: '2026-11-02T00:00:00Z',
    html_url: `https://github.com/a/b/releases/tag/${tag_name}`,
  });
  const tags = [tag('v1'), tag('alias')],
    releases = [release(1, 'Version 1', 'v1'), release(2, null, 'alias')];
  const cases: {
    name: string;
    tags: TagInfo[];
    releases: ReleaseInfo[];
    text?: string;
    title?: string;
  }[] = [
    { name: 'no versions', tags: [], releases: [] },
    {
      name: 'one tag',
      tags: tags.slice(0, 1),
      releases: [],
      text: '🏷️',
      title: 'v1',
    },
    {
      name: 'release only',
      tags: [],
      releases: releases.slice(0, 1),
      text: '🚀',
      title: 'Version 1',
    },
    {
      name: 'tag and release',
      tags: tags.slice(0, 1),
      releases: releases.slice(0, 1),
      text: '🚀',
      title: 'Version 1',
    },
    {
      name: 'multiple tags only',
      tags,
      releases: [],
      text: '🏷️',
      title: 'v1 · alias',
    },
    {
      name: 'release with an additional tag',
      tags,
      releases: releases.slice(0, 1),
      text: '🚀',
      title: 'Version 1',
    },
    {
      name: 'multiple tags and releases',
      tags,
      releases,
      text: '🚀',
      title: 'Version 1 · alias',
    },
  ];
  assert.deepEqual(commitVersionIcons(undefined, 48), []);
  for (const { name, tags, releases, text, title } of cases) {
    const info: CommitInfo = { tags, releases, runs: [], actions: null },
      before = JSON.stringify(info);
    for (const x of [48, 82, 150])
      assert.deepEqual(
        commitVersionIcons(info, x),
        text ? [{ text, x: x - 20, title }] : [],
        name,
      );
    assert.equal(
      JSON.stringify(info),
      before,
      `${name}: keep all detail metadata`,
    );
  }
});

test('history requests include earlier gaps but exclude below-viewport, outside lanes and pending work', () => {
  const positions = new Map([
    ['visible', { x: 48, y: 1200 }],
    ['above', { x: 48, y: 99 }],
    ['below', { x: 48, y: 1601 }],
    ['left', { x: -1, y: 1200 }],
    ['right', { x: 391, y: 1200 }],
  ]);
  const frontiers = [
    { sha: 'visible', sources: ['same', 'pending', 'second', 'same'] },
    ...['above', 'below', 'left', 'right', 'missing'].map((sha) => ({
      sha,
      sources: [sha],
    })),
  ];
  const view = { left: 0, top: 1000, width: 390, height: 600, inset: 100 };
  assert.deepEqual(
    visibleHistorySources(frontiers, positions, view, ['pending']),
    ['same', 'second', 'above'],
  );
  assert.deepEqual(
    visibleHistorySources(frontiers, positions, { ...view, width: 0 }),
    [],
  );
  assert.deepEqual(
    visibleHistorySources(frontiers, positions, { ...view, height: 50 }),
    [],
  );
});
test('successor boundaries are rechecked above the viewport and stop once they move below it', () => {
  const view = { left: 0, top: 3000, width: 390, height: 796, inset: 80 },
    frontiers = [{ sha: 'gap', sources: ['next'] }];
  for (const y of [100, 1960, 3000, 3796])
    assert.deepEqual(
      visibleHistorySources(frontiers, new Map([['gap', { x: 48, y }]]), view),
      ['next'],
    );
  assert.deepEqual(
    visibleHistorySources(
      frontiers,
      new Map([['gap', { x: 48, y: 3797 }]]),
      view,
    ),
    [],
  );
});
test('large End and Home jumps select the current prefix without remembering a previous viewport', () => {
  const positions = new Map([
    ['early', { x: 48, y: 100 }],
    ['middle', { x: 48, y: 1960 }],
    ['late', { x: 48, y: 4409 }],
    ['future', { x: 48, y: 6400 }],
  ]);
  const frontiers = [...positions.keys()].map((sha) => ({
      sha,
      sources: [sha],
    })),
    view = { left: 0, top: 0, width: 390, height: 796, inset: 80 };
  assert.deepEqual(
    visibleHistorySources(frontiers, positions, { ...view, top: 5500 }),
    ['early', 'middle', 'late'],
  );
  assert.deepEqual(
    visibleHistorySources(frontiers, positions, { ...view, top: 2500 }),
    ['early', 'middle'],
  );
  assert.deepEqual(visibleHistorySources(frontiers, positions, view), [
    'early',
  ]);
});
test('layout insertion admits only newly required ancestry before the current viewport bottom', () => {
  const view = { left: 0, top: 1000, width: 390, height: 600, inset: 100 },
    frontiers = [{ sha: 'gap', sources: ['next'] }];
  assert.deepEqual(
    visibleHistorySources(
      frontiers,
      new Map([['gap', { x: 48, y: 1200 }]]),
      view,
    ),
    ['next'],
  );
  assert.deepEqual(
    visibleHistorySources(
      frontiers,
      new Map([['gap', { x: 48, y: 4600 }]]),
      view,
    ),
    [],
  );
  assert.deepEqual(
    visibleHistorySources(
      frontiers,
      new Map([['gap', { x: 48, y: 900 }]]),
      view,
    ),
    ['next'],
  );
});

test('narrow frames reserve half the width only while message columns preserve 12px lane spacing', () => {
  for (const width of [280, 320, 390, 430, 800])
    for (const maxLane of [0, 1, 8, 40, 500]) {
      const frame = graphFrame(width, maxLane, true);
      assert.equal(frame.width, width);
      assert.ok(frame.spacing > 0 && frame.spacing <= 34);
      assert.ok(
        GRAPH_ORIGIN + maxLane * frame.spacing <= frame.branchWidth - 18 + 1e-9,
      );
      if (frame.showMessages) {
        assert.ok(frame.branchWidth <= width / 2);
        assert.ok(frame.spacing >= 12);
        assert.ok(frame.messageX > frame.branchWidth);
        assert.ok(
          frame.messageWidth >= width * 0.4 && frame.messageWidth <= width / 2,
        );
        assert.ok(frame.messageX + frame.messageWidth <= width - 12);
      } else {
        assert.equal(frame.branchWidth, width);
        assert.equal(frame.messageWidth, 0);
        assert.equal(frame.messageX, width);
      }
    }
  // Exceptionally dense graphs still fit the viewport after using all available width.
  assert.ok(graphFrame(320, 500, true).spacing < 1);
});
test('320px, 390px and 430px narrow screens switch messages off before lanes become too close', () => {
  for (const [width, lastVisibleLane] of [
    [320, 7],
    [390, 10],
    [430, 12],
  ]) {
    for (let maxLane = 0; maxLane <= lastVisibleLane; maxLane++) {
      const frame = graphFrame(width, maxLane, true);
      assert.equal(frame.showMessages, true);
      assert.ok(frame.spacing >= 12);
    }
    for (const maxLane of [lastVisibleLane + 1, lastVisibleLane + 2, 20]) {
      const frame = graphFrame(width, maxLane, true);
      assert.equal(frame.showMessages, false);
      assert.equal(frame.branchWidth, width);
      assert.ok(frame.spacing >= 12);
      const oldSpacing = (width / 2 - GRAPH_ORIGIN - 18) / maxLane;
      assert.ok(frame.spacing > oldSpacing);
    }
  }
});
test('message visibility changes in both resize directions and accepts exactly 12px spacing', () => {
  assert.equal(graphFrame(395.99, 11, true).showMessages, false);
  const exact = graphFrame(396, 11, true);
  assert.equal(exact.showMessages, true);
  assert.equal(exact.spacing, 12);
  assert.deepEqual(
    [320, 390, 430, 320].map(
      (width) => graphFrame(width, 10, true).showMessages,
    ),
    [false, true, true, false],
  );
});
test('narrow message switching preserves a merge DAG and keeps adjacent node columns separated', () => {
  for (const maxLane of [1, 7, 8, 10, 11, 12, 13, 20]) {
    const commit = (sha: string, parents: string[], day: number): Commit => ({
      sha,
      parents: parents.map((sha) => ({ sha })),
      commit: {
        message: sha,
        author: {
          name: 'Test',
          date: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`,
        },
        committer: null,
      },
      html_url: '',
    });
    const sides = Array.from({ length: maxLane }, (_, i) =>
      commit(`side-${i}`, ['root'], 30 - i),
    );
    const merge = commit('merge', ['root', ...sides.map((c) => c.sha)], 31),
      commits = [merge, ...sides, commit('root', [], 1)],
      before = JSON.stringify(commits);
    const dag = layout(commits, new Map(), 'merge'),
      lanes = [...dag.lanes.values()],
      actualMax = Math.max(...lanes);
    assert.equal(actualMax, maxLane);
    for (const width of [320, 390, 430]) {
      const frame = graphFrame(width, actualMax, true),
        columns = [...new Set(lanes)]
          .sort((a, b) => a - b)
          .map((lane) => GRAPH_ORIGIN + lane * frame.spacing);
      for (let i = 1; i < columns.length; i++)
        assert.ok(
          columns[i] - columns[i - 1] >= 12 - 1e-9,
          '12px lane spacing leaves space between 9px nodes',
        );
      assert.ok(columns.at(-1)! <= frame.branchWidth - 18 + 1e-9);
    }
    assert.equal(JSON.stringify(commits), before);
    assert.deepEqual([...dag.spine], ['merge', 'root']);
  }
});
test('sparse narrow and wide graphs retain their usual spacing', () => {
  assert.equal(graphFrame(390, 3, true).spacing, 34);
  assert.equal(graphFrame(1440, 2, false).spacing, 34);
});
test('split-column widths follow the same responsive message and lane-spacing policy as a single graph', () => {
  const cases: [number, number, boolean][] = [
    [79, 1, false],
    [97, 1, false],
    [107, 1, false],
    [195, 2, true],
    [195, 3, false],
    [320, 7, true],
    [320, 8, false],
    [390, 10, true],
    [390, 11, false],
    [430, 12, true],
    [430, 13, false],
    [800, 27, true],
    [800, 28, false],
    [801, 100, true],
    [960, 100, true],
    [1920, 100, true],
  ];
  for (const [width, maxLane, visible] of cases) {
    const frame = graphFrame(width, maxLane, width <= 800);
    assert.equal(frame.showMessages, visible, `${width}px, lane ${maxLane}`);
    if (visible) {
      assert.ok(frame.branchWidth <= width / 2);
      assert.ok(frame.messageWidth > 0 && frame.messageWidth <= width / 2);
      if (width <= 800) assert.ok(frame.spacing >= 12);
    } else {
      assert.equal(frame.branchWidth, width);
      assert.equal(frame.messageWidth, 0);
    }
    assert.ok(frame.spacing > 0 && frame.spacing <= 34);
    assert.ok(
      GRAPH_ORIGIN + maxLane * frame.spacing <= frame.branchWidth - 18 + 1e-9,
    );
  }
});
test('wide branch width grows with its content up to 50 percent and messages stay capped at 50 percent', () => {
  for (const width of [801, 900, 1440, 2560])
    for (const maxLane of [0, 1, 8, 40, 500]) {
      const frame = graphFrame(width, maxLane, false);
      assert.equal(frame.width, width);
      assert.equal(frame.showMessages, true);
      assert.ok(frame.branchWidth <= width / 2);
      assert.ok(frame.spacing > 0 && frame.spacing <= 34);
      assert.ok(
        GRAPH_ORIGIN + maxLane * frame.spacing <= frame.branchWidth - 18 + 1e-9,
      );
      assert.equal(frame.messageX, frame.branchWidth + 16);
      assert.ok(frame.messageWidth <= width / 2);
      assert.ok(frame.messageWidth > 0);
      assert.ok(frame.messageX + frame.messageWidth <= width - 16);
    }
  assert.ok(graphFrame(900, 500, false).spacing < 1);
});
test('sparse wide graphs leave no half-screen gap and only compress after reaching the width cap', () => {
  for (const width of [900, 1440, 2560]) {
    const single = graphFrame(width, 0, false),
      few = graphFrame(width, 3, false),
      dense = graphFrame(width, 100, false);
    assert.equal(single.messageX, 140);
    assert.ok(single.branchWidth < few.branchWidth);
    assert.ok(few.branchWidth < width / 2);
    assert.equal(few.spacing, 34);
    assert.equal(few.messageWidth, width / 2);
    assert.equal(dense.branchWidth, width / 2);
    assert.ok(dense.spacing < 34);
    assert.ok(dense.messageWidth < width / 2);
  }
  assert.equal(
    graphFrame(900, 3, false).messageX,
    graphFrame(2560, 3, false).messageX,
  );
});
test('branch display names remove repeated namespaces while keeping colliding suffixes distinct', () => {
  const names = branchDisplayNames([
    'main',
    'agents/fix-chat',
    'agents/fix-chat',
    'alice/topic',
    'bob/topic',
    'alice/feature/shared',
    'bob/feature/shared',
  ]);
  assert.equal(names.get('main'), 'main');
  assert.equal(names.get('agents/fix-chat'), 'fix-chat');
  assert.equal(names.get('alice/topic'), 'alice/topic');
  assert.equal(names.get('bob/topic'), 'bob/topic');
  assert.equal(names.get('alice/feature/shared'), 'alice/feature/shared');
  assert.equal(names.get('bob/feature/shared'), 'bob/feature/shared');
});
test('each branch name keeps its own text and long labels retain their beginning', () => {
  const name = 'agents/fix-a-very-long-window-bug-4721',
    display = branchDisplayNames([name, 'main', 'master', 'dev']);
  const short = branchLabelText(name, display, 16);
  assert.equal(short, 'fix-a-very-long…');
  assert.equal(Array.from(short).length, 16);
  assert.deepEqual(
    ['main', 'master', 'dev'].map((name) => branchLabelText(name, display, 16)),
    ['main', 'master', 'dev'],
  );
  const unicode = branchLabelText(
    '修复窗口滚动时丢失分支显示的问题',
    new Map(),
    10,
  );
  assert.equal(Array.from(unicode).length, 10);
  assert.ok(unicode.endsWith('…'));
  assert.ok(!unicode.includes('�'));
});
test('individual branch labels handle narrow bounds and Unicode without a reference-count suffix', () => {
  const name = 'bugfix/invalid-token-refresh-failure',
    display = branchDisplayNames([name, 'main', 'dev']);
  assert.equal(branchLabelText(name, display, 1), '…');
  assert.equal(branchLabelText(name, display, 2), 'i…');
  assert.equal(branchLabelText(name, display, 16), 'invalid-token-r…');
  assert.equal(
    branchLabelText('fix-🚀-very-long-name', new Map(), 8),
    'fix-🚀-v…',
  );
  assert.equal(branchLabelText('main', new Map(), 4), 'main');
});
