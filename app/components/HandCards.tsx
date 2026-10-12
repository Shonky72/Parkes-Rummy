'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Trophy } from 'lucide-react';
import { playSound } from '@/lib/audio';
import { moveCard } from '@/lib/hand-order';
import { handInsertionAt, handVerticalNeighbour, type HandCardRect } from '@/lib/hand-geometry';
import type { Card, LayoffTarget } from '@/lib/types';

interface HandCardsProps {
  cards: Card[];
  selected: string[];
  roomKey: string;
  renderCard: (card: Card) => ReactNode;
  onSelect: (card: Card) => void;
  onReorder: (orderedIds: string[]) => void;
  onDragCardChange: (cardId: string | null) => void;
  onPlayCard: (cardId: string, target: Pick<LayoffTarget, 'meldId' | 'end'>) => void;
  onDiscardCard?: (cardId: string) => void;
}

interface Gesture {
  pointerId: number;
  pointerType: string;
  cardId: string;
  roomKey: string;
  button: HTMLButtonElement;
  mode: 'pending' | 'scroll' | 'page-scroll' | 'drag';
  startX: number;
  startY: number;
  x: number;
  y: number;
  lastY: number;
  startScroll: number;
  startedAt: number;
  timer: number | null;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

interface Marker { left: number; top: number; height: number }
type Drop =
  | { kind: 'hand'; beforeId: string | null; marker: Marker }
  | { kind: 'meld'; element: HTMLElement; target: Pick<LayoffTarget, 'meldId' | 'end'> }
  | { kind: 'discard'; element: HTMLElement }
  | null;
interface DragVisual { card: Card; width: number; height: number; transform: string }

const HOLD_TO_DRAG = 200;
const TOUCH_MOVE_THRESHOLD = 8;
const MOUSE_MOVE_THRESHOLD = 6;
const SUIT_NAMES = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };

function cardName(card: Card): string {
  const rank = ({ 2: 'Two', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' } as Record<number, string>)[card.rank] ?? String(card.rank);
  return `${rank} of ${SUIT_NAMES[card.suit]}${card.rank === 2 ? ', wild' : ''}`;
}

function enabledTarget(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') !== 'true'
    && !(element instanceof HTMLButtonElement && element.disabled);
}

function meldDrop(element: HTMLElement): Drop {
  if (!enabledTarget(element)) return null;
  const meldId = element.dataset.meldId;
  const end = element.dataset.meldEnd;
  return meldId && (end === 'start' || end === 'end')
    ? { kind: 'meld', element, target: { meldId, end } }
    : null;
}

function cardRects(strip: HTMLDivElement): HandCardRect[] {
  return Array.from(strip.querySelectorAll<HTMLButtonElement>('[data-hand-card]'), button => {
    const rect = button.getBoundingClientRect();
    return { id: button.dataset.handCard!, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
}

/** Rendered endpoints support both assisted and manual play. Submission validates the move. */
function findDrop(gesture: Gesture, strip: HTMLDivElement | null, allowDiscard: boolean): Drop {
  const hit = document.elementFromPoint(gesture.x, gesture.y);
  if (hit instanceof Element) {
    const exact = hit.closest<HTMLElement>('[data-meld-target][data-meld-id][data-meld-end]');
    if (exact) return meldDrop(exact);

    const meld = hit.closest<HTMLElement>('[data-meld-id]');
    if (meld) {
      const options = Array.from(meld.querySelectorAll<HTMLElement>('[data-meld-target][data-meld-id][data-meld-end]'))
        .filter(enabledTarget);
      if (options.length === 1) return meldDrop(options[0]);
    }

    const discard = allowDiscard ? hit.closest<HTMLElement>('[data-discard-target]') : null;
    if (discard) return { kind: 'discard', element: discard };
  }

  if (!strip) return null;
  const bounds = strip.getBoundingClientRect();
  if (gesture.x < bounds.left - 12 || gesture.x > bounds.right + 12 || gesture.y < bounds.top - 18 || gesture.y > bounds.bottom + 14) return null;
  const insertion = handInsertionAt(cardRects(strip), gesture.cardId, gesture);
  if (!insertion) return null;
  return {
    kind: 'hand', beforeId: insertion.beforeId,
    marker: {
      ...insertion.marker,
      left: Math.max(bounds.left + 2, Math.min(bounds.right - 3, insertion.marker.left)),
    },
  };
}

function ghostTransform(gesture: Gesture): string {
  const lift = gesture.pointerType === 'mouse' ? 0 : 25;
  return `translate3d(${gesture.x - gesture.offsetX}px, ${gesture.y - gesture.offsetY - lift}px, 0) rotate(-3deg) scale(1.035)`;
}

function edgeSpeed(position: number, start: number, end: number, edge: number, maximum: number): number {
  if (position < start || position > end) return 0;
  if (position < start + edge) return -maximum * Math.min(1, (start + edge - position) / edge);
  if (position > end - edge) return maximum * Math.min(1, (position - end + edge) / edge);
  return 0;
}

/** Reach off-screen melds while a pointer is captured by the fixed mobile hand. */
function scrollDragEdges(gesture: Gesture, strip: HTMLDivElement | null, elapsed: number): void {
  const factor = Math.min(32, Math.max(0, elapsed)) / 16;
  const handBounds = strip?.getBoundingClientRect();
  const overHand = !!handBounds && gesture.y >= handBounds.top - 20 && gesture.y <= handBounds.bottom + 16;
  if (strip && handBounds && overHand) {
    strip.scrollLeft += edgeSpeed(gesture.x, handBounds.left - 10, handBounds.right + 10, 42, 11) * factor;
    return;
  }

  let element = document.elementFromPoint(gesture.x, gesture.y);
  while (element instanceof HTMLElement && element !== document.body) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    let scrolled = false;
    if (element.scrollWidth > element.clientWidth + 1 && /(auto|scroll)/.test(style.overflowX)) {
      const before = element.scrollLeft;
      element.scrollLeft += edgeSpeed(gesture.x, Math.max(0, rect.left), Math.min(window.innerWidth, rect.right), 45, 10) * factor;
      scrolled ||= element.scrollLeft !== before;
    }
    if (element.scrollHeight > element.clientHeight + 1 && /(auto|scroll)/.test(style.overflowY)) {
      const before = element.scrollTop;
      element.scrollTop += edgeSpeed(gesture.y, Math.max(0, rect.top), Math.min(window.innerHeight, rect.bottom), 58, 10) * factor;
      scrolled ||= element.scrollTop !== before;
    }
    if (scrolled) return;
    element = element.parentElement;
  }

  const dock = strip?.closest<HTMLElement>('.your-hand');
  const bottom = dock && getComputedStyle(dock).position === 'fixed'
    ? Math.min(window.innerHeight, dock.getBoundingClientRect().top)
    : window.innerHeight;
  const speed = edgeSpeed(gesture.y, 0, bottom, 65, 11) * factor;
  if (speed) window.scrollBy({ top: speed, behavior: 'instant' });
}

export default function HandCards(props: HandCardsProps) {
  const { cards, selected, roomKey, renderCard } = props;
  const instructionsId = useId();
  const latest = useRef(props);
  latest.current = props;
  const stripRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const ignoreClickRef = useRef(false);
  const keyboardScrollRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef<HTMLElement | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const layoutRef = useRef<{ roomKey: string; positions: Map<string, { left: number; top: number }> }>({ roomKey, positions: new Map() });
  const animationsRef = useRef(new Map<HTMLElement, Animation>());
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null);
  const [marker, setMarker] = useState<Marker | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const showDrop = useCallback((drop: Drop) => {
    const element = drop?.kind === 'meld' || drop?.kind === 'discard' ? drop.element : null;
    if (hoverRef.current !== element) {
      hoverRef.current?.removeAttribute('data-card-drag-over');
      element?.setAttribute('data-card-drag-over', 'true');
      hoverRef.current = element;
    }
    const next = drop?.kind === 'hand' ? drop.marker : null;
    const prior = markerRef.current;
    if (prior?.left !== next?.left || prior?.top !== next?.top || prior?.height !== next?.height) {
      markerRef.current = next;
      setMarker(next);
    }
  }, []);

  const finishGesture = useCallback((render = true) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.timer !== null && gesture?.timer !== undefined) window.clearTimeout(gesture.timer);
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    hoverRef.current?.removeAttribute('data-card-drag-over');
    hoverRef.current = null;
    markerRef.current = null;
    if (gesture?.button.hasPointerCapture(gesture.pointerId)) {
      try { gesture.button.releasePointerCapture(gesture.pointerId); } catch { /* A cancelled pointer may already be gone. */ }
    }
    if (gesture?.mode === 'drag') latest.current.onDragCardChange(null);
    if (render) {
      setDragVisual(null);
      setMarker(null);
    }
  }, []);

  const updateDrag = useCallback((): Drop => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.mode !== 'drag') return null;
    if (ghostRef.current) ghostRef.current.style.transform = ghostTransform(gesture);
    const drop = findDrop(gesture, stripRef.current, !!latest.current.onDiscardCard);
    showDrop(drop);
    return drop;
  }, [showDrop]);

  const beginDrag = useCallback((gesture: Gesture) => {
    if (gestureRef.current !== gesture || gesture.mode !== 'pending') return;
    const card = latest.current.cards.find(held => held.id === gesture.cardId);
    if (!card) { finishGesture(); return; }
    if (gesture.timer !== null) window.clearTimeout(gesture.timer);
    gesture.timer = null;
    gesture.mode = 'drag';
    latest.current.onDragCardChange(card.id);
    setDragVisual({ card, width: gesture.width, height: gesture.height, transform: ghostTransform(gesture) });
    setAnnouncement(`${cardName(card)} lifted. Move within your hand, onto a set, or onto a run end. Escape cancels.`);
    updateDrag();
    let previous = performance.now();
    const frame = (now: number) => {
      const active = gestureRef.current;
      if (!active || active.mode !== 'drag' || document.visibilityState === 'hidden') return;
      scrollDragEdges(active, stripRef.current, now - previous);
      previous = now;
      updateDrag();
      frameRef.current = requestAnimationFrame(frame);
    };
    frameRef.current = requestAnimationFrame(frame);
  }, [finishGesture, updateDrag]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, card: Card) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (gestureRef.current) finishGesture();
    ignoreClickRef.current = false;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const rect = event.currentTarget.getBoundingClientRect();
    const gesture: Gesture = {
      pointerId: event.pointerId, pointerType: event.pointerType || 'mouse', cardId: card.id,
      roomKey: latest.current.roomKey, button: event.currentTarget, mode: 'pending',
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      lastY: event.clientY, startScroll: stripRef.current?.scrollLeft ?? 0,
      startedAt: performance.now(), timer: null,
      width: rect.width, height: rect.height, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
    };
    gestureRef.current = gesture;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture may be unavailable for an already released pointer. */ }
    if (gesture.pointerType !== 'mouse') {
      gesture.timer = window.setTimeout(() => beginDrag(gesture), HOLD_TO_DRAG);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    const dx = gesture.x - gesture.startX;
    const dy = gesture.y - gesture.startY;
    if (gesture.mode === 'pending') {
      if (gesture.pointerType === 'mouse') {
        if (Math.hypot(dx, dy) >= MOUSE_MOVE_THRESHOLD) beginDrag(gesture);
      } else if (Math.hypot(dx, dy) >= TOUCH_MOVE_THRESHOLD) {
        if (performance.now() - gesture.startedAt >= HOLD_TO_DRAG) beginDrag(gesture);
        else {
          if (gesture.timer !== null) window.clearTimeout(gesture.timer);
          gesture.timer = null;
          const horizontalScroll = stripRef.current
            && stripRef.current.scrollWidth > stripRef.current.clientWidth + 1;
          gesture.mode = horizontalScroll && Math.abs(dx) >= Math.abs(dy) ? 'scroll' : 'page-scroll';
        }
      }
    }
    if (gesture.mode === 'scroll' && stripRef.current) stripRef.current.scrollLeft = gesture.startScroll - dx;
    if (gesture.mode === 'page-scroll') window.scrollBy({ top: gesture.lastY - gesture.y, behavior: 'instant' });
    if (gesture.mode === 'drag') updateDrag();
    gesture.lastY = gesture.y;
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    const card = latest.current.cards.find(held => held.id === gesture.cardId);
    const drop = gesture.mode === 'drag' ? updateDrag() : null;
    const mode = gesture.mode;
    ignoreClickRef.current = true;
    finishGesture();
    if (!card || gesture.roomKey !== latest.current.roomKey) return;
    if (mode === 'pending') {
      playSound('select');
      latest.current.onSelect(card);
    } else if (mode === 'drag') {
      if (drop?.kind === 'hand') {
        const current = latest.current.cards.map(held => held.id);
        const next = moveCard(current, card.id, drop.beforeId);
        if (next.some((id, index) => id !== current[index])) latest.current.onReorder(next);
        setAnnouncement(`${cardName(card)} at position ${next.indexOf(card.id) + 1} of ${next.length}.`);
      } else if (drop?.kind === 'meld') {
        latest.current.onPlayCard(card.id, drop.target);
        setAnnouncement(`Placement requested for ${cardName(card)}.`);
      } else if (drop?.kind === 'discard') {
        latest.current.onDiscardCard?.(card.id);
        setAnnouncement(`Discard requested for ${cardName(card)}.`);
      } else setAnnouncement(`${cardName(card)} returned to your hand.`);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, card: Card) => {
    if (event.key === 'Enter' || event.key === ' ') ignoreClickRef.current = false;
    if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    finishGesture();
    const current = latest.current.cards.map(held => held.id);
    const index = current.indexOf(card.id);
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    const neighbour = vertical && stripRef.current
      ? handVerticalNeighbour(cardRects(stripRef.current), card.id, event.key === 'ArrowUp' ? -1 : 1)
      : null;
    const destination = vertical ? current.indexOf(neighbour ?? '') : index + (event.key === 'ArrowLeft' ? -1 : 1);
    if (index < 0 || destination < 0 || destination >= current.length) return;
    const before = destination < index ? current[destination] : current[destination + 1] ?? null;
    keyboardScrollRef.current = card.id;
    latest.current.onReorder(moveCard(current, card.id, before));
    playSound('select');
    setAnnouncement(`${cardName(card)} moved to position ${destination + 1} of ${current.length}.`);
  };

  useEffect(() => {
    const gesture = gestureRef.current;
    if (gesture && (gesture.roomKey !== roomKey || !cards.some(card => card.id === gesture.cardId))) finishGesture();
  }, [cards, roomKey, finishGesture]);

  useEffect(() => {
    const cancel = () => finishGesture();
    const visibility = () => { if (document.visibilityState === 'hidden') cancel(); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && gestureRef.current) {
        event.preventDefault();
        cancel();
        setAnnouncement('Card movement cancelled. Your hand is unchanged.');
      }
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', cancel);
      finishGesture(false);
      for (const animation of animationsRef.current.values()) animation.cancel();
      animationsRef.current.clear();
    };
  }, [finishGesture]);

  const orderKey = cards.map(card => card.id).join('|');
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const prior = layoutRef.current;
    const positions = new Map<string, { left: number; top: number }>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let incoming: HTMLButtonElement | null = null;
    let keyboardMoved: HTMLButtonElement | null = null;
    for (const element of strip.querySelectorAll<HTMLButtonElement>('[data-hand-card]')) {
      const id = element.dataset.handCard!;
      const position = { left: element.offsetLeft, top: element.offsetTop };
      positions.set(id, position);
      const before = prior.roomKey === roomKey ? prior.positions.get(id) : undefined;
      if (!before && prior.roomKey === roomKey && prior.positions.size) incoming = element;
      if (id === keyboardScrollRef.current) keyboardMoved = element;
      animationsRef.current.get(element)?.cancel();
      if (before && !reduced && typeof element.animate === 'function') {
        const dx = before.left - position.left;
        const dy = before.top - position.top;
        if (dx || dy) {
          const animation = element.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.3,1)' });
          animationsRef.current.set(element, animation);
          const clear = () => { if (animationsRef.current.get(element) === animation) animationsRef.current.delete(element); };
          void animation.finished.then(clear, clear);
        }
      }
    }
    layoutRef.current = { roomKey, positions };
    keyboardScrollRef.current = null;
    // Reveal a draw within the hand strip only. Polls and pointer reorders keep the current view.
    const reveal = incoming ?? keyboardMoved;
    if (getComputedStyle(strip).display === 'grid') {
      strip.scrollLeft = 0;
      strip.scrollTop = 0;
    } else if (reveal && !gestureRef.current) {
      const left = reveal.offsetLeft;
      const right = left + reveal.offsetWidth;
      if (right > strip.scrollLeft + strip.clientWidth - 4) strip.scrollLeft = right - strip.clientWidth + 4;
      else if (left < strip.scrollLeft + 4) strip.scrollLeft = Math.max(0, left - 4);
    }
  }, [orderKey, roomKey]);

  return <div className={`hand-tray${dragVisual ? ' hand-is-dragging' : ''}`} style={{
    '--hand-grid-columns': cards.length > 10 ? Math.ceil(cards.length / 2) : 5,
    '--hand-visible-count': Math.max(1, cards.length),
  } as CSSProperties}>
    <div className="hand-cards" ref={stripRef} data-hand-drop-zone="" data-hand-room-key={roomKey} role="group" aria-label="Your cards" aria-describedby={instructionsId}>
      {cards.map(card => <button
        type="button"
        key={card.id}
        className={`hand-card${selected.includes(card.id) ? ' selected' : ''}${dragVisual?.card.id === card.id ? ' is-dragging' : ''}`}
        data-hand-card={card.id}
        data-sound="none"
        draggable={false}
        aria-label={`${cardName(card)}${selected.includes(card.id) ? ', selected' : ''}`}
        aria-pressed={selected.includes(card.id)}
        aria-describedby={instructionsId}
        title="Tap to select. Hold to move. Alt + arrow keys rearrange."
        onPointerDown={event => onPointerDown(event, card)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { ignoreClickRef.current = true; finishGesture(); }}
        onLostPointerCapture={event => { if (gestureRef.current?.pointerId === event.pointerId) finishGesture(); }}
        onContextMenu={event => event.preventDefault()}
        onDragStart={event => event.preventDefault()}
        onKeyDown={event => onKeyDown(event, card)}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          // Pointer taps are handled on release. Keyboard and assistive clicks have no pointer detail.
          if (ignoreClickRef.current) { ignoreClickRef.current = false; return; }
          if (event.detail === 0 && !gestureRef.current) {
            playSound('select');
            latest.current.onSelect(card);
          }
        }}
      >{renderCard(card)}{selected.includes(card.id) && <span className="hand-selection-tick" aria-hidden="true">✓</span>}</button>)}
      {!cards.length && <span className="hand-empty-message"><Trophy size={28}/>All cards played!</span>}
    </div>
    {!!cards.length && <div className="hand-gesture-hint" aria-hidden="true"><span className="hand-mouse-hint">Drag to arrange or play</span><span className="hand-touch-hint">Tap to select · Hold to move</span></div>}
    <span className="hand-visually-hidden" id={instructionsId}>Tap a card to select. Hold a card briefly, then drag to rearrange your hand or play onto a set, a run end or the discard pile. With hints off, choose a set or a specific run end yourself. With a card focused, Alt plus Left or Right Arrow moves the card within your hand. Alt plus Up or Down Arrow moves between rows.</span>
    <span className="hand-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    {dragVisual && typeof document !== 'undefined' && createPortal(<div
      ref={ghostRef}
      className="hand-drag-ghost hand-card"
      aria-hidden="true"
      style={{ width: dragVisual.width, height: dragVisual.height, minWidth: dragVisual.width, maxWidth: dragVisual.width, transform: dragVisual.transform } as CSSProperties}
    >{renderCard(dragVisual.card)}</div>, document.body)}
    {marker && typeof document !== 'undefined' && createPortal(<div className="hand-drop-line" aria-hidden="true" style={marker}/>, document.body)}
  </div>;
}
