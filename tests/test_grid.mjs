import assert from 'node:assert/strict';
import test from 'node:test';
import { WeekGrid } from '../public/js/grid.js';
import { CELLS } from '../public/js/schedule.js';

// Exercise interaction handlers without a browser or a DOM implementation.
// Only geometry and the small DOM surfaces used by the handlers are stubbed.
function grid(mode = 'overlap') {
  const instance = Object.create(WeekGrid.prototype);
  instance.view = {
    mode, mine: Array(CELLS).fill(0), masks: Array(CELLS).fill(1n),
    canSelect: i => i === 18, count: () => 1, total: 1,
    days: Array.from({ length: 7 }, (_, i) => ({ label: `Day ${i + 1}`, date: String(i + 1) })),
  };
  instance.calls = [];
  instance.onSelect = i => instance.calls.push(['select', i]);
  instance.onCommit = (indices, add) => instance.calls.push(['commit', indices, add]);
  // onHover and onLeave are deliberately absent, as in the preview.
  instance.hitIndex = 18;
  instance.cellAt = () => instance.hitIndex;
  instance.hoverIndex = -1;
  instance.hover = { hidden: true, style: { setProperty() {} } };
  instance.status = { textContent: '' };
  instance.sel = { hidden: true };
  instance.el = { focus() {} };
  instance.cells = Array.from({ length: CELLS }, () => ({
    scrollIntoView() {},
    getBoundingClientRect: () => ({ right: 5, top: 2, height: 1 }),
  }));
  return instance;
}

function pointer(type, override = {}) {
  return {
    button: 0, pointerType: type, pointerId: 7, clientX: 5, clientY: 6,
    preventDefault() {}, ...override,
  };
}

function key(value) { return { key: value, preventDefault() {} }; }

test('a desktop click selects a permitted meeting start', () => {
  const g = grid();
  g.pointerDown(pointer('mouse'));
  g.pointerUp(pointer('mouse'));
  assert.deepEqual(g.calls, [['select', 18]]);
});

test('a touch tap selects a permitted meeting start', () => {
  const g = grid();
  g.pointerDown(pointer('touch'));
  g.pointerUp(pointer('touch'));
  assert.deepEqual(g.calls, [['select', 18]]);
});

test('touch scrolling and mouse dragging never schedule a meeting', () => {
  for (const type of ['touch', 'mouse']) {
    const g = grid();
    g.pointerDown(pointer(type));
    g.pointerMove(pointer(type, { clientY: 30 }));
    g.pointerUp(pointer(type));
    assert.deepEqual(g.calls, []);
  }
});

test('release movement is rejected even without an intermediate move event', () => {
  const g = grid();
  g.pointerDown(pointer('mouse'));
  g.pointerUp(pointer('mouse', { clientX: 25 }));
  assert.deepEqual(g.calls, []);
});

test('cancelling a pointer gesture prevents later release from selecting', () => {
  const g = grid();
  g.pointerDown(pointer('touch'));
  g.cancel();
  g.pointerUp(pointer('touch'));
  assert.deepEqual(g.calls, []);
});

test('invalid or unconfigured meeting starts cannot be selected', () => {
  for (const canSelect of [() => false, undefined]) {
    const g = grid();
    g.view.canSelect = canSelect;
    g.pointerDown(pointer('mouse'));
    g.pointerUp(pointer('mouse'));
    assert.deepEqual(g.calls, []);
    assert.equal(g.hoverIndex, 18, 'unselectable slots retain hover details');
    g.keyDown(key('Enter'));
    assert.deepEqual(g.calls, []);
    assert.match(g.status.textContent, /cannot be selected/);
  }
});

test('arrow navigation then Enter or Space works without optional hover callbacks', () => {
  for (const value of ['Enter', ' ']) {
    const g = grid();
    g.keyDown(key('ArrowRight'));
    assert.equal(g.hoverIndex, 18);
    assert.match(g.status.textContent, /1 of 1 participants/);
    g.keyDown(key(value));
    assert.deepEqual(g.calls, [['select', 18]]);
  }
});

test('mine mode retains touch and keyboard availability editing', () => {
  const touch = grid('mine');
  touch.pointerDown(pointer('touch'));
  touch.pointerUp(pointer('touch'));
  assert.deepEqual(touch.calls, [['commit', [18], true]]);

  const keyboard = grid('mine');
  keyboard.view.mine[18] = 1;
  keyboard.hoverIndex = 18;
  keyboard.keyDown(key(' '));
  assert.deepEqual(keyboard.calls, [['commit', [18], false]]);
});

test('a removed view safely ignores pending pointer and keyboard interactions', () => {
  const g = grid();
  g.pointerDown(pointer('mouse'));
  g.view = null;
  g.pointerUp(pointer('mouse'));
  g.keyDown(key('Enter'));
  g.pointerMove(pointer('mouse'));
  assert.deepEqual(g.calls, []);
});

test('a different pointer or release cell cannot select the original cell', () => {
  const g = grid();
  g.pointerDown(pointer('touch'));
  g.pointerUp(pointer('touch', { pointerId: 8 }));
  assert.deepEqual(g.calls, []);
  g.hitIndex = 19;
  g.pointerUp(pointer('touch'));
  assert.deepEqual(g.calls, []);
});
