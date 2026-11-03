import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsPageviewFilter } from './analytics';

test('analytics strips repository and branch query values and URL fragments', () => {
  const filter = analyticsPageviewFilter();
  const result = filter({
    url: 'https://git-stream-view.vercel.app/?repo=owner/private-repo&branch=secret-feature#commit',
  });
  assert.equal(result?.url, 'https://git-stream-view.vercel.app/');
});

test('analytics counts only the first page view in a document', () => {
  const filter = analyticsPageviewFilter();
  assert.ok(filter({ url: 'https://git-stream-view.vercel.app/?repo=a/b' }));
  assert.equal(filter({ url: 'https://git-stream-view.vercel.app/?repo=c/d' }), null);
});

test('analytics never forwards invalid URLs, but still accepts a later valid URL', () => {
  const filter = analyticsPageviewFilter();
  assert.equal(filter({ url: '%broken' }), null);
  assert.equal(filter({ url: 'https://git-stream-view.vercel.app/?repo=a/b' })?.url, 'https://git-stream-view.vercel.app/');
});
