import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertMainPromotion } from './check-promotion.mjs';

test('CI preserves a static required check and runs the job for PR edits', () => {
  const workflow = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
  const jobs = workflow.split('  test-build:\n');
  assert.equal(jobs.length, 2);
  const header = jobs[1].split('    steps:\n')[0];
  // A skipped job with a dynamic name did not satisfy GitHub's required check,
  // even after an older successful run was retried. Keep a real, stable job.
  assert.match(header, /^    name: Test and build$/m);
  assert.doesNotMatch(header, /^    if:/m);
  assert.match(workflow, /^    types: \[opened, synchronize, reopened, edited\]$/m);
});

const promotion = {
  eventName: 'pull_request',
  baseRef: 'main',
  headRef: 'dev',
  headRepository: 'han41858/commit-trail',
  repository: 'han41858/commit-trail',
};

test('main accepts a promotion from the same repository dev branch', () => {
  assert.doesNotThrow(() => assertMainPromotion(promotion));
});

test('feature, release, hotfix and other branches cannot bypass dev', () => {
  for (const headRef of ['feat/example', 'release/example', 'hotfix/example', 'main', 'Dev', '']) {
    assert.throws(() => assertMainPromotion({ ...promotion, headRef }), /Merge into dev first/);
  }
});

test('a fork branch named dev cannot promote directly to main', () => {
  assert.throws(
    () => assertMainPromotion({ ...promotion, headRepository: 'someone/commit-trail' }),
    /Merge into dev first/,
  );
});

test('main fails closed if repository metadata is missing', () => {
  for (const patch of [
    { repository: '' },
    { headRepository: undefined },
    { repository: undefined },
  ]) {
    assert.throws(() => assertMainPromotion({ ...promotion, ...patch }), /Merge into dev first/);
  }
});

test('feature and fork PRs targeting dev continue through ordinary validation', () => {
  assert.doesNotThrow(() =>
    assertMainPromotion({ ...promotion, baseRef: 'dev', headRef: 'feat/example' }),
  );
  assert.doesNotThrow(() =>
    assertMainPromotion({
      ...promotion,
      baseRef: 'dev',
      headRef: 'fix/example',
      headRepository: 'someone/commit-trail',
    }),
  );
});

test('push validation does not require pull-request metadata', () => {
  assert.doesNotThrow(() => assertMainPromotion({ eventName: 'push' }));
});
