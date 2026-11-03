import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, ancestors, parseRepo, lowercaseRepoInput, type Commit } from './model';
const c = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents: parents.map((sha) => ({ sha })),
  commit: { message: sha, author: { name: 'Test', date: '2020-01-01' }, committer: null },
  html_url: `https://github.com/a/b/commit/${sha}`,
});
function valid(input: Commit[]) {
  const result = layout(input);
  assert.equal(result.ordered.length, new Set(input.map((c) => c.sha)).size);
  const indices = new Map(result.ordered.map((c, i) => [c.sha, i]));
  for (const commit of input)
    for (const p of commit.parents)
      if (indices.has(p.sha)) assert.ok(indices.get(commit.sha)! < indices.get(p.sha)!);
  return result;
}
test('linear history uses parent topology rather than input or date order', () => {
  assert.deepEqual(
    valid([c('a'), c('c', 'b'), c('b', 'a')]).ordered.map((c) => c.sha),
    ['c', 'b', 'a'],
  );
});
test('fork, merge, octopus and shared commits preserve all parent relationships', () => {
  for (const input of [
    [c('b', 'a'), c('c', 'a'), c('a')],
    [c('m', 'b', 'c'), c('b', 'a'), c('c', 'a'), c('a')],
    [c('m', 'b', 'c', 'd'), c('b', 'a'), c('c', 'a'), c('d', 'a'), c('a')],
  ]) {
    const r = valid(input);
    assert.ok(new Set(r.lanes.values()).size > 1);
    assert.equal(r.ordered.filter((c) => c.sha === 'a').length, 1);
  }
});
test('direction reversal reverses rows while preserving exact edge sets', () => {
  const r = valid([c('m', 'a', 'b'), c('a'), c('b')]);
  const edges = (items: Commit[]) =>
    items.flatMap((c) => c.parents.map((p) => `${c.sha}:${p.sha}`)).sort();
  assert.deepEqual(edges(r.ordered), edges([...r.ordered].reverse()));
  assert.equal([...r.ordered].reverse().at(-1)?.sha, 'm');
});
test('partial boundary is retained and adding parents deduplicates SHA with stable lanes', () => {
  const first = valid([c('b', 'a')]);
  assert.equal(first.ordered[0].parents[0].sha, 'a');
  const next = layout([c('b', 'a'), c('a'), c('b', 'a')], first.lanes);
  assert.equal(next.ordered.length, 2);
  assert.equal(next.lanes.get('b'), first.lanes.get('b'));
  assert.deepEqual(
    next.ordered.map((c) => c.sha),
    ['b', 'a'],
  );
});
test('ancestor highlighting works without deleted branch references', () => {
  assert.deepEqual(
    [...ancestors('m', [c('m', 'b', 'c'), c('b', 'a'), c('c', 'a'), c('a')])].sort(),
    ['a', 'b', 'c', 'm'],
  );
});
test('repository inputs validate and normalize', () => {
  assert.equal(parseRepo('https://github.com/owner/repo.git/'), 'owner/repo');
  assert.equal(parseRepo('owner/repo'), 'owner/repo');
  for (const bad of ['https://evil.example/a/b', '../a', 'a/b?token=x', 'a/b/tree/main'])
    assert.throws(() => parseRepo(bad));
});
test('10k commit layout completes and preserves topology', () => {
  const input = Array.from({ length: 10000 }, (_, i) =>
    c(String(i), ...(i < 9999 ? [String(i + 1)] : [])),
  );
  assert.equal(valid(input).ordered.length, 10000);
});

test('selected base first-parent history stays straight through merges and octopus merges', () => {
  const input = [
    c('tip', 'merge'),
    c('merge', 'base', 'feature', 'third'),
    c('feature', 'root'),
    c('third', 'root'),
    c('base', 'root'),
    c('root'),
  ];
  const result = layout(input, new Map(), 'tip');
  for (const sha of ['tip', 'merge', 'base', 'root']) assert.equal(result.lanes.get(sha), 0);
  for (const sha of ['feature', 'third']) assert.ok(result.lanes.get(sha)! > 0);
  assert.equal(result.ordered.length, input.length);
  const indices = new Map(result.ordered.map((c, i) => [c.sha, i]));
  for (const commit of input)
    for (const parent of commit.parents)
      assert.ok(indices.get(commit.sha)! < indices.get(parent.sha)!);
});
test('base changes reserve the new first-parent line without inventing links for unrelated history', () => {
  const input = [
    c('base', 'root'),
    c('feature', 'fork'),
    c('fork', 'root'),
    c('root'),
    c('unrelated'),
  ];
  const first = layout(input, new Map(), 'base');
  const next = layout(input, first.lanes, 'feature');
  for (const sha of ['feature', 'fork', 'root']) assert.equal(next.lanes.get(sha), 0);
  assert.ok(next.lanes.get('base')! > 0);
  assert.ok(next.lanes.get('unrelated')! > 0);
  assert.deepEqual(input.find((c) => c.sha === 'unrelated')!.parents, []);
});
test('pagination extends the base line across a previously unloaded first parent', () => {
  const first = layout([c('tip', 'missing'), c('side', 'root')], new Map(), 'tip');
  assert.ok(first.spine.has('missing'));
  const next = layout(
    [c('tip', 'missing'), c('side', 'root'), c('missing', 'root'), c('root')],
    first.lanes,
    'tip',
  );
  for (const sha of ['tip', 'missing', 'root']) assert.equal(next.lanes.get(sha), 0);
  assert.equal(next.lanes.get('side'), first.lanes.get('side'));
});

test('old alphabetically listed branch tips cannot interleave ahead of newer eligible base commits', () => {
  const dated = (sha: string, date: string, ...parents: string[]) => ({
    ...c(sha, ...parents),
    commit: { ...c(sha).commit, committer: { date } },
  });
  const input = [
    dated('main-tip', '2026-10-29', 'main-parent'),
    dated('main-parent', '2026-10-28', 'main-oldest'),
    dated('main-oldest', '2026-10-27'),
    dated('2.0.x', '2016-09-15', 'old-parent'),
    dated('old-parent', '2016-09-14'),
    dated('feature', '2026-10-28T12:00:00Z'),
  ];
  const result = layout(input, new Map(), 'main-tip');
  assert.deepEqual(
    result.ordered.map((commit) => commit.sha),
    ['main-tip', 'feature', 'main-parent', 'main-oldest', '2.0.x', 'old-parent'],
  );
  assert.deepEqual(
    valid(input).ordered.map((commit) => commit.sha),
    result.ordered.map((commit) => commit.sha),
  );
});

test('newest eligible ordering still puts children before future-dated parents', () => {
  const child = {
    ...c('child', 'parent'),
    commit: { ...c('child').commit, committer: { date: '2026-01-01' } },
  };
  const parent = {
    ...c('parent'),
    commit: { ...c('parent').commit, committer: { date: '2030-01-01' } },
  };
  const side = { ...c('side'), commit: { ...c('side').commit, committer: { date: '2025-01-01' } } };
  assert.deepEqual(
    valid([parent, side, child]).ordered.map((commit) => commit.sha),
    ['child', 'parent', 'side'],
  );
});

test('ordering falls back to author time, keeps equal-date ties stable and handles absent dates', () => {
  const dated = (sha: string, date: string) => ({
    ...c(sha),
    commit: { message: sha, author: { name: 'Test', date }, committer: { date: 'invalid' } },
  });
  const missing = {
    ...c('missing'),
    commit: { message: 'missing', author: null, committer: null },
  };
  assert.deepEqual(
    valid([
      missing,
      dated('first', '2026-01-01'),
      dated('second', '2026-01-01'),
      dated('older', '2025-01-01'),
    ]).ordered.map((commit) => commit.sha),
    ['first', 'second', 'older', 'missing'],
  );
});
test('repository field input is lowercase only and keeps the local debug command', () => {
  assert.equal(lowercaseRepoInput('Angular/Angular'), 'angular/angular');
  assert.equal(
    lowercaseRepoInput('https://GitHub.com/Owner/Repo'),
    'https://github.com/owner/repo',
  );
  assert.equal(lowercaseRepoInput(':Debug'), ':debug');
  assert.equal(parseRepo(lowercaseRepoInput('https://GitHub.com/Owner/Repo.git')), 'owner/repo');
});
