import type { GameAction, PublicRoom, RoomSummary, RoomSummaryResult } from './types';

export interface SavedGameEntry {
  code: string;
  summary?: RoomSummary;
  error?: string;
  unavailable?: boolean;
  stale?: boolean;
}

/** Keep completed games out of the active list without losing their saved seats. */
export function splitSavedGames(entries: SavedGameEntry[]): { active: SavedGameEntry[]; finished: SavedGameEntry[] } {
  const active: SavedGameEntry[] = [];
  const finished: SavedGameEntry[] = [];
  for (const entry of entries) (entry.summary?.status === 'finished' ? finished : active).push(entry);
  return { active, finished };
}

const MOVE_EVENTS = new Set(['start', 'draw', 'meld', 'layoff', 'discard', 'timeout', 'round-end', 'game-end']);

/** Public metadata only. The hand and seat token never enter a games-list entry. */
export function summaryFromRoom(room: PublicRoom): RoomSummary {
  const own = room.players.find(player => player.id === room.youId);
  const current = room.status === 'playing' ? room.players.find(player => player.id === room.turnPlayerId) : undefined;
  const latestMove = room.events.findLast(event => MOVE_EVENTS.has(event.type))?.at ?? null;
  const rule = room.currentRule?.number ?? own?.ruleNumber ?? (room.status === 'lobby' ? 1 : room.round);
  return {
    code: room.code, game: room.game, status: room.status,
    hostName: room.players.find(player => player.id === room.hostId)?.name ?? 'The host',
    playerCount: room.players.length, playerNames: room.players.map(player => player.name),
    yourPlayerId: room.youId, yourName: own?.name ?? 'You', isHost: room.hostId === room.youId,
    yourRuleNumber: Math.max(1, Math.min(10, Number.isInteger(rule) ? rule : 1)),
    round: room.round, turnNumber: room.turnNumber,
    turnPlayerName: current?.name ?? null, turnPlayerId: current?.id ?? null,
    isYourTurn: current?.id === room.youId,
    lastMoveAt: room.lastMoveAt === undefined ? latestMove : room.lastMoveAt,
    updatedAt: room.updatedAt ?? room.events.at(-1)?.at ?? 0, version: room.version,
    turnDeadline: room.status === 'playing' ? room.turnDeadline : null,
    currentPlayerIsBot: current?.isBot ?? false, botDueAt: current?.isBot ? room.botDueAt : 0,
  };
}

/** Room codes are reusable, so metadata belongs to a specific saved credential. */
export function reconcileSavedGameSeats(previous: SavedGameEntry[], previousSeats: Record<string, string>, currentSeats: Record<string, string>): SavedGameEntry[] {
  const retained = previous.filter(entry => previousSeats[entry.code] === currentSeats[entry.code] && currentSeats[entry.code]);
  return mergeGameSummaries(retained, [], Object.keys(currentSeats));
}

/** Older polls never replace a newer active-table response. Failures retain known data. */
export function mergeGameSummaries(previous: SavedGameEntry[], incoming: RoomSummaryResult[], codes: string[], requestBaseline?: SavedGameEntry[]): SavedGameEntry[] {
  const entries = new Map(previous.map(entry => [entry.code, entry]));
  const baseline = requestBaseline && new Map(requestBaseline.map(entry => [entry.code, entry.summary]));
  const allowed = new Set(codes);
  for (const result of incoming) {
    if (!allowed.has(result.code)) continue;
    const old = entries.get(result.code);
    if (result.status === 200) {
      if (old?.summary?.yourPlayerId === result.summary.yourPlayerId && old.summary.version > result.summary.version) continue;
      entries.set(result.code, { code: result.code, summary: result.summary, stale: false });
    } else {
      // A successful active-table action during this poll supersedes an older error.
      const startedWith = baseline?.get(result.code);
      if (baseline && old?.summary && (!startedWith || old.summary.yourPlayerId !== startedWith.yourPlayerId || old.summary.version > startedWith.version)) continue;
      entries.set(result.code, {
        ...old, code: result.code, error: result.error, stale: true,
        unavailable: [400, 401, 403, 404].includes(result.status),
      });
    }
  }
  const priority = (entry: SavedGameEntry) => entry.unavailable ? 5 : !entry.summary ? 4
    : entry.summary.isYourTurn ? 0 : entry.summary.status === 'playing' ? 1
      : entry.summary.status === 'round-end' ? 2 : entry.summary.status === 'lobby' ? 3 : 4;
  return [...allowed].map(code => entries.get(code) ?? { code }).sort((a, b) =>
    priority(a) - priority(b) || (b.summary?.lastMoveAt ?? 0) - (a.summary?.lastMoveAt ?? 0) || a.code.localeCompare(b.code));
}

export function formatLastMove(at: number | null, now = Date.now()): string {
  if (at === null || !Number.isFinite(at) || at <= 0) return 'No move recorded';
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 10) return 'Moments ago';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** The same paced, idempotent actions used by an open table keep other games moving. */
export function backgroundGameAction(summary: RoomSummary, now: number): { action: GameAction; requestId: string } | null {
  if (summary.status !== 'playing') return null;
  const expired = summary.turnDeadline !== null && now >= summary.turnDeadline + 100;
  const botDue = summary.currentPlayerIsBot && now >= summary.botDueAt + 80;
  if (!expired && !botDue) return null;
  return {
    action: { type: expired ? 'timeout' : 'botStep' },
    requestId: `${expired ? 'timeout' : 'bot'}-${summary.code}-${summary.round}-${summary.turnNumber}-${summary.version}`,
  };
}
