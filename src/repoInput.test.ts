import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lowercaseField } from './repoInput';

const field = (value: string, start: number, end = start) => {
  const f = {
    value,
    selectionStart: start as number | null,
    selectionEnd: end as number | null,
    writes: 0,
    setSelectionRange(s: number, e: number) {
      this.selectionStart = s;
      this.selectionEnd = e;
    },
  };
  return new Proxy(f, {
    set(target, key, v) {
      if (key === 'value') target.writes++;
      (target as Record<string | symbol, unknown>)[key] = v;
      return true;
    },
  });
};

test('uppercase typed in the middle keeps the caret after the inserted text', () => {
  const f = field('owXner/repo', 3);
  assert.equal(lowercaseField(f), 'owxner/repo');
  assert.equal(f.value, 'owxner/repo');
  assert.deepEqual([f.selectionStart, f.selectionEnd], [3, 3]);
  const pasted = field('owABner/repo', 4);
  assert.equal(lowercaseField(pasted), 'owabner/repo');
  assert.deepEqual([pasted.selectionStart, pasted.selectionEnd], [4, 4]);
});
test('a selection range is preserved and lowercase input is left untouched', () => {
  const selected = field('OWNER/repo', 0, 5);
  lowercaseField(selected);
  assert.deepEqual(
    [selected.value, selected.selectionStart, selected.selectionEnd],
    ['owner/repo', 0, 5],
  );
  const plain = field('owner/repo', 2);
  assert.equal(lowercaseField(plain), 'owner/repo');
  assert.equal(plain.writes, 0);
});
test('values that lowercase to the current state still restore the caret', () => {
  const f = field('Owner/repo', 1);
  assert.equal(lowercaseField(f), 'owner/repo');
  assert.deepEqual([f.selectionStart, f.selectionEnd], [1, 1]);
});
