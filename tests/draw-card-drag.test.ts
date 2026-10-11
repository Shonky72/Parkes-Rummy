import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { beginDrawGesture, cancelDrawGesture, createDrawActivationGate, drawHandInsertionAt, finishDrawGesture, holdDrawGesture, moveDrawGesture } from '../lib/draw-card-drag.ts';
import type { DrawCardGesture, DrawCardSource, DrawGestureContext } from '../lib/draw-card-drag';
import type { HandCardRect } from '../lib/hand-geometry';

const current = (source: DrawCardSource = 'stock'): DrawGestureContext => ({ source, roomKey: 'ABCD:1:4:seat:9:playing', disabled: false, visible: true });
const begin = (pointerType = 'mouse', source: DrawCardSource = 'stock'): DrawCardGesture => beginDrawGesture({ ...current(source), pointerId: 7, pointerType, isPrimary: true, button: 0, x: 20, y: 100, now: 1000 })!;
const held = (source: DrawCardSource = 'stock') => holdDrawGesture(begin('touch', source), 1200);
const grid = (count = 10, columns = 5, lift: string[] = []): HandCardRect[] => Array.from({ length: count }, (_, index) => ({
  id: `card-${index + 1}`, left: 11 + (index % columns) * 65,
  top: 500 + Math.floor(index / columns) * 84 - (lift.includes(`card-${index + 1}`) ? 2 : 0), width: 59, height: 76,
}));
const bounds = { left: 8, top: 488, width: 330, height: 182 };
const slot = () => drawHandInsertionAt(grid(), bounds, { x: 98, y: 625 })!;

test('both draw sources support one normal pointer tap without an insertion request', () => {
  for (const source of ['stock', 'discard'] as const) {
    assert.deepEqual(finishDrawGesture(begin('mouse', source), current(source), null, true), { kind: 'tap' });
    assert.deepEqual(finishDrawGesture(begin('touch', source), current(source), null, true), { kind: 'tap' });
    assert.equal(finishDrawGesture(begin('mouse', source), current(source), null, false), null);
  }
});

test('mouse drags start at six pixels and preserve source and turn identity', () => {
  const gesture = begin();
  assert.equal(moveDrawGesture(gesture, 25, 100).mode, 'pending');
  const dragging = moveDrawGesture(gesture, 26, 100);
  assert.equal(dragging.mode, 'drag');
  assert.deepEqual(finishDrawGesture(dragging, current(), slot(), false), {
    kind: 'drop', placement: { beforeId: 'card-7', roomKey: current().roomKey },
  });
  assert.equal(gesture.mode, 'pending', 'Transition helpers leave earlier state intact');
});

test('touch and pen require a 200ms stationary hold while mouse holds remain taps', () => {
  for (const pointerType of ['touch', 'pen']) {
    const gesture = begin(pointerType);
    assert.equal(holdDrawGesture(gesture, 1199).mode, 'pending');
    assert.equal(holdDrawGesture(gesture, 1200).mode, 'drag');
  }
  assert.equal(holdDrawGesture(begin('mouse'), 5000).mode, 'pending');
});

test('early touch movement becomes scrolling permanently and never turns into a delayed draw', () => {
  const pending = begin('touch');
  assert.equal(moveDrawGesture(pending, 27, 100).mode, 'pending');
  const scrolling = moveDrawGesture(pending, 20, 108);
  assert.equal(scrolling.mode, 'scroll');
  const late = holdDrawGesture(moveDrawGesture(scrolling, 98, 625), 5000);
  assert.equal(late.mode, 'scroll');
  assert.equal(finishDrawGesture(late, current(), slot(), true), null);
  assert.equal(finishDrawGesture(late, current(), null, true), null);
});

test('a held card dropped outside the hand is cancelled, even when released back on its pile', () => {
  for (const source of ['stock', 'discard'] as const) {
    assert.equal(finishDrawGesture(held(source), current(source), null, false), null);
    assert.equal(finishDrawGesture(held(source), current(source), null, true), null);
  }
});

test('Escape, lost capture, blur, hidden, and unmount cancellation never fall back to a tap', () => {
  for (const gesture of [begin(), begin('touch'), held(), moveDrawGesture(begin('touch'), 40, 100)]) {
    const cancelled = cancelDrawGesture(gesture);
    assert.equal(cancelled.mode, 'cancelled');
    assert.equal(finishDrawGesture(cancelled, current(), slot(), true), null);
    assert.equal(finishDrawGesture(moveDrawGesture(cancelled, 98, 625), current(), slot(), true), null);
    assert.equal(holdDrawGesture(cancelled, 5000).mode, 'cancelled');
  }
});

test('new turns, different tables, disabled piles and hidden pages reject stale drop requests', () => {
  for (const source of ['stock', 'discard'] as const) {
    for (const patch of [
      { disabled: true }, { visible: false }, { roomKey: 'OTHER:1:4:seat:9:playing' },
      { roomKey: 'ABCD:1:4:seat:10:playing' }, { source: source === 'stock' ? 'discard' as const : 'stock' as const },
    ]) {
      assert.equal(finishDrawGesture(held(source), { ...current(source), ...patch }, slot(), false), null);
      assert.equal(finishDrawGesture(begin('touch', source), { ...current(source), ...patch }, null, true), null);
    }
  }
});

test('secondary pointers, nonleft buttons and disabled sources never start a draw gesture', () => {
  const input = { ...current(), pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, x: 20, y: 100, now: 1000 };
  for (const patch of [{ isPrimary: false }, { button: 1 }, { button: 2 }, { disabled: true }, { visible: false }, { roomKey: '' }]) {
    assert.equal(beginDrawGesture({ ...input, ...patch }), null);
  }
});

test('mobile insertion targets either row and retains the row-one trailing slot', () => {
  const cards = grid();
  assert.equal(drawHandInsertionAt(cards, bounds, { x: 98, y: 540 })?.beforeId, 'card-2');
  assert.equal(drawHandInsertionAt(cards, bounds, { x: 98, y: 625 })?.beforeId, 'card-7');
  assert.equal(drawHandInsertionAt(cards, bounds, { x: 336, y: 540 })?.beforeId, 'card-6');
  assert.equal(drawHandInsertionAt(cards, bounds, { x: 336, y: 625 })?.beforeId, null);
});

test('external stock/discard cards never displace an existing card from insertion geometry', () => {
  const cards = grid(10, 5, ['card-1', 'card-3', 'card-6']);
  const before = structuredClone(cards);
  for (const source of ['stock', 'discard'] as const) {
    const insertion = drawHandInsertionAt(cards, bounds, { x: 15, y: 625 });
    assert.equal(insertion?.beforeId, 'card-6');
    assert.deepEqual(finishDrawGesture(held(source), current(source), insertion, false), {
      kind: 'drop', placement: { beforeId: 'card-6', roomKey: current(source).roomKey },
    });
  }
  assert.deepEqual(cards, before);
});

test('hand geometry rejects points outside its exact bounds or absent cards', () => {
  for (const point of [{ x: 7, y: 540 }, { x: 339, y: 540 }, { x: 98, y: 487 }, { x: 98, y: 671 }, { x: NaN, y: 540 }]) {
    assert.equal(drawHandInsertionAt(grid(), bounds, point), null);
  }
  assert.equal(drawHandInsertionAt([], bounds, { x: 98, y: 540 }), null);
  assert.equal(drawHandInsertionAt(grid(), { ...bounds, width: 0 }, { x: 98, y: 540 }), null);
});

test('desktop insertion retains all cards, clips the line to the strip and appends at its end', () => {
  const cards = grid(10, 10);
  const desktop = { left: 8, top: 488, width: 665, height: 100 };
  assert.equal(drawHandInsertionAt(cards, desktop, { x: 98, y: 540 })?.beforeId, 'card-2');
  assert.equal(drawHandInsertionAt(cards, desktop, { x: 665, y: 540 })?.beforeId, null);
  const leading = drawHandInsertionAt(cards, desktop, { x: 10, y: 540 });
  assert.equal(leading?.beforeId, 'card-1');
  assert.equal(leading?.marker.left, 10);
});

test('pointer release consumes the following synthetic click and fresh keyboard activation still draws', () => {
  const gate = createDrawActivationGate();
  gate.pointerStarted();
  assert.deepEqual(finishDrawGesture(begin(), current(), null, true), { kind: 'tap' });
  gate.pointerFinished();
  assert.equal(gate.acceptClick(1), false, 'The pointer tap already drew once');
  assert.equal(gate.acceptClick(2), false, 'Unsourced pointer clicks never draw');
  assert.equal(gate.keyboardStarted(false), true);
  assert.equal(gate.acceptClick(0), true, 'Enter/Space uses one native click');
  assert.equal(gate.keyboardStarted(true), false, 'Held keys suppress repeated native activation');
  gate.pointerStarted();
  gate.pointerFinished();
  assert.equal(gate.acceptClick(0), false, 'Cancelled drags also suppress synthetic clicks without pointer detail');
  assert.equal(gate.keyboardStarted(false), true);
  assert.equal(gate.acceptClick(0), true);
});

test('cancelling by Escape does not suppress the next deliberate keyboard draw', () => {
  const gate = createDrawActivationGate();
  gate.pointerStarted();
  gate.pointerFinished();
  assert.equal(gate.keyboardStarted(false), true);
  assert.equal(gate.acceptClick(0), true);
});
