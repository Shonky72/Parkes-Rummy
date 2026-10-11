/** New invitations use four characters; existing six-character rooms keep working. */
export const ROOM_CODE_LENGTH = 4;
export const LEGACY_ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Accept pasted or spoken-code spacing without hiding invalid punctuation. */
export function normalizeRoomCode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function isRoomCode(value: string): boolean {
  const code = normalizeRoomCode(value);
  return (code.length === ROOM_CODE_LENGTH || code.length === LEGACY_ROOM_CODE_LENGTH)
    && /^[A-Z2-9]+$/.test(code);
}
