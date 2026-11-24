import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphColors } from './graphColors';
import { GRAPH_COLOR_COUNT } from './graphPalette';
import type { Branch, Commit } from '../shared/model';

const c = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents: parents.map((sha) => ({ sha })),
  commit: { message: sha, author: null, committer: null },
  html_url: '',
});

const ref = (name: string, sha: string): Branch => ({ name, commit: { sha } });
const refs = [ref('main', 'm'), ref('feature', 'f')];

test('side paths and their merge connectors keep one color until joining the base', () => {
  const commits = [
    c('m', 'b', 'f'),
    c('b', 'root'),
    c('f', 'g'),
    c('g', 'root'),
    c('root'),
  ];
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

test('pagination fills parent reservations and colors the expanded paths deterministically', () => {
  const first = [c('m', 'base'), c('f', 'unloaded')];
  const before = graphColors(first, refs, 'main');
  const next = [...first, c('base'), c('unloaded', 'older'), c('older')];
  const after = graphColors(next, refs, 'main');
  const fresh = graphColors([...next].reverse(), [...refs].reverse(), 'main');

  assert.equal(before.nodes.get('unloaded'), before.nodes.get('f'));
  for (const sha of ['f', 'unloaded', 'older']) {
    assert.equal(after.nodes.get(sha), after.branches.get('feature'));
    assert.equal(after.paths.nodes.get(sha), after.paths.nodes.get('f'));
  }
  assert.equal(after.branches.get('main'), 0);
  for (const kind of ['nodes', 'edges', 'branches'] as const)
    assert.deepEqual(after[kind], fresh[kind]);
});

test('a late reference inside anonymous merged history is an alias of that path', () => {
  const commits = [
    c('m', 'b', 'f'),
    c('b', 'root'),
    c('f', 'g'),
    c('g', 'root'),
    c('root'),
  ];
  const before = graphColors(commits, [ref('main', 'm')], 'main');
  const after = graphColors(
    commits,
    [ref('middle-alias', 'g'), ref('main', 'm')],
    'main',
  );

  for (const sha of ['f', 'g']) {
    assert.equal(after.paths.nodes.get(sha), before.paths.nodes.get(sha));
    assert.equal(after.nodes.get(sha), before.nodes.get(sha));
  }
  assert.equal(
    after.paths.branches.get('middle-alias'),
    after.paths.nodes.get('f'),
  );
  assert.equal(after.branches.get('middle-alias'), after.nodes.get('f'));
  assert.equal(after.edges.get('m:f'), before.edges.get('m:f'));
});

test('path colors survive tip extensions and ref changes with the same neighbors', () => {
  const first = [
    c('m', 'root'),
    c('f', 'older'),
    c('older', 'root'),
    c('root'),
  ];
  const next = [c('feature-next', 'f'), ...first];
  const base = ref('main', 'm');
  const feature = ref('feature', 'f');
  const cases = [
    { name: 'anonymous extension', commits: next, from: [], to: [] },
    {
      name: 'same branch advances',
      commits: next,
      from: [feature],
      to: [ref('feature', 'feature-next')],
    },
    {
      name: 'new branch at the extended tip',
      commits: next,
      from: [feature],
      to: [feature, ref('new-feature', 'feature-next')],
    },
    {
      name: 'intermediate ref',
      commits: first,
      from: [feature],
      to: [feature, ref('middle-ref', 'older')],
    },
    {
      name: 'alias at the same tip',
      commits: first,
      from: [feature],
      to: [feature, ref('aaa-feature', 'f')],
    },
  ];

  for (const { name, commits, from, to } of cases) {
    const before = graphColors(first, [base, ...from], 'main');
    const after = graphColors(commits, [base, ...to], 'main');
    for (const kind of ['nodes', 'edges'] as const)
      for (const [id, color] of before[kind])
        assert.equal(after[kind].get(id), color, `${name}: ${kind} ${id}`);

    const tip = commits === next ? 'feature-next' : 'f';
    const color = before.nodes.get('f');
    const owner = after.paths.nodes.get(tip);
    for (const sha of [tip, 'f', 'older']) {
      assert.equal(after.nodes.get(sha), color, name);
      assert.equal(after.paths.nodes.get(sha), owner, name);
    }
    if (commits === next)
      assert.equal(after.edges.get('feature-next:f'), color);
    for (const { name: label } of to) {
      assert.equal(after.branches.get(label), color, name);
      assert.equal(after.paths.branches.get(label), owner, name);
    }
    assert.equal(after.branches.get('main'), 0, name);
  }
});

test('each base selection is deterministic and returning to a base restores its allocation', () => {
  const commits = [
    c('m', 'b', 'g'),
    c('b', 'root'),
    c('f', 'g'),
    c('g', 'root'),
    c('root'),
  ];

  for (const base of ['main', 'feature', 'main']) {
    const first = graphColors(commits, refs, base);
    const second = graphColors(
      [...commits].reverse(),
      [...refs].reverse(),
      base,
    );

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
  let shas: [string, string] | undefined;
  for (let index = 0; index < GRAPH_COLOR_COUNT * 4 && !shas; index++) {
    const sha = `side-${index}`;
    const colors = graphColors(
      [c('m', 'root', sha), c(sha, 'root'), c('root')],
      [ref('main', 'm'), ref('probe', sha)],
      'main',
    );
    const color = colors.nodes.get(sha)!;
    const existing = seen.get(color);
    if (existing) shas = [existing, sha];
    else seen.set(color, sha);
  }

  assert.ok(shas);
  // The incoming path sorts first and gets the shared preferred color.
  const [incomingSha, existingSha] = shas.sort();
  const existingName = 'existing';
  const incomingName = 'incoming';
  const first = [
    c('m', 'root', existingSha),
    c(existingSha, 'root'),
    c('root'),
  ];
  const before = graphColors(
    first,
    [ref('main', 'm'), ref(existingName, existingSha)],
    'main',
  );
  const next = [
    c('main-next', 'm', incomingSha),
    c(incomingSha, 'root'),
    ...first,
  ];
  const branches = [
    ref('main', 'main-next'),
    ref(existingName, existingSha),
    ref(incomingName, incomingSha),
  ];
  const after = graphColors(next, branches, 'main');
  const fresh = graphColors(
    [...next].reverse(),
    [...branches].reverse(),
    'main',
  );

  assert.notEqual(
    after.branches.get(existingName),
    before.branches.get(existingName),
  );
  assert.notEqual(
    after.branches.get(existingName),
    after.branches.get(incomingName),
  );
  for (const branch of branches) {
    assert.equal(
      after.branches.get(branch.name),
      fresh.branches.get(branch.name),
    );
  }
});
