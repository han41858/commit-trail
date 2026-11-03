import test from 'node:test';
import assert from 'node:assert/strict';
import { emojify } from './emoji';

test('GitMoji shortcodes render as emoji', () => {
  assert.equal(emojify(':bug: fix crash'), '🐛 fix crash');
  assert.equal(emojify(':sparkles::memo: add docs'), '✨📝 add docs');
  assert.equal(emojify(':technologist: tooling'), '🧑‍💻 tooling');
});
test('common GitHub shortcodes render as emoji', () => {
  assert.equal(emojify(':+1: :-1: :100: :warning:'), '👍 👎 💯 ⚠️');
  assert.equal(emojify(':pencil: :heavy_check_mark: :eyes:'), '📝 ✔️ 👀');
});
test('unknown shortcodes and ordinary colons stay as text', () => {
  assert.equal(emojify(':unknown_code: keep'), ':unknown_code: keep');
  assert.equal(emojify(':constructor: keep'), ':constructor: keep');
  assert.equal(emojify('time 10:30: done'), 'time 10:30: done');
  assert.equal(emojify('🐛 already emoji'), '🐛 already emoji');
});
