import assert from 'node:assert/strict';
import test from 'node:test';
import { OwnerRepositoryScroll } from './OwnerRepositoryScroll';

const empty = { scrollTop: 0, clientHeight: 200, scrollHeight: 200 };

test('unmatched filters never trigger additional pages, even on downward gestures', () => {
  const paging = new OwnerRepositoryScroll();
  for (let i = 0; i < 20; i++)
    assert.equal(paging.request(empty, 30, true, true, i * 500), false);
});

test('empty owner-matched pages require a new gesture for each batch', () => {
  const paging = new OwnerRepositoryScroll();
  assert.equal(paging.request(empty, 30, true, false, 0), true);
  // A fast completed batch and more wheel events in the same gesture cannot chain.
  assert.equal(paging.request(empty, 30, true, false, 50), false);
  assert.equal(paging.request(empty, 30, true, false, 100), false);
  assert.equal(paging.request(empty, 0, true, false, 500), false);
  assert.equal(paging.request(empty, 30, true, false, 600), true);
});

test('scrolling requires downward movement near the bottom and a ready source', () => {
  const paging = new OwnerRepositoryScroll();
  assert.equal(paging.move(500), 500);
  assert.equal(paging.move(500), 0);
  assert.equal(paging.move(400), -100);
  assert.equal(paging.request({ ...empty, scrollHeight: 2000 }, 30, true, false, 0), false);
  assert.equal(paging.request(empty, 30, false, false, 500), false);
  assert.equal(paging.request(empty, -30, true, false, 1000), false);
  assert.equal(paging.request(empty, 30, true, false, 1500), true);
});

test('an exhausted source never requests again despite repeated new gestures', () => {
  const paging = new OwnerRepositoryScroll();
  for (let i = 0; i < 20; i++)
    assert.equal(paging.request(empty, 50, false, false, i * 500), false);
});
