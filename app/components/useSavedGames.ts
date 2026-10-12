'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSeats, roomApi, RoomError, subscribeSavedSeats, syncAccountSeats } from '../../lib/client';
import { getClientIdentity, isClientIdentityCurrent } from '../../lib/client-identity';
import { backgroundGameAction, mergeGameSummaries, reconcileSavedGameSeats, summaryFromRoom, type SavedGameEntry } from '../../lib/saved-games';
import type { PublicRoom, RoomSummaryResult } from '../../lib/types';

/** Poll every saved seat, while active-table rendering remains owned by ParkesApp. */
export function useSavedGames(activeRoom: PublicRoom | null, activeToken?: string | null) {
  const identity = useRef(getClientIdentity());
  const [entries, setEntries] = useState<SavedGameEntry[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const knownSeats = useRef<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);
  const activeCode = useRef(activeRoom?.code);
  activeCode.current = activeRoom?.code;
  const live = useRef(false);
  const inFlight = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const refreshAgain = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(async () => {
    if (!live.current || document.hidden || !isClientIdentityCurrent(identity.current)) return;
    if (inFlight.current) { refreshAgain.current = true; return; }
    const savedSeats = getSeats();
    const previousSeats = knownSeats.current;
    knownSeats.current = savedSeats;
    const baseline = reconcileSavedGameSeats(entriesRef.current, previousSeats, savedSeats);
    setEntries(previous => reconcileSavedGameSeats(previous, previousSeats, savedSeats));
    let seats = Object.entries(savedSeats).map(([code, token]) => ({ code, token }));
    if (!seats.length && !identity.current.accountId) {
      controllerRef.current?.abort();
      setLoading(false); setRefreshing(false); setError(''); return;
    }
    inFlight.current = true;
    setRefreshing(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    const results: RoomSummaryResult[] = [];
    let partialFailure = false;
    const stillCurrent = () => live.current && !controller.signal.aborted && isClientIdentityCurrent(identity.current);
    try {
      if (identity.current.accountId) {
        const response = await roomApi.accountGames(controller.signal);
        if (!stillCurrent()) return;
        if (JSON.stringify(getSeats()) !== JSON.stringify(savedSeats)) { refreshAgain.current = true; return; }
        // Membership is discovered from the verified server session on every
        // device. No token, card or account list is persisted in localStorage.
        syncAccountSeats(response.games);
        seats = Object.entries(getSeats()).map(([code, token]) => ({ code, token }));
        results.push(...response.games.filter(game => getSeats()[game.code] === game.token).map(({ token: _marker, ...summary }) => ({ code: summary.code, status: 200 as const, summary })));
      } else for (let index = 0; index < seats.length; index += 32) {
        const chunk = seats.slice(index, index + 32);
        try {
          const response = await roomApi.summaries(chunk, controller.signal);
          if (!stillCurrent()) return;
          results.push(...response.summaries);
        } catch (cause) {
          if (!stillCurrent()) return;
          if (cause instanceof RoomError && cause.status === 426) throw cause;
          partialFailure = true;
          results.push(...chunk.map(seat => ({ code: seat.code, status: 500 as const, error: 'Reconnecting to this game…' })));
        }
      }
      if (!stillCurrent()) return;
      const currentSeats = getSeats();
      const unchangedSeats = new Set(seats.filter(seat => currentSeats[seat.code] === seat.token).map(seat => seat.code));
      const accepted = results.filter(result => unchangedSeats.has(result.code));
      const previousCurrentSeats = knownSeats.current;
      knownSeats.current = currentSeats;
      setEntries(previous => mergeGameSummaries(reconcileSavedGameSeats(previous, previousCurrentSeats, currentSeats), accepted, Object.keys(currentSeats), baseline));
      setError(partialFailure ? 'Some games are reconnecting…' : '');
      setNow(Date.now());

      // Advancing a computer or expired turn never plays a human's optional move.
      // Each room is independently authorized; these responses update its list row only.
      const due = accepted.filter(result => result.status === 200 && result.code !== activeCode.current);
      for (let index = 0; index < due.length; index += 3) {
        if (!stillCurrent() || document.hidden) break;
        await Promise.all(due.slice(index, index + 3).map(async result => {
          if (result.status !== 200 || result.code === activeCode.current) return;
          const next = backgroundGameAction(result.summary, Date.now());
          const token = currentSeats[result.code];
          if (!next || !token || getSeats()[result.code] !== token) return;
          try {
            const response = await roomApi.action(result.code, token, next.action, next.requestId);
            if (!stillCurrent() || !response.room || getSeats()[result.code] !== token) return;
            setEntries(previous => mergeGameSummaries(previous, [{ code: result.code, status: 200, summary: summaryFromRoom(response.room) }], Object.keys(getSeats())));
          } catch { /* Keep the last known row. The next refresh retries safely. */ }
        }));
      }
    } catch (cause) {
      if (!stillCurrent()) return;
      const message = cause instanceof RoomError && cause.status === 426 ? cause.message : 'Reconnecting to your games…';
      setError(message);
      const currentSeats = getSeats();
      const previousCurrentSeats = knownSeats.current;
      knownSeats.current = currentSeats;
      const failures: RoomSummaryResult[] = seats.filter(seat => currentSeats[seat.code] === seat.token).map(seat => ({ code: seat.code, status: 500, error: message }));
      setEntries(previous => mergeGameSummaries(reconcileSavedGameSeats(previous, previousCurrentSeats, currentSeats), failures, Object.keys(currentSeats), baseline));
    } finally {
      inFlight.current = false;
      if (controllerRef.current === controller) controllerRef.current = null;
      if (live.current && isClientIdentityCurrent(identity.current)) {
        setLoading(false); setRefreshing(false);
        if (refreshAgain.current) {
          refreshAgain.current = false;
          queueMicrotask(() => { void refreshRef.current(); });
        }
      }
    }
  }, []);
  refreshRef.current = refresh;

  useEffect(() => {
    live.current = true;
    const sync = () => { void refresh(); };
    const resume = () => { if (!document.hidden) sync(); };
    sync();
    const stopSeats = subscribeSavedSeats(sync);
    const timer = window.setInterval(sync, 4000);
    const clock = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 10000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', sync);
    return () => {
      live.current = false; controllerRef.current?.abort();
      stopSeats(); clearInterval(timer); clearInterval(clock);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', sync);
    };
  }, [refresh]);

  useEffect(() => {
    const currentSeats = getSeats();
    if (!isClientIdentityCurrent(identity.current) || !activeRoom || !currentSeats[activeRoom.code] || (activeToken !== undefined && currentSeats[activeRoom.code] !== activeToken)) return;
    const previousSeats = knownSeats.current;
    knownSeats.current = currentSeats;
    const summary = summaryFromRoom(activeRoom);
    setEntries(previous => mergeGameSummaries(reconcileSavedGameSeats(previous, previousSeats, currentSeats), [{ code: summary.code, status: 200, summary }], Object.keys(currentSeats)));
  }, [activeRoom, activeToken]);

  return { entries, loading, refreshing, error, now, refresh };
}
