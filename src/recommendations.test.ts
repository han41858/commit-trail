import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  preferredBranch,
  recommendBranches,
  PullCounts,
} from './recommendations';
const branch = (name: string) => ({ name, commit: { sha: name } });
test('main wins even with no merged PRs; master is the fallback when main is absent', () => {
  const branches = ['develop', 'master', 'main', 'release'].map(branch);
  assert.equal(preferredBranch(branches, 'develop'), 'main');
  assert.deepEqual(
    recommendBranches(
      branches,
      { release: 200, master: 3, main: 0 },
      'develop',
    ).map((b) => b.name),
    ['main', 'master', 'develop', 'release'],
  );
  assert.equal(
    preferredBranch(
      branches.filter((b) => b.name !== 'main'),
      'develop',
    ),
    'master',
  );
  assert.equal(
    preferredBranch([branch('develop'), branch('release')], 'develop'),
    'develop',
  );
});
test('recommendations contain at most 30 existing refs ordered by merged PR counts', () => {
  const branches = [
    'main',
    ...Array.from({ length: 40 }, (_, i) => `branch-${i}`),
  ].map(branch);
  const counts = Object.fromEntries(branches.map((b, i) => [b.name, i]));
  counts.deleted = 1000;
  const ranked = recommendBranches(branches, counts, 'main');
  assert.equal(ranked.length, 30);
  assert.equal(ranked[0].name, 'main');
  assert.equal(ranked[1].name, 'branch-39');
  assert.equal(ranked.at(-1)?.name, 'branch-11');
  assert.ok(!ranked.some((b) => b.name === 'deleted'));
});
test('90-day counts exclude unmerged and old merges and deduplicate overlapping PR pages', () => {
  const tally = new PullCounts(new Date('2026-10-29T12:00:00Z'));
  const now = '2026-10-29T10:00:00Z';
  const recent = {
    id: 1,
    merged_at: now,
    updated_at: now,
    base: { ref: 'release' },
  };
  assert.equal(
    tally.add([
      recent,
      { id: 2, merged_at: null, updated_at: now, base: { ref: 'release' } },
      {
        id: 3,
        merged_at: '2026-01-01T00:00:00Z',
        updated_at: now,
        base: { ref: 'old' },
      },
    ]),
    false,
  );
  tally.add([recent]);
  assert.deepEqual({ ...tally.counts }, { release: 1 });
  assert.equal(tally.scanned, 3);
  assert.equal(
    tally.add([
      {
        id: 4,
        merged_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        base: { ref: 'old' },
      },
    ]),
    true,
  );
});

test('main, master and repository default are pinned in order without duplicates', () => {
  const branches = ['release', 'main', 'master', 'develop'].map(branch);
  assert.deepEqual(
    recommendBranches(branches, { release: 5000 }, 'develop').map(
      (b) => b.name,
    ),
    ['main', 'master', 'develop', 'release'],
  );
  assert.deepEqual(
    recommendBranches(branches, { release: 5000 }, 'main').map((b) => b.name),
    ['main', 'master', 'release', 'develop'],
  );
  assert.deepEqual(
    recommendBranches(
      branches.filter((b) => b.name !== 'main'),
      { release: 5000 },
      'develop',
    ).map((b) => b.name),
    ['master', 'develop', 'release'],
  );
});
