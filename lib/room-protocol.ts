/**
 * Bump this shared identifier whenever a deployed client interprets room codes,
 * rules or player actions incompatibly with the previous server. An already-open
 * page must refresh before submitting actions under a different contract.
 */
export const ROOM_PROTOCOL = 'host-approval-v7';
export const ROOM_PROTOCOL_HEADER = 'X-Parkes-Protocol';
export const ROOM_UPDATE_MESSAGE = 'Game updated. Refresh this page to use your current rule. Your cards, scores and saved seat are safe.';
export const ROOM_RELOAD_KEY = 'parkes-rummy:protocol-reload';
export const ROOM_RELOAD_PARAM = '_game_update';

/** A public revision marker bypasses a cached page without changing its room. */
export function protocolReloadTarget(currentUrl: string, serverProtocol: string): string | null {
  if (!serverProtocol || serverProtocol === ROOM_PROTOCOL) return null;
  const target = new URL(currentUrl);
  if (target.searchParams.get(ROOM_RELOAD_PARAM) === serverProtocol) return null;
  target.searchParams.set(ROOM_RELOAD_PARAM, serverProtocol);
  return target.href;
}
