'use client';

import { rememberSeat } from './client';
import { getClientIdentity } from './client-identity';

/** The server has already created and authenticated this account's seat. */
export function openCompetitionRoom(roomCode: string) {
  const identity = getClientIdentity();
  if (!identity.ready || !identity.accountId || !rememberSeat(roomCode, identity.key)) throw new Error('Your account changed. Refresh before opening this table.');
  window.location.assign(`/join/${encodeURIComponent(roomCode)}`);
}
