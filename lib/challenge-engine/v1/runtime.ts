import { createHmac } from 'node:crypto';
import type { GameAction, RoomState } from './types';

/** A fresh instance belongs to one accepted room mutation. No global RNG changes. */
export interface FrozenRuntime {
  uint32(): number;
  uuid(): string;
  now(): number;
  observe?: (before: RoomState, after: RoomState, actorId: string, action: GameAction) => void;
}

export interface SeededRuntime extends FrozenRuntime { readonly cursor: number }

/**
 * HMAC avoids exposing predictable PRNG state through public card/meld IDs.
 * The secret key and counter are persisted only in the private room. A failed
 * request discards this scoped counter together with the unsaved room state.
 */
export function createSeededRuntime(seed: string, initialCursor = 0, now = Date.now()): SeededRuntime {
  if (typeof seed !== 'string' || seed.length < 16 || seed.length > 256) throw new RangeError('A private challenge seed of 16 to 256 characters is required.');
  if (!Number.isSafeInteger(initialCursor) || initialCursor < 0) throw new RangeError('Invalid private challenge random cursor.');
  if (!Number.isFinite(now)) throw new RangeError('Invalid challenge action time.');
  let cursor = initialCursor;
  const bytes = (purpose: string) => {
    if (!Number.isSafeInteger(cursor + 1)) throw new RangeError('Challenge random cursor exhausted.');
    return createHmac('sha256', seed).update(`parkes-challenge-v1:${purpose}:${cursor++}`).digest();
  };
  return {
    uint32: () => bytes('random').readUInt32BE(0),
    uuid: () => {
      const buffer = bytes('id').subarray(0, 16);
      buffer[6] = (buffer[6] & 0x0f) | 0x40;
      buffer[8] = (buffer[8] & 0x3f) | 0x80;
      const hex = buffer.toString('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    now: () => now,
    get cursor() { return cursor; },
  };
}
