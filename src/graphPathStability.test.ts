import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphColors, type GraphColors } from './graphColors';
import { GRAPH_COLOR_COUNT } from './graphPalette';
import type { Branch, Commit } from './model';

const commit = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents: parents.map((sha) => ({ sha })),
  commit: { message: sha, author: null, committer: null },
  html_url: '',
});

const branch = (name: string, sha: string): Branch => ({ name, commit: { sha } });

function colorsFor(commits: Commit[], branches: Branch[], base = 'main') {
  const head = branches.find((value) => value.name === base)?.commit.sha;
  return graphColors(commits, branches, base, head);
}

function sortedEntries<T>(values: ReadonlyMap<string, T>) {
  return [...values].sort(([left], [right]) => left.localeCompare(right));
}

function assertSameColors(expected: GraphColors, actual: GraphColors) {
  for (const kind of ['nodes', 'edges', 'branches'] as const) {
    assert.deepEqual(sortedEntries(actual[kind]), sortedEntries(expected[kind]), kind);
    assert.deepEqual(
      sortedEntries(actual.paths[kind]),
      sortedEntries(expected.paths[kind]),
      `${kind} path identities`,
    );
  }
  assert.deepEqual(sortedEntries(actual.assignments), sortedEntries(expected.assignments));
}

const history = [
  commit('main-tip', 'main-parent', 'dev-older'),
  commit('dev-tip', 'dev-older'),
  commit('main-parent', 'root'),
  commit('dev-older', 'root'),
  commit('root'),
];

const references = [branch('main', 'main-tip'), branch('dev', 'dev-tip')];

test('fresh browser instances and refreshes deterministically color the same snapshot', () => {
  const expected = colorsFor(history, references);

  for (let refresh = 0; refresh < 4; refresh++) {
    const freshCommits = JSON.parse(JSON.stringify(history)) as Commit[];
    const freshReferences = JSON.parse(JSON.stringify(references)) as Branch[];
    assertSameColors(expected, colorsFor(freshCommits, freshReferences));
  }
});

test('async commit and reference arrival order cannot change a final snapshot', () => {
  const expected = colorsFor(history, references);
  const permutations = [
    [...history].reverse(),
    [...history.slice(2), ...history.slice(0, 2)],
    [history[2], history[0], history[4], history[1], history[3]],
  ];

  for (const commits of permutations) {
    assertSameColors(expected, colorsFor(commits, [...references].reverse()));
  }
});

test('pagination reserves unloaded first-parent paths and has a deterministic final result', () => {
  const first = [commit('main-tip', 'root'), commit('dev-tip', 'unloaded')];
  const before = colorsFor(first, references);

  assert.equal(before.paths.nodes.get('unloaded'), before.paths.nodes.get('dev-tip'));
  assert.equal(before.paths.edges.get('dev-tip:unloaded'), before.paths.nodes.get('dev-tip'));

  const final = [...first, commit('root'), commit('unloaded', 'older'), commit('older', 'root')];
  const after = colorsFor(final, references);
  const fresh = colorsFor([...final].reverse(), [...references].reverse());

  assertSameColors(after, fresh);
  for (const sha of ['unloaded', 'older']) {
    assert.equal(after.paths.nodes.get(sha), after.paths.nodes.get('dev-tip'));
  }
  assert.notEqual(after.paths.nodes.get('root'), after.paths.nodes.get('older'));
});

test('a new colliding neighbor produces the same result in every fresh instance', () => {
  const seen = new Map<number, { name: string; sha: string }>();
  let collision: [{ name: string; sha: string }, { name: string; sha: string }] | undefined;

  // Find an initial collision through public behavior, without assuming a hash.
  for (let index = 0; index < GRAPH_COLOR_COUNT * 4 && !collision; index++) {
    const candidate = { name: `topic-${index}`, sha: `side-${index}` };
    const colors = colorsFor(
      [commit('main-tip', 'root', candidate.sha), commit(candidate.sha, 'root'), commit('root')],
      [branch('main', 'main-tip'), branch(candidate.name, candidate.sha)],
    );
    const color = colors.branches.get(candidate.name)!;
    const existing = seen.get(color);
    if (existing) collision = [existing, candidate];
    else seen.set(color, candidate);
  }

  assert.ok(collision);
  const [existing, incoming] = collision;
  const commits = [
    commit('main-tip', 'root', existing.sha, incoming.sha),
    commit(existing.sha, 'root'),
    commit(incoming.sha, 'root'),
    commit('root'),
  ];
  const branches = [
    branch('main', 'main-tip'),
    branch(existing.name, existing.sha),
    branch(incoming.name, incoming.sha),
  ];
  const expected = colorsFor(commits, branches);
  const actual = colorsFor([...commits].reverse(), [...branches].reverse());

  // Changed neighborhoods may recolor a path; the same final neighborhood may not.
  assertSameColors(expected, actual);
  assert.notEqual(expected.branches.get(incoming.name), expected.branches.get(existing.name));
  assert.notEqual(expected.paths.nodes.get(incoming.sha), expected.paths.nodes.get(existing.sha));
});

test('anonymous deleted flows have deterministic identities without branch references', () => {
  const commits = [
    commit('main-tip', 'main-parent', 'former-tip'),
    commit('main-parent', 'root'),
    commit('former-tip', 'former-middle'),
    commit('former-middle', 'root'),
    commit('root'),
  ];
  const branches = [branch('main', 'main-tip')];
  const expected = colorsFor(commits, branches);
  const actual = colorsFor([...commits].reverse(), branches);

  assertSameColors(expected, actual);
  assert.equal(expected.paths.nodes.get('former-tip'), expected.paths.nodes.get('former-middle'));
  assert.notEqual(expected.paths.nodes.get('root'), expected.paths.nodes.get('former-tip'));
});

test('aliases and intermediate refs do not split one first-parent flow', () => {
  const branches = [
    branch('aaa-middle-ref', 'dev-older'),
    branch('dev-alias', 'dev-tip'),
    ...references,
  ];
  const colors = colorsFor(history, branches);
  const path = colors.paths.nodes.get('dev-tip');

  assertSameColors(colors, colorsFor([...history].reverse(), [...branches].reverse()));
  assert.equal(colors.paths.nodes.get('dev-older'), path);
  for (const name of ['dev', 'dev-alias', 'aaa-middle-ref']) {
    assert.equal(colors.paths.branches.get(name), path);
    assert.equal(colors.branches.get(name), colors.nodes.get('dev-tip'));
  }
  assert.notEqual(colors.paths.nodes.get('root'), path);
});

test('more paths than colors reuse the palette without combining path identities', () => {
  const heads = Array.from({ length: GRAPH_COLOR_COUNT + 2 }, (_, index) => `side-${index}`);
  const commits = [
    commit('main-tip', 'root', ...heads),
    ...heads.map((head) => commit(head, 'root')),
    commit('root'),
  ];
  const branches = [branch('main', 'main-tip'), ...heads.map((head) => branch(head, head))];
  const colors = colorsFor(commits, branches);
  const paths = new Set(heads.map((head) => colors.paths.nodes.get(head)));
  const tones = heads.map((head) => colors.nodes.get(head)!);

  assert.equal(paths.size, heads.length);
  assert.ok(tones.every((tone) => Number.isInteger(tone) && tone >= 0 && tone < GRAPH_COLOR_COUNT));
  assert.ok(new Set(tones).size < heads.length);
  assertSameColors(colors, colorsFor([...commits].reverse(), [...branches].reverse()));
});
