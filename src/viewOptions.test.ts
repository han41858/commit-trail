import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultViewOptions, parseViewOptions } from './viewOptions';

test('saved view options restore theme, auto refresh and interval', () => {
  assert.deepEqual(
    parseViewOptions(JSON.stringify({ theme: 'light', autoRefresh: false, interval: 60 })),
    { theme: 'light', autoRefresh: false, interval: 60 },
  );
  assert.deepEqual(parseViewOptions(JSON.stringify({ theme: 'dark', interval: null })), {
    theme: 'dark',
    autoRefresh: true,
    interval: null,
  });
});
test('missing, malformed or unknown view options fall back per field', () => {
  for (const raw of [null, '', '{', 'null', '"dark"', '[]'])
    assert.deepEqual(parseViewOptions(raw), defaultViewOptions());
  assert.deepEqual(
    parseViewOptions(JSON.stringify({ theme: 'sepia', autoRefresh: 'no', interval: 45 })),
    defaultViewOptions(),
  );
  assert.deepEqual(
    parseViewOptions(JSON.stringify({ theme: 'light', autoRefresh: 1, interval: '60' })),
    { ...defaultViewOptions(), theme: 'light' },
  );
});
