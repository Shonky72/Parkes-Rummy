// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { isRoomCode, normalizeRoomCode } from './room-code.ts';

export const PRIMARY_SITE_ORIGIN = 'https://parkesrummy.com';
export const ORIGINAL_SITE_ORIGIN = 'https://parkes-rummy.xshonkyx.chatgpt.site';

/** Only the new www alias redirects; original browser seats stay accessible. */
export function canonicalSiteRedirect(requestUrl: string): string | null {
  let url: URL;
  try { url = new URL(requestUrl); } catch { return null; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.hostname !== 'www.parkesrummy.com' || url.username || url.password) return null;
  url.protocol = 'https:';
  url.hostname = 'parkesrummy.com';
  url.port = '';
  return url.href;
}

/** Recovery links carry only a public room code, never page queries or fragments. */
export function originalGamesUrl(origin: string, roomCode?: string): string | null {
  if (origin !== PRIMARY_SITE_ORIGIN) return null;
  const path = roomCode && isRoomCode(roomCode) ? `/join/${normalizeRoomCode(roomCode)}` : '/';
  return `${ORIGINAL_SITE_ORIGIN}${path}`;
}
