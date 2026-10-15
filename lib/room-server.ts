import { PostgresRoomRepository, type RoomRecord, type RoomRepository } from '../db/room-repository';
import { DatabaseUnavailableError } from '../db';
import { getEntitlements, getPlayerProfile, isFullAccessAdmin } from '../db/entitlements';
import { resolveAccountUser } from './auth';
import { readAuthConfig, accountMarker, ACCOUNT_IDENTITY_HEADER, type AccountUser } from './auth-config';
import { applyAction, createPlayer, createRoom, lastMoveAtFor, publicRoom, roomPreview, ruleNumberFor } from './rummy';
import { chooseQuickPlaySetup } from './quick-play';
import { advanceBotTurn } from './bot-turn';
import { isRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './room-code';
import { ROOM_PROTOCOL, ROOM_PROTOCOL_HEADER, ROOM_UPDATE_MESSAGE } from './room-protocol';
import type { Difficulty, GameAction, PlayerState, RoomState, RoomSummary, RoomSummaryResult } from './types';

class ApiError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) { super(message); }
}
const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  Vary: 'Cookie, Authorization, X-Parkes-Identity',
  [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL,
};
function reply(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: responseHeaders }); }
function requireCurrentProtocol(request: Request) {
  if (request.headers.get(ROOM_PROTOCOL_HEADER) !== ROOM_PROTOCOL) throw new ApiError(ROOM_UPDATE_MESSAGE, 426);
}
function requireSameOrigin(request: Request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new ApiError('Open this game directly to continue.', 403);
  }
}
function codeOf(value: string) {
  const code = normalizeRoomCode(value);
  if (!isRoomCode(code)) throw new ApiError('Enter the four-character room code.');
  return code;
}
function cleanName(value: unknown) {
  if (typeof value !== 'string') throw new ApiError('Enter your name to join.');
  const name = value.normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' ');
  if (!name || Array.from(name).length > 24) throw new ApiError('Choose a name between 1 and 24 characters.');
  return name;
}
function newToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function roomCode() { return Array.from(crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH)), b => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join(''); }
function identityChanged(): never {
  throw new ApiError('Your sign-in changed. Refresh your account to continue.', 401, 'ACCOUNT_IDENTITY_CHANGED');
}
type Identity = { user: AccountUser | null; token: string | null };
type SessionResolver = (request: Request) => Promise<AccountUser | null>;
async function identityFor(request: Request, resolveSession: SessionResolver): Promise<Identity> {
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ApiError('Open this game directly to continue.', 403);
  const user = await resolveSession(request);
  const authorization = request.headers.get('Authorization');
  const token = authorization?.match(/^Bearer ([^\s]{1,512})$/i)?.[1] ?? null;
  const expected = request.headers.get(ACCOUNT_IDENTITY_HEADER);
  const actual = user ? accountMarker(user.id) : 'guest';
  // These pins detect stale UI; they never supply an authenticated identity.
  if (expected !== null && expected !== actual) identityChanged();
  if (token?.startsWith('account:') && token !== actual) identityChanged();
  if (authorization && !token) throw new ApiError('Join the table before playing.', 401);
  return { user, token };
}
function accountPlayer(record: RoomRecord, userId: string) {
  const membership = record.memberships.find(member => member.userId === userId);
  return membership && record.room.players.find(player => !player.isBot && player.id === membership.playerId);
}
async function authorizedPlayer(record: RoomRecord, identity: Identity, suppliedToken = identity.token): Promise<PlayerState> {
  if (identity.user) {
    // A signed-in account cannot fall back to a different guest seat.
    const player = accountPlayer(record, identity.user.id);
    if (!player) throw new ApiError('Join this table with your account before playing.', 403);
    if (suppliedToken?.startsWith('account:') && suppliedToken !== accountMarker(identity.user.id)) identityChanged();
    return player;
  }
  if (suppliedToken?.startsWith('account:')) identityChanged();
  if (!suppliedToken || !/^[a-f0-9]{64}$/.test(suppliedToken)) throw new ApiError('Join the table before playing.', 401);
  const tokenHash = await hashToken(suppliedToken);
  const player = record.room.players.find(candidate => !candidate.isBot && candidate.tokenHash === tokenHash
    && !record.memberships.some(member => member.playerId === candidate.id));
  if (!player) throw new ApiError('Your seat is unavailable. Join the table again from the invitation.', 403);
  return player;
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  requireSameOrigin(request);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new ApiError('Send a game request as JSON.', 415);
  if (Number(request.headers.get('Content-Length') ?? 0) > 16_384) throw new ApiError('This request is too large.', 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16_384) throw new ApiError('This request is too large.', 413);
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ApiError('Please retry this action.'); }
}
async function handle(work: () => Promise<Response>): Promise<Response> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ApiError) return reply({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
    if (error instanceof DatabaseUnavailableError) return reply({ error: error.message }, 503);
    if (error instanceof Error && error.name === 'GameError') return reply({ error: error.message }, 400);
    // Database or OAuth errors may contain connection details. Keep them out of responses and logs.
    console.error('Parkes Rummy request failed');
    return reply({ error: 'The table lost connection for a moment. Please retry.' }, 500);
  }
}

function validateAction(value: unknown): GameAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('Choose a game action.');
  const action = value as Record<string, unknown>;
  const id = (key: string) => {
    const field = action[key];
    if (typeof field !== 'string' || !field || field.length > 100) throw new ApiError('Choose a valid card or player.');
    return field;
  };
  const difficulty = () => {
    if (!['easy', 'medium', 'hard'].includes(String(action.difficulty))) throw new ApiError('Choose easy, medium or hard.');
    return action.difficulty as Difficulty;
  };
  switch (action.type) {
    case 'start': case 'nextHand': case 'leave': case 'botStep': case 'timeout': return { type: action.type };
    case 'rematch':
      if (action.expectedVersion !== undefined && (typeof action.expectedVersion !== 'number' || !Number.isSafeInteger(action.expectedVersion) || action.expectedVersion < 1)) throw new ApiError('Refresh your games before starting a rematch.');
      return { type: 'rematch', expectedVersion: action.expectedVersion as number | undefined };
    case 'setGame':
      if (![1,2,3,4].includes(action.game as number)) throw new ApiError('Choose Game 1, Game 2, Game 3 or Original Rules.');
      return { type: 'setGame', game: action.game as 1|2|3|4 };
    case 'setMoveHints':
      if (typeof action.enabled !== 'boolean') throw new ApiError('Choose whether move hints are on or off.');
      return { type: 'setMoveHints', enabled: action.enabled };
    case 'setTurnLimit':
      if (typeof action.seconds !== 'number' || !Number.isInteger(action.seconds) || (action.seconds !== 0 && (action.seconds < 15 || action.seconds > 300))) throw new ApiError('Choose Unlimited or a timer from 15 to 300 seconds.');
      return { type: 'setTurnLimit', seconds: action.seconds };
    case 'addBot': return { type: 'addBot', difficulty: difficulty() };
    case 'setDifficulty': return { type: 'setDifficulty', playerId: id('playerId'), difficulty: difficulty() };
    case 'removePlayer': return { type: 'removePlayer', playerId: id('playerId') };
    case 'setReady':
      if (typeof action.ready !== 'boolean') throw new ApiError('Choose a ready status.');
      return { type: 'setReady', ready: action.ready };
    case 'draw':
      if (action.source !== 'stock' && action.source !== 'discard') throw new ApiError('Choose the draw pile or discard pile.');
      return { type: 'draw', source: action.source };
    case 'goDown':
      if (!Array.isArray(action.cardIds) || action.cardIds.length > 10 || action.cardIds.some(c => typeof c !== 'string' || !c || c.length > 100)) throw new ApiError('Select the cards for your exact requirement.');
      if (action.expectedRuleNumber !== undefined && (typeof action.expectedRuleNumber !== 'number' || !Number.isInteger(action.expectedRuleNumber) || action.expectedRuleNumber < 1 || action.expectedRuleNumber > 10)) throw new ApiError('Refresh the table to show your current rule.');
      return { type: 'goDown', cardIds: action.cardIds as string[], expectedRuleNumber: action.expectedRuleNumber as number | undefined };
    case 'layoff':
      if (action.end !== 'start' && action.end !== 'end') throw new ApiError('Choose where to add the selected card.');
      return { type: 'layoff', cardId: id('cardId'), meldId: id('meldId'), end: action.end };
    case 'layoffMany':
      if (!Array.isArray(action.cardIds) || action.cardIds.length < 1 || action.cardIds.length > 11 || action.cardIds.some(c => typeof c !== 'string' || !c || c.length > 100) || new Set(action.cardIds).size !== action.cardIds.length) throw new ApiError('Select between 1 and 11 different cards.');
      if (action.end !== 'start' && action.end !== 'end') throw new ApiError('Choose where to add the selected cards.');
      return { type: 'layoffMany', cardIds: action.cardIds as string[], meldId: id('meldId'), end: action.end };
    case 'discard': return { type: 'discard', cardId: id('cardId') };
    default: throw new ApiError('This action is unavailable. Refresh the table and try again.');
  }
}

function roomSummary(room: RoomState, player: PlayerState): RoomSummary {
  const current = room.status === 'playing' ? room.players.find(candidate => candidate.id === room.turnPlayerId) : undefined;
  return {
    code: room.code, game: room.game, status: room.status,
    hostName: room.players.find(candidate => candidate.id === room.hostId)?.name ?? 'The host',
    isHost: player.id === room.hostId,
    playerCount: room.players.length, playerNames: room.players.map(candidate => candidate.name),
    yourPlayerId: player.id, yourName: player.name,
    yourRuleNumber: ruleNumberFor(player, room.status === 'lobby' ? 1 : room.round), round: room.round,
    turnPlayerName: current?.name ?? null, turnPlayerId: current?.id ?? null, turnNumber: room.turnNumber,
    isYourTurn: current?.id === player.id, lastMoveAt: lastMoveAtFor(room), updatedAt: room.updatedAt,
    version: room.version, turnDeadline: room.status === 'playing' ? room.turnDeadline : null,
    currentPlayerIsBot: current?.isBot ?? false, botDueAt: current?.isBot ? room.botDueAt : 0,
  };
}



export function createRoomHandlers(options: { repository?: RoomRepository; resolveSession?: SessionResolver; configured?: () => boolean } = {}) {
  const repository = options.repository ?? new PostgresRoomRepository();
  const resolveSession = options.resolveSession ?? resolveAccountUser;
  const configured = options.configured ?? (() => readAuthConfig() !== null);
  async function load(code: string) {
    const record = await repository.load(code);
    if (!record) throw new ApiError('Room not found. Check the code with your host.', 404);
    return record;
  }
  async function accountIdentity(request: Request) {
    const identity = await identityFor(request, resolveSession);
    if (!identity.user) identityChanged();
    return identity as Identity & { user: AccountUser };
  }
  async function checkCreationRate(identity: Identity, request: Request) {
    const ip = request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim();
    const source = identity.user ? `account:${identity.user.id}` : ip ? `ip:${ip}` : null;
    if (source && !await repository.consumeCreationLimit(await hashToken(source), Date.now())) {
      throw new ApiError('Please use your existing room or wait a few minutes before creating another.', 429);
    }
  }
  return {
    createRoomRequest: (request: Request) => handle(async () => {
      requireCurrentProtocol(request);
      const body = await bodyOf(request);
      const identity = await identityFor(request, resolveSession);
      const name = cleanName(body.name);
      await checkCreationRate(identity, request);
      const token = identity.user ? accountMarker(identity.user.id) : newToken();
      const playerId = crypto.randomUUID();
      const tokenHash = identity.user ? `account:${crypto.randomUUID()}` : await hashToken(token);
      const profile = identity.user ? await getPlayerProfile(identity.user.id) : { font:'default', symbol:'initials' } as const;
      // The server picks all Quick Play options. A browser never chooses or claims paid Original Rules.
      const quickPlay = body.quickPlay === true ? chooseQuickPlaySetup(identity.user ? (await getEntitlements(identity.user.id)).originalRules : false) : null;
      const host = createPlayer({ id: playerId, name, tokenHash, color: 0, fontId: profile.font, symbolId: profile.symbol });
      const membership = identity.user ? { userId: identity.user.id, playerId } : undefined;
      for (let attempt = 0; attempt < 8; attempt++) {
        let room = createRoom(roomCode(), host);
        if (quickPlay) {
          room = applyAction(room, host.id, { type: 'setGame', game: quickPlay.game });
          for (const difficulty of quickPlay.difficulties) room = applyAction(room, host.id, { type: 'addBot', difficulty });
          room = applyAction(room, host.id, { type: 'start' });
        }
        if (await repository.insert(room, membership)) return reply({ room: publicRoom(room, host.id), token }, 201);
      }
      throw new ApiError('A room code is taking a moment. Please try again.', 503);
    }),
    roomPreviewRequest: (_request: Request, rawCode: string) => handle(async () => {
      const { room } = await load(codeOf(rawCode));
      return reply({ preview: roomPreview(room) });
    }),
    readRoomRequest: (request: Request, rawCode: string) => handle(async () => {
      const identity = await identityFor(request, resolveSession);
      const record = await load(codeOf(rawCode));
      const player = await authorizedPlayer(record, identity);
      return reply({ room: publicRoom(record.room, player.id) });
    }),
    listRoomSummariesRequest: (request: Request) => handle(async () => {
      requireCurrentProtocol(request);
      const body = await bodyOf(request);
      const identity = await identityFor(request, resolveSession);
      if (!Array.isArray(body.seats) || body.seats.length > 32) throw new ApiError('Choose up to 32 saved games.');
      const lookups = new Map<string, ReturnType<typeof load>>();
      const summaries = await Promise.all(body.seats.map(async (value: unknown): Promise<RoomSummaryResult> => {
        let code = '';
        try {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('Choose a saved game.');
          const seat = value as Record<string, unknown>;
          if (typeof seat.code !== 'string' || seat.code.length > 64) throw new ApiError('Choose a valid saved room code.');
          code = codeOf(seat.code);
          if (typeof seat.token !== 'string') throw new ApiError('Join the table before playing.', 401);
          let lookup = lookups.get(code);
          if (!lookup) { lookup = load(code); lookups.set(code, lookup); }
          const record = await lookup;
          const player = await authorizedPlayer(record, identity, seat.token);
          return { code, status: 200, summary: roomSummary(record.room, player) };
        } catch (error) {
          // Identity mismatches invalidate the request, not an individual saved seat.
          if (error instanceof ApiError && error.code) throw error;
          if (error instanceof ApiError) return { code, status: error.status as 400 | 401 | 403 | 404 | 503, error: error.message };
          return { code, status: 500, error: 'The table lost connection for a moment. Please retry.' };
        }
      }));
      return reply({ summaries });
    }),
    joinRoomRequest: (request: Request, rawCode: string) => handle(async () => {
      requireCurrentProtocol(request);
      const body = await bodyOf(request);
      const identity = await identityFor(request, resolveSession);
      const code = codeOf(rawCode);
      if (typeof body.token === 'string' && body.token.startsWith('account:') && body.token !== (identity.user ? accountMarker(identity.user.id) : 'guest')) identityChanged();
      const priorToken = !identity.user && typeof body.token === 'string' && /^[a-f0-9]{64}$/.test(body.token) ? body.token : null;
      const priorHash = priorToken ? await hashToken(priorToken) : null;
      const token = identity.user ? accountMarker(identity.user.id) : newToken();
      const playerId = crypto.randomUUID();
      const tokenHash = identity.user ? `account:${crypto.randomUUID()}` : await hashToken(token);
      for (let attempt = 0; attempt < 8; attempt++) {
        const record = await load(code);
        const { room, version } = record;
        if (identity.user) {
          const prior = accountPlayer(record, identity.user.id);
          if (prior) {
            const profile = await getPlayerProfile(identity.user.id);
            prior.fontId = profile.font; prior.symbolId = profile.symbol;
            room.version = version + 1; room.updatedAt = Date.now();
            if (!await repository.save(room, version)) continue;
            if (!await repository.setHidden(code, identity.user.id, false, prior.id)) continue;
            return reply({ room: publicRoom(room, prior.id), token });
          }
        } else if (priorHash) {
          const prior = room.players.find(player => !player.isBot && player.tokenHash === priorHash
            && !record.memberships.some(member => member.playerId === player.id));
          if (prior) return reply({ room: publicRoom(room, prior.id), token: priorToken });
        }
        if (room.status !== 'lobby') throw new ApiError('This game has started. Sign in to your account or reopen your saved seat to return.', 409);
        if (room.players.length >= 8) throw new ApiError('This table has eight players. Ask the host to free a seat.', 409);
        const name = cleanName(body.name);
        if (room.players.some(player => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new ApiError('Someone at this table already uses that name. Choose another name.');
        const color = Array.from({ length: 8 }, (_, i) => i).find(i => !room.players.some(player => player.color === i)) ?? room.players.length;
        const profile = identity.user ? await getPlayerProfile(identity.user.id) : { font:'default', symbol:'initials' } as const;
        room.players.push(createPlayer({ id: playerId, name, tokenHash, color, fontId: profile.font, symbolId: profile.symbol }));
        room.lastMoveAt = lastMoveAtFor(room);
        room.events.push({ id: (room.events.at(-1)?.id ?? 0) + 1, type: 'join', playerId, text: `${name} joined the table`, at: Date.now() });
        room.events = room.events.slice(-40);
        room.version = version + 1;
        room.updatedAt = Date.now();
        const membership = identity.user ? { userId: identity.user.id, playerId } : undefined;
        if (await repository.save(room, version, membership)) return reply({ room: publicRoom(room, playerId), token });
      }
      throw new ApiError('Someone else joined at the same moment. Please tap Join game again.', 409);
    }),
    actionRoomRequest: (request: Request, rawCode: string) => handle(async () => {
      requireCurrentProtocol(request);
      const body = await bodyOf(request);
      const identity = await identityFor(request, resolveSession);
      const code = codeOf(rawCode);
      const action = validateAction(body.action);
      if (typeof body.requestId !== 'string' || body.requestId.length < 4 || body.requestId.length > 100) throw new ApiError('Please retry this action.');
      for (let attempt = 0; attempt < 8; attempt++) {
        const record = await load(code);
        const { room, version } = record;
        const player = await authorizedPlayer(record, identity);
        const requestKey = `${player.id}:${body.requestId}`;
        if (room.recentActions.includes(requestKey)) return reply({ room: publicRoom(room, player.id) });
        if (action.type === 'rematch' && action.expectedVersion !== undefined && player.id === room.hostId
          && (room.status !== 'finished' || action.expectedVersion !== room.version)) {
          return reply({ error: 'This game has changed. Review the latest table before starting a rematch.', room: publicRoom(room, player.id) }, 409);
        }
        if ((action.type === 'setGame' && action.game === 4) || (action.type === 'start' && room.game === 4)) {
          if (player.id !== room.hostId) throw new ApiError('Only the host controls this setting.', 403);
          if (!identity.user) throw new ApiError('Sign in and unlock Original Rules to host this ruleset. Guests can join free.', 403);
          const entitlements = await getEntitlements(identity.user.id);
          if (!entitlements.originalRules) throw new ApiError('Original Rules is a one-off A$0.99 host unlock. Guests can join your table without buying it.', 403);
        }
        if (action.type === 'goDown') {
          const view = publicRoom(room, player.id);
          const currentRule = view.currentRule!;
          if (action.expectedRuleNumber !== currentRule.number) {
            return reply({ error: `Your current rule is Rule ${currentRule.number}: ${currentRule.title}. Check the updated rule and select your cards again.`, room: view }, 409);
          }
        }
        if (action.type === 'botStep' && (room.status !== 'playing' || !room.players.find(candidate => candidate.id === room.turnPlayerId)?.isBot || Date.now() < room.botDueAt)) return reply({ room: publicRoom(room, player.id) });
        if (action.type === 'timeout' && (room.status !== 'playing' || !room.turnDeadline || Date.now() < room.turnDeadline)) return reply({ room: publicRoom(room, player.id) });
        const next = action.type === 'botStep' ? advanceBotTurn(room, player.id) : applyAction(room, player.id, action);
        next.recentActions = [...room.recentActions, requestKey].slice(-64);
        if (next.version <= version) next.version = version + 1;
        next.updatedAt = Date.now();
        if (!next.players.some(candidate => !candidate.isBot)) {
          if (await repository.delete(code, version)) return reply({ room: null, left: true });
        } else if (await repository.save(next, version)) {
          const stillPresent = next.players.some(candidate => candidate.id === player.id);
          return reply({ room: stillPresent ? publicRoom(next, player.id) : null, left: !stillPresent });
        }
      }
      throw new ApiError('The table changed while you played. Please try once more.', 409);
    }),
    deleteRoomRequest: (request: Request, rawCode: string) => handle(async () => {
      requireCurrentProtocol(request);
      const body = await bodyOf(request);
      const identity = await identityFor(request, resolveSession);
      const code = codeOf(rawCode);
      const record = await load(code);
      const player = await authorizedPlayer(record, identity);
      if (player.id !== record.room.hostId) throw new ApiError('Only the host deletes a whole game.', 403);
      if (body.expectedVersion !== record.version) throw new ApiError('This game has changed. Refresh before deleting it.', 409);
      if (!await repository.delete(code, record.version)) throw new ApiError('This game has changed. Refresh before deleting it.', 409);
      return reply({ ok: true });
    }),
    accountSessionRequest: (request: Request) => handle(async () => {
      if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ApiError('Open this game directly to continue.', 403);
      const user = await resolveSession(request);
      const [entitlements, profile] = user ? await Promise.all([getEntitlements(user.id), getPlayerProfile(user.id)]) : [ { removeAds:false, premiumFonts:false, premiumSymbols:false, voiceChat:false, originalRules:false }, { font:'default', symbol:'initials' } ];
      return reply({ configured: configured(), user, entitlements, accessAdmin: Boolean(user && isFullAccessAdmin(user.email)), profile });
    }),
    accountConfigRequest: () => reply({ enabled: configured() }),
    accountGamesRequest: (request: Request) => handle(async () => {
      const identity = await accountIdentity(request);
      const records = await repository.listForAccount(identity.user.id);
      const games = records.flatMap(record => {
        const player = accountPlayer(record, identity.user.id);
        return player ? [{ ...roomSummary(record.room, player), token: accountMarker(identity.user.id) }] : [];
      });
      return reply({ games });
    }),
    removeAccountGameRequest: (request: Request, rawCode: string) => handle(async () => {
      requireCurrentProtocol(request);
      requireSameOrigin(request);
      const identity = await accountIdentity(request);
      const code = codeOf(rawCode);
      // Idempotent and scoped to this identity. Does not delete another person's game.
      await repository.setHidden(code, identity.user.id, true);
      return reply({ ok: true });
    }),
  };
}

export const {
  createRoomRequest, roomPreviewRequest, readRoomRequest, listRoomSummariesRequest,
  joinRoomRequest, actionRoomRequest, deleteRoomRequest,
  accountSessionRequest, accountConfigRequest, accountGamesRequest, removeAccountGameRequest,
} = createRoomHandlers();
