import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMainPromotion } from './check-promotion.mjs';

const promotion = {
  eventName: 'pull_request',
  baseRef: 'main',
  headRef: 'dev',
  headRepository: 'han41858/git-stream',
  repository: 'han41858/git-stream',
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
    () => assertMainPromotion({ ...promotion, headRepository: 'someone/git-stream' }),
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
      headRepository: 'someone/git-stream',
    }),
  );
});

test('push validation does not require pull-request metadata', () => {
  assert.doesNotThrow(() => assertMainPromotion({ eventName: 'push' }));
});
