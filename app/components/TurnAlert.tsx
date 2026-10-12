'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { stopTurnVibration, vibrateForTurn } from '../../lib/turn-alerts';

export interface TurnAlertProps {
  turnKey: string | null;
  active: boolean;
  visible?: boolean;
  vibrationEnabled?: boolean;
}

/** A non-interactive viewport frame, independent of the hand/table layout. */
export default function TurnAlert({ turnKey, active, visible = true, vibrationEnabled = true }: TurnAlertProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [pageVisible, setPageVisible] = useState(false);
  const shown = active && visible && pageVisible;

  useEffect(() => {
    setPortalTarget(document.body);
    const update = () => {
      setPageVisible(!document.hidden);
      if (document.hidden) stopTurnVibration();
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pagehide', stopTurnVibration);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pagehide', stopTurnVibration);
      stopTurnVibration();
    };
  }, []);

  useEffect(() => {
    if (!shown || !turnKey || !vibrationEnabled) {
      stopTurnVibration();
      return;
    }
    const attempt = () => { vibrateForTurn(turnKey); };
    attempt();
    // The browser needs an earlier interaction. On a fresh page opened during
    // an own turn, the first trusted tap/key press supplies that activation.
    const gesture = (event: Event) => { if (event.isTrusted) attempt(); };
    document.addEventListener('pointerup', gesture, true);
    document.addEventListener('keydown', gesture, true);
    return () => {
      document.removeEventListener('pointerup', gesture, true);
      document.removeEventListener('keydown', gesture, true);
      stopTurnVibration();
    };
  }, [shown, turnKey, vibrationEnabled]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!shown || !frame) return;
    const viewport = window.visualViewport;
    let pendingFrame = 0;
    const position = () => {
      pendingFrame = 0;
      frame.style.left = `${viewport?.offsetLeft ?? 0}px`;
      frame.style.top = `${viewport?.offsetTop ?? 0}px`;
      frame.style.width = `${viewport?.width ?? window.innerWidth}px`;
      frame.style.height = `${viewport?.height ?? window.innerHeight}px`;
    };
    const queuePosition = () => {
      if (!pendingFrame) pendingFrame = window.requestAnimationFrame(position);
    };
    position();
    window.addEventListener('resize', queuePosition);
    viewport?.addEventListener('resize', queuePosition);
    viewport?.addEventListener('scroll', queuePosition);
    return () => {
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      window.removeEventListener('resize', queuePosition);
      viewport?.removeEventListener('resize', queuePosition);
      viewport?.removeEventListener('scroll', queuePosition);
    };
  }, [shown, portalTarget]);

  return portalTarget && shown
    ? createPortal(<div ref={frameRef} className="turn-alert-frame" aria-hidden="true"/>, portalTarget)
    : null;
}
