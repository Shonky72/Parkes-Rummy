'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  beginDrawGesture, cancelDrawGesture, createDrawActivationGate, DRAW_HOLD_MS, drawGestureIsCurrent,
  drawHandInsertionAt, finishDrawGesture, holdDrawGesture, moveDrawGesture,
  type DrawCardGesture, type DrawCardPlacement, type DrawCardSource,
} from '../../lib/draw-card-drag';
import type { HandCardRect, HandInsertion } from '../../lib/hand-geometry';

export type { DrawCardPlacement } from '../../lib/draw-card-drag';

export interface DrawCardButtonProps {
  source: DrawCardSource;
  disabled: boolean;
  roomKey: string;
  className: string;
  ariaLabel: string;
  children: ReactNode;
  renderGhost: () => ReactNode;
  onDraw: (source: DrawCardSource, placement?: DrawCardPlacement) => void;
}

interface Gesture {
  state: DrawCardGesture;
  button: HTMLButtonElement;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  lastX: number;
  lastY: number;
  timer: number | null;
}
interface DragVisual { content: ReactNode; width: number; height: number; transform: string }

function matchingHand(roomKey: string): HTMLElement | null {
  const matches = Array.from(document.querySelectorAll<HTMLElement>('[data-hand-drop-zone][data-hand-room-key]'))
    .filter(zone => zone.dataset.handRoomKey === roomKey);
  return matches.length === 1 ? matches[0] : null;
}

function cardRects(zone: HTMLElement): HandCardRect[] {
  return Array.from(zone.querySelectorAll<HTMLElement>('[data-hand-card]'), card => {
    const bounds = card.getBoundingClientRect();
    return { id: card.dataset.handCard!, left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  });
}

function insertionFor(gesture: Gesture): HandInsertion | null {
  const zone = matchingHand(gesture.state.roomKey);
  if (!zone) return null;
  const hit = document.elementFromPoint(gesture.state.x, gesture.state.y);
  // Geometry alone must not accept a hand covered by a dialog or another pane.
  if (!(hit instanceof Element) || hit.closest('[data-hand-drop-zone]') !== zone) return null;
  return drawHandInsertionAt(cardRects(zone), zone.getBoundingClientRect(), gesture.state);
}

function ghostTransform(gesture: Gesture): string {
  const lift = gesture.state.pointerType === 'mouse' ? 0 : 25;
  return `translate3d(${gesture.state.x - gesture.offsetX}px, ${gesture.state.y - gesture.offsetY - lift}px, 0) rotate(-3deg) scale(1.035)`;
}

/** Match ordinary touch scrolling before the hold threshold instead of drawing. */
function scrollFromPile(gesture: Gesture): void {
  let dx = gesture.lastX - gesture.state.x;
  let dy = gesture.lastY - gesture.state.y;
  let element: HTMLElement | null = gesture.button.parentElement;
  while (element && element !== document.body && (dx || dy)) {
    const style = getComputedStyle(element);
    if (dx && element.scrollWidth > element.clientWidth + 1 && /(auto|scroll)/.test(style.overflowX)) {
      const before = element.scrollLeft;
      element.scrollLeft += dx;
      dx -= element.scrollLeft - before;
    }
    if (dy && element.scrollHeight > element.clientHeight + 1 && /(auto|scroll)/.test(style.overflowY)) {
      const before = element.scrollTop;
      element.scrollTop += dy;
      dy -= element.scrollTop - before;
    }
    element = element.parentElement;
  }
  if (dy) window.scrollBy({ top: dy, behavior: 'instant' });
}

function edgeSpeed(point: number, start: number, end: number, edge: number, speed: number): number {
  if (point < start || point > end) return 0;
  if (point < start + edge) return -speed * Math.min(1, (start + edge - point) / edge);
  if (point > end - edge) return speed * Math.min(1, (point - end + edge) / edge);
  return 0;
}

function scrollDragEdges(gesture: Gesture, elapsed: number): void {
  const zone = matchingHand(gesture.state.roomKey);
  if (!zone) return;
  const bounds = zone.getBoundingClientRect();
  const factor = Math.max(0, Math.min(32, elapsed)) / 16;
  if (gesture.state.y >= bounds.top && gesture.state.y <= bounds.bottom) {
    if (zone.scrollWidth > zone.clientWidth + 1) zone.scrollLeft += edgeSpeed(gesture.state.x, bounds.left, bounds.right, 36, 9) * factor;
    return;
  }
  const dock = zone.closest<HTMLElement>('.your-hand');
  const bottom = dock && getComputedStyle(dock).position === 'fixed'
    ? Math.min(window.innerHeight, dock.getBoundingClientRect().top) : window.innerHeight;
  const speed = edgeSpeed(gesture.state.y, 0, bottom, 48, 8) * factor;
  if (speed) window.scrollBy({ top: speed, behavior: 'instant' });
}

export default function DrawCardButton(props: DrawCardButtonProps) {
  const latest = useRef(props);
  latest.current = props;
  const gestureRef = useRef<Gesture | null>(null);
  const activationRef = useRef<ReturnType<typeof createDrawActivationGate> | null>(null);
  if (!activationRef.current) activationRef.current = createDrawActivationGate();
  const frameRef = useRef<number | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HandInsertion['marker'] | null>(null);
  const [visual, setVisual] = useState<DragVisual | null>(null);
  const [marker, setMarker] = useState<HandInsertion['marker'] | null>(null);

  const currentContext = useCallback(() => ({
    source: latest.current.source, roomKey: latest.current.roomKey,
    disabled: latest.current.disabled,
    visible: !document.hidden && !document.querySelector('.modal-backdrop'),
  }), []);

  const clearGesture = useCallback((render = true) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.timer !== null && gesture?.timer !== undefined) window.clearTimeout(gesture.timer);
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    markerRef.current = null;
    if (gesture?.button.hasPointerCapture(gesture.state.pointerId)) {
      try { gesture.button.releasePointerCapture(gesture.state.pointerId); } catch { /* Capture already ended. */ }
    }
    if (render) { setVisual(null); setMarker(null); }
  }, []);

  const cancelGesture = useCallback((render = true) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    activationRef.current!.pointerFinished();
    gesture.state = cancelDrawGesture(gesture.state);
    clearGesture(render);
  }, [clearGesture]);

  const updateDrag = useCallback((): HandInsertion | null => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.state.mode !== 'drag') return null;
    if (!drawGestureIsCurrent(gesture.state, currentContext())) { cancelGesture(); return null; }
    if (ghostRef.current) ghostRef.current.style.transform = ghostTransform(gesture);
    const insertion = insertionFor(gesture);
    const next = insertion?.marker ?? null;
    const prior = markerRef.current;
    if (prior?.left !== next?.left || prior?.top !== next?.top || prior?.height !== next?.height) {
      markerRef.current = next;
      setMarker(next);
    }
    return insertion;
  }, [cancelGesture, currentContext]);

  const lift = useCallback((gesture: Gesture) => {
    if (gestureRef.current !== gesture || gesture.state.mode !== 'drag') return;
    if (!drawGestureIsCurrent(gesture.state, currentContext()) || !matchingHand(gesture.state.roomKey)) { cancelGesture(); return; }
    if (gesture.timer !== null) window.clearTimeout(gesture.timer);
    gesture.timer = null;
    activationRef.current!.pointerFinished();
    setVisual({ content: latest.current.renderGhost(), width: gesture.width, height: gesture.height, transform: ghostTransform(gesture) });
    updateDrag();
    let previous = performance.now();
    const frame = (now: number) => {
      const active = gestureRef.current;
      if (!active || active.state.mode !== 'drag') return;
      if (!drawGestureIsCurrent(active.state, currentContext())) { cancelGesture(); return; }
      scrollDragEdges(active, now - previous);
      previous = now;
      updateDrag();
      if (gestureRef.current === active) frameRef.current = requestAnimationFrame(frame);
    };
    frameRef.current = requestAnimationFrame(frame);
  }, [cancelGesture, currentContext, updateDrag]);

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (gestureRef.current) { cancelGesture(); return; }
    const state = beginDrawGesture({ ...currentContext(), pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary, button: event.button, x: event.clientX, y: event.clientY, now: performance.now() });
    if (!state) return;
    activationRef.current!.pointerStarted();
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const bounds = event.currentTarget.getBoundingClientRect();
    const gesture: Gesture = {
      state, button: event.currentTarget, width: bounds.width, height: bounds.height,
      offsetX: state.x - bounds.left, offsetY: state.y - bounds.top,
      lastX: state.x, lastY: state.y, timer: null,
    };
    gestureRef.current = gesture;
    try { event.currentTarget.setPointerCapture(state.pointerId); } catch { /* Window listeners cover unavailable capture. */ }
    const held = () => {
      if (gestureRef.current !== gesture) return;
      const now = performance.now();
      const remaining = DRAW_HOLD_MS - (now - gesture.state.startedAt);
      if (remaining > 0) { gesture.timer = window.setTimeout(held, Math.ceil(remaining)); return; }
      gesture.state = holdDrawGesture(gesture.state, now);
      lift(gesture);
    };
    if (state.pointerType !== 'mouse') gesture.timer = window.setTimeout(held, DRAW_HOLD_MS);
  };

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.state.pointerId !== event.pointerId) return;
      if (!drawGestureIsCurrent(gesture.state, currentContext())) { cancelGesture(); return; }
      event.preventDefault();
      const mode = gesture.state.mode;
      gesture.state = moveDrawGesture(gesture.state, event.clientX, event.clientY);
      if (gesture.state.mode === 'scroll') {
        activationRef.current!.pointerFinished();
        if (gesture.timer !== null) window.clearTimeout(gesture.timer);
        gesture.timer = null;
        scrollFromPile(gesture);
      } else if (mode !== 'drag' && gesture.state.mode === 'drag') lift(gesture);
      else if (gesture.state.mode === 'drag') updateDrag();
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
    };
    const release = (event: globalThis.PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.state.pointerId !== event.pointerId) return;
      event.preventDefault();
      // Apply a final unreported move too. A swipe ending outside the pile must
      // never become a tap merely because no pointermove reached this frame.
      gesture.state = moveDrawGesture(gesture.state, event.clientX, event.clientY);
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const insertion = gesture.state.mode === 'drag' ? insertionFor(gesture) : null;
      const result = finishDrawGesture(gesture.state, currentContext(), insertion, hit instanceof Node && gesture.button.contains(hit));
      activationRef.current!.pointerFinished();
      clearGesture();
      if (result) latest.current.onDraw(gesture.state.source, result.kind === 'drop' ? result.placement : undefined);
    };
    const cancelled = (event: globalThis.PointerEvent) => { if (gestureRef.current?.state.pointerId === event.pointerId) cancelGesture(); };
    const secondPointer = (event: globalThis.PointerEvent) => { if (gestureRef.current && gestureRef.current.state.pointerId !== event.pointerId) cancelGesture(); };
    const blur = () => cancelGesture();
    const hidden = () => { if (document.hidden) cancelGesture(); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && gestureRef.current) { event.preventDefault(); cancelGesture(); }
    };
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', release, { capture: true, passive: false });
    window.addEventListener('pointercancel', cancelled, true);
    window.addEventListener('pointerdown', secondPointer, true);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', cancelled, true);
      window.removeEventListener('pointerdown', secondPointer, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('keydown', escape);
      cancelGesture(false);
    };
  }, [cancelGesture, clearGesture, currentContext, lift, updateDrag]);

  useLayoutEffect(() => {
    const gesture = gestureRef.current;
    if (gesture && !drawGestureIsCurrent(gesture.state, currentContext())) cancelGesture();
  }, [props.disabled, props.roomKey, props.source, cancelGesture, currentContext]);

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (gestureRef.current || !activationRef.current!.keyboardStarted(event.repeat)) { event.preventDefault(); cancelGesture(); }
  };

  return <>
    <button type="button" className={`${props.className} draw-card-button${visual ? ' draw-card-is-dragging' : ''}`} disabled={props.disabled} aria-label={props.ariaLabel} title="Tap to draw. Hold and drag to choose a place in your hand."
      data-pile={props.source} data-sound="none" draggable={false}
      onPointerDown={pointerDown}
      onLostPointerCapture={event => { if (gestureRef.current?.state.pointerId === event.pointerId) cancelGesture(); }}
      onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()} onKeyDown={keyDown}
      onClick={event => {
        event.preventDefault(); event.stopPropagation();
        if (activationRef.current!.acceptClick(event.detail) && !gestureRef.current && !latest.current.disabled && currentContext().visible) latest.current.onDraw(latest.current.source);
      }}
    >{props.children}</button>
    {visual && typeof document !== 'undefined' && createPortal(<div ref={ghostRef} className="draw-card-drag-ghost" aria-hidden="true" style={{ width: visual.width, height: visual.height, transform: visual.transform } as CSSProperties}>{visual.content}</div>, document.body)}
    {marker && typeof document !== 'undefined' && createPortal(<div className="hand-drop-line draw-card-drop-line" aria-hidden="true" style={marker}/>, document.body)}
  </>;
}
