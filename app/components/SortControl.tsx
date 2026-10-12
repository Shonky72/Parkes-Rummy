'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpDown, Check } from 'lucide-react';
import type { HandSort, HandSortMode } from '../../lib/client';

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;
const OPTIONS: { mode: HandSortMode; label: string; description: string }[] = [
  { mode: 'number', label: 'By number', description: 'Your saved rank order' },
  { mode: 'colour', label: 'By colour', description: 'Reds, then blacks' },
  { mode: 'suit', label: 'By suit', description: 'Hearts, diamonds, clubs, spades' },
];

type Props = {
  mode: HandSortMode;
  direction: HandSort;
  onSort: () => void;
  onModeChange: (mode: HandSortMode) => void;
};
type Position = { top: number; left: number; width: number; maxHeight: number };

export default function SortControl({ mode, direction, onSort, onModeChange }: Props) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pressRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  // A long hold or cancelled drag still produces a browser click on some phones.
  // Consume that click; only a fresh press or keyboard activation resets the guard.
  const suppressClickRef = useRef(false);
  const openRef = useRef(false);
  const initialFocusRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [position, setPosition] = useState<Position | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const cancelPress = useCallback(() => {
    if (pressRef.current) suppressClickRef.current = true;
    pressRef.current = null;
    clearHoldTimer();
  }, [clearHoldTimer]);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    openRef.current = false;
    setOpen(false);
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const openMenu = useCallback((index = OPTIONS.findIndex(option => option.mode === mode)) => {
    clearHoldTimer();
    initialFocusRef.current = Math.max(0, index);
    setFocusedIndex(initialFocusRef.current);
    if (openRef.current) {
      optionRefs.current[initialFocusRef.current]?.focus({ preventScroll: true });
      return;
    }
    openRef.current = true;
    setOpen(true);
  }, [clearHoldTimer, mode]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const viewport = window.visualViewport;
    const edge = 12;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = Math.max(0, Math.min(272, viewportWidth - edge * 2));
    const maxHeight = Math.max(0, viewportHeight - edge * 2);
    const triggerBox = trigger.getBoundingClientRect();
    const menuHeight = Math.min(menu.getBoundingClientRect().height, maxHeight);
    const left = Math.max(viewportLeft + edge, Math.min(triggerBox.right - width, viewportLeft + viewportWidth - width - edge));
    const above = triggerBox.top - menuHeight - 10;
    const below = triggerBox.bottom + 10;
    const preferredTop = above >= viewportTop + edge || below + menuHeight > viewportTop + viewportHeight - edge ? above : below;
    const top = Math.max(viewportTop + edge, Math.min(preferredTop, viewportTop + viewportHeight - menuHeight - edge));
    setPosition(previous => previous && previous.top === top && previous.left === left && previous.width === width && previous.maxHeight === maxHeight
      ? previous : { top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  const positioned = position !== null;
  useLayoutEffect(() => {
    if (open && positioned) optionRefs.current[initialFocusRef.current]?.focus({ preventScroll: true });
  }, [open, positioned]);

  // A new width changes wrapped text height on a folded or zoomed viewport.
  useLayoutEffect(() => { if (open) updatePosition(); }, [open, position?.width, updatePosition]);

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const press = pressRef.current;
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
    };
    const release = (event: globalThis.PointerEvent) => {
      if (pressRef.current?.id !== event.pointerId) return;
      clearHoldTimer();
      pressRef.current = null;
    };
    const cancel = (event: globalThis.PointerEvent) => {
      if (pressRef.current?.id === event.pointerId) cancelPress();
    };
    const blur = () => { cancelPress(); closeMenu(false); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearHoldTimer();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cancelPress, clearHoldTimer, closeMenu]);

  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) => target instanceof Node && (triggerRef.current?.contains(target) || menuRef.current?.contains(target));
    const outside = (event: Event) => { if (!isInside(event.target)) closeMenu(false); };
    const viewport = window.visualViewport;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (menuRef.current) observer?.observe(menuRef.current);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    viewport?.addEventListener('resize', updatePosition);
    viewport?.addEventListener('scroll', updatePosition);
    return () => {
      observer?.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      viewport?.removeEventListener('resize', updatePosition);
      viewport?.removeEventListener('scroll', updatePosition);
    };
  }, [open, closeMenu, updatePosition]);

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    clearHoldTimer();
    suppressClickRef.current = false;
    pressRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (openRef.current) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (!pressRef.current) return;
      suppressClickRef.current = true;
      openMenu();
    }, HOLD_MS);
  };

  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (openRef.current) { closeMenu(true); return; }
    onSort();
  };

  const triggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      cancelPress();
      openMenu(event.key === 'ArrowUp' ? OPTIONS.length - 1 : undefined);
    } else if (event.key === 'Escape' && openRef.current) {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      // Leave one ordinary native button activation for keyboard and assistive tech.
      if (event.repeat) event.preventDefault();
      else suppressClickRef.current = false;
    }
  };

  const menuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = focusedIndex;
    if (event.key === 'ArrowDown') next = (focusedIndex + 1) % OPTIONS.length;
    else if (event.key === 'ArrowUp') next = (focusedIndex + OPTIONS.length - 1) % OPTIONS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = OPTIONS.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    } else if (event.key === 'Tab') {
      closeMenu(true);
      return;
    } else return; // Native Enter/Space clicks select one radio option.
    event.preventDefault();
    setFocusedIndex(next);
    optionRefs.current[next]?.focus({ preventScroll: true });
  };

  const directionLabel = direction === 'descending' ? 'High → low' : 'Low → high';
  const modeLabel = OPTIONS.find(option => option.mode === mode)?.label.toLowerCase() ?? 'by number';

  return <div className="sort-control">
    <button
      ref={triggerRef}
      type="button"
      className="button quiet sort-button"
      aria-label={`Sort hand ${modeLabel}, ${direction === 'descending' ? 'high to low' : 'low to high'}. Hold or press Arrow Down for sort options.`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      title="Sort using your preference. Hold for number, colour or suit options."
      onPointerDown={pointerDown}
      onPointerLeave={() => { if (pressRef.current && !openRef.current) cancelPress(); }}
      onClick={click}
      onKeyDown={triggerKeyDown}
      onContextMenu={event => { event.preventDefault(); suppressClickRef.current = true; openMenu(); }}
    ><ArrowUpDown size={17} aria-hidden="true"/><span>Sort</span></button>
    {open && createPortal(<div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label="Sort hand"
      className="sort-options-popover"
      style={position ? { ...position, visibility: 'visible' } : { visibility: 'hidden', top: 0, left: 0 }}
      onKeyDown={menuKeyDown}
    >
      <div className="sort-options-heading" role="presentation"><strong>Sort hand</strong><span>{directionLabel}</span></div>
      {OPTIONS.map((option, index) => <button
        key={option.mode}
        ref={element => { optionRefs.current[index] = element; }}
        type="button"
        role="menuitemradio"
        aria-checked={mode === option.mode}
        tabIndex={focusedIndex === index ? 0 : -1}
        className="sort-option"
        onFocus={() => setFocusedIndex(index)}
        onClick={() => { closeMenu(true); onModeChange(option.mode); }}
      ><span className="sort-option-check" aria-hidden="true">{mode === option.mode && <Check size={15}/>}</span><span><strong>{option.label}</strong><small>{option.description}</small></span></button>)}
    </div>, document.body)}
  </div>;
}
