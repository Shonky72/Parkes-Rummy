// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { handInsertionAt } from './hand-geometry.ts';
import type { HandCardRect, HandInsertion } from './hand-geometry';

export type DrawCardSource = 'stock' | 'discard';
export interface DrawCardPlacement { beforeId: string | null; roomKey: string }
export type DrawGestureMode = 'pending' | 'scroll' | 'drag' | 'cancelled';
export interface DrawCardGesture {
  source: DrawCardSource;
  roomKey: string;
  pointerId: number;
  pointerType: string;
  mode: DrawGestureMode;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startedAt: number;
}
export interface DrawGestureContext {
  source: DrawCardSource;
  roomKey: string;
  disabled: boolean;
  visible?: boolean;
}
export const DRAW_HOLD_MS = 200;
export const DRAW_MOUSE_THRESHOLD = 6;
export const DRAW_TOUCH_THRESHOLD = 8;

/** Pointer releases own their draw; the browser's following click must not repeat it. */
export function createDrawActivationGate() {
  let suppressClick = false;
  return {
    pointerStarted() { suppressClick = false; },
    pointerFinished() { suppressClick = true; },
    keyboardStarted(repeat: boolean): boolean {
      if (repeat) return false;
      suppressClick = false;
      return true;
    },
    acceptClick(detail: number): boolean {
      if (suppressClick) { suppressClick = false; return false; }
      return detail === 0;
    },
  };
}

export function beginDrawGesture(input: DrawGestureContext & {
  pointerId: number; pointerType: string; isPrimary: boolean; button: number;
  x: number; y: number; now: number;
}): DrawCardGesture | null {
  if (input.disabled || input.visible === false || !input.roomKey || !input.isPrimary || input.button !== 0) return null;
  return {
    source: input.source, roomKey: input.roomKey, pointerId: input.pointerId,
    pointerType: input.pointerType || 'mouse', mode: 'pending',
    startX: input.x, startY: input.y, x: input.x, y: input.y, startedAt: input.now,
  };
}

/** Early touch movement is scrolling for the rest of this gesture, never a draw. */
export function moveDrawGesture(gesture: DrawCardGesture, x: number, y: number): DrawCardGesture {
  let mode = gesture.mode;
  if (mode === 'pending') {
    const distance = Math.hypot(x - gesture.startX, y - gesture.startY);
    if (gesture.pointerType === 'mouse' && distance >= DRAW_MOUSE_THRESHOLD) mode = 'drag';
    else if (gesture.pointerType !== 'mouse' && distance >= DRAW_TOUCH_THRESHOLD) mode = 'scroll';
  }
  return { ...gesture, x, y, mode };
}

export function holdDrawGesture(gesture: DrawCardGesture, now: number): DrawCardGesture {
  return gesture.mode === 'pending' && gesture.pointerType !== 'mouse' && now - gesture.startedAt >= DRAW_HOLD_MS
    ? { ...gesture, mode: 'drag' } : gesture;
}

export function cancelDrawGesture(gesture: DrawCardGesture): DrawCardGesture {
  return { ...gesture, mode: 'cancelled' };
}

export function drawGestureIsCurrent(gesture: DrawCardGesture, current: DrawGestureContext): boolean {
  return !current.disabled && current.visible !== false && gesture.mode !== 'cancelled'
    && current.roomKey === gesture.roomKey && current.source === gesture.source;
}

/** Use an external identity so none of the ten held cards is excluded as the drag source. */
export function drawHandInsertionAt(
  cards: readonly HandCardRect[],
  bounds: { left: number; top: number; width: number; height: number },
  point: { x: number; y: number },
): HandInsertion | null {
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  if (![bounds.left, bounds.top, bounds.width, bounds.height, point.x, point.y].every(Number.isFinite)
    || bounds.width < 6 || bounds.height <= 0 || point.x < bounds.left || point.x > right || point.y < bounds.top || point.y > bottom) return null;
  const insertion = handInsertionAt(cards, '__external_draw_card__', point);
  return insertion ? {
    beforeId: insertion.beforeId,
    marker: { ...insertion.marker, left: Math.max(bounds.left + 2, Math.min(right - 3, insertion.marker.left)) },
  } : null;
}

export type DrawGestureResult = { kind: 'tap' } | { kind: 'drop'; placement: DrawCardPlacement } | null;

/** One decision on release; invalid/cancelled drags never fall back to a tap draw. */
export function finishDrawGesture(
  gesture: DrawCardGesture,
  current: DrawGestureContext,
  insertion: HandInsertion | null,
  releasedOnButton: boolean,
): DrawGestureResult {
  if (!drawGestureIsCurrent(gesture, current)) return null;
  if (gesture.mode === 'pending') return releasedOnButton ? { kind: 'tap' } : null;
  if (gesture.mode !== 'drag' || !insertion) return null;
  return { kind: 'drop', placement: { beforeId: insertion.beforeId, roomKey: gesture.roomKey } };
}
