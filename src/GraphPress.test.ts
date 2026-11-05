import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphPress } from './GraphPress';

test('short stationary touches accept a click with the larger line hit range', () => {
  const press = new GraphPress(20, 40, 100, true);
  assert.equal(press.radius, 12);
  assert.equal(press.acceptsClick(180), true);
});
test('small finger jitter stays a tap while a swipe cannot become a tap by returning', () => {
  const press = new GraphPress(20, 40, 100, true);
  press.move(24, 43);
  assert.equal(press.acceptsClick(200), true);
  press.move(40, 50);
  press.move(20, 40);
  assert.equal(press.acceptsClick(250), false);
});
test('cancelled touches never pin a path even when a click follows', () => {
  const press = new GraphPress(20, 40, 100, true);
  press.cancel();
  assert.equal(press.acceptsClick(120), false);
});
test('long presses cannot pin a path', () => {
  const press = new GraphPress(20, 40, 100, true);
  assert.equal(press.acceptsClick(600), true);
  assert.equal(press.acceptsClick(601), false);
});
test('mouse clicks keep the existing five pixel range and native click semantics', () => {
  const press = new GraphPress(20, 40, 100, false);
  assert.equal(press.radius, 5);
  assert.equal(press.acceptsClick(1000), true);
});

test('dragged or cancelled mouse presses do not pin a path', () => {
  const dragged = new GraphPress(20, 40, 100, false);
  dragged.move(40, 40);
  assert.equal(dragged.acceptsClick(200), false);
  const cancelled = new GraphPress(20, 40, 100, false);
  cancelled.cancel();
  assert.equal(cancelled.acceptsClick(200), false);
});
