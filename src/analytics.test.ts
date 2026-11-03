import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsBeforeSend } from './analytics';

test('redacts private repository and branch parameters from page views', () => {
  const beforeSend = createAnalyticsBeforeSend();
  const result = beforeSend({
    type: 'pageview',
    url: 'https://git-stream-view.vercel.app/?repo=owner/private-repo&branch=secret-feature#commit',
  });
  assert.equal(result?.url, 'https://git-stream-view.vercel.app/');
  assert.equal(result?.type, 'pageview');
});

test('ignores additional page views caused by SPA history changes', () => {
  const beforeSend = createAnalyticsBeforeSend();
  assert.ok(beforeSend({ type: 'pageview', url: 'https://git-stream-view.vercel.app/?repo=first/repo' }));
  assert.equal(
    beforeSend({ type: 'pageview', url: 'https://git-stream-view.vercel.app/?repo=second/repo' }),
    null,
  );
});

test('invalid URL is never forwarded and does not consume the initial page view', () => {
  const beforeSend = createAnalyticsBeforeSend();
  assert.equal(beforeSend({ type: 'pageview', url: '%broken' }), null);
  assert.equal(
    beforeSend({ type: 'pageview', url: 'https://git-stream-view.vercel.app/?repo=a/b' })?.url,
    'https://git-stream-view.vercel.app/',
  );
});

test('custom events, if added later, also have their URL query removed', () => {
  const beforeSend = createAnalyticsBeforeSend();
  const event = beforeSend({
    type: 'event',
    url: 'https://git-stream-view.vercel.app/?repo=private/repo',
  });
  assert.equal(event?.url, 'https://git-stream-view.vercel.app/');
  assert.ok(beforeSend({ type: 'pageview', url: 'https://git-stream-view.vercel.app/' }));
});
