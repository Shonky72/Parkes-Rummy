import { completedPlayFor, completedRecordFor, enableRecords, observeRecordsAction } from '../../rummy';
import { CHALLENGE_ENGINE_VERSION } from '../../competition-types';
import type {
  ChallengeConfig, ChallengeRoom, PublicChallengeInfo, PublicChallengeRoom,
} from '../../competition-types';
import type { GameAction, PlayerState, RoomState } from '../../types';
import { createFrozenEngine } from './rummy';
import type { FrozenEngine } from './rummy';
import { createSeededRuntime } from './runtime';

export { CHALLENGE_ENGINE_VERSION } from '../../competition-types';

export class ChallengeError extends Error {
  readonly code: string;
  constructor(message: string, code = 'INVALID_CHALLENGE') {
    super(message);
    // Existing room API error treatment recognises the stable engine error name.
    this.name = 'GameError';
    this.code = code;
  }
}

export function challengeVersionSupported(version: unknown): version is typeof CHALLENGE_ENGINE_VERSION {
  return version === CHALLENGE_ENGINE_VERSION;
}

export function isChallengeRoom(room: RoomState): room is ChallengeRoom {
  return !!(room as Partial<ChallengeRoom>).challenge;
}

export function validateChallengeConfig(input: ChallengeConfig): ChallengeConfig {
  if (!input || !challengeVersionSupported(input.engineVersion)) {
    throw new ChallengeError('This challenge engine version is unavailable. The original deal has not been changed.', 'CHALLENGE_VERSION_UNAVAILABLE');
  }
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(input.id)) throw new ChallengeError('Invalid challenge identifier.');
  if (typeof input.seed !== 'string' || input.seed.length < 16 || input.seed.length > 256) throw new ChallengeError('Invalid private challenge seed.');
  if (![1, 2, 3, 4].includes(input.game) || !Number.isInteger(input.ruleNumber) || input.ruleNumber < 1 || input.ruleNumber > 10) throw new ChallengeError('Choose a complete challenge rule.');
  if (!Array.isArray(input.difficulties) || input.difficulties.length < 1 || input.difficulties.length > 3
    || input.difficulties.some(value => !['easy', 'medium', 'hard'].includes(value))
    || input.difficulties.filter(value => value === 'hard').length > 1) throw new ChallengeError('A challenge uses one to three AI players, with at most one Hard AI.');
  const count = input.difficulties.length + 1;
  if (!Number.isInteger(input.humanSeat) || input.humanSeat < 0 || input.humanSeat >= count
    || !Number.isInteger(input.startingSeat) || input.startingSeat < 0 || input.startingSeat >= count) throw new ChallengeError('Invalid fixed challenge seat.');
  if (typeof input.showMoveHints !== 'boolean') throw new ChallengeError('A challenge must fix its hint setting.');
  return {
    id: input.id, engineVersion: input.engineVersion, seed: input.seed, game: input.game,
    ruleNumber: input.ruleNumber, humanSeat: input.humanSeat, startingSeat: input.startingSeat,
    difficulties: [...input.difficulties], showMoveHints: input.showMoveHints,
  };
}

function engineFor(config: ChallengeConfig, cursor: number, now: number) {
  const runtime = createSeededRuntime(config.seed, cursor, now);
  const engine: FrozenEngine = createFrozenEngine(runtime);
  runtime.observe = (before, after, actorId, action) => observeRecordsAction(before, after, actorId, action, {
    version: CHALLENGE_ENGINE_VERSION, rules: engine.RULES, findOpening: engine.findBotOpening,
  });
  return { engine, runtime };
}

/** Landing copy follows the saved rule version even after social rules change. */
export function frozenChallengeRule(configInput: ChallengeConfig) {
  const config = validateChallengeConfig(configInput);
  const { engine } = engineFor(config, 0, 0);
  return structuredClone(engine.RULES[config.game][config.ruleNumber - 1]);
}

export interface ChallengeCreateOptions { practice?: boolean; attemptId?: string; deadlineAt?: number; now?: number }

/** Caller verifies identity, invitation access and Original Rules entitlement first. */
export function createChallengeRoom(configInput: ChallengeConfig, roomCode: string, humanPlayer: PlayerState,
  options: ChallengeCreateOptions = {}): ChallengeRoom {
  const config = validateChallengeConfig(configInput);
  if (!humanPlayer || humanPlayer.isBot) throw new ChallengeError('A signed-in human player is required.');
  const now = options.now ?? Date.now();
  if (options.deadlineAt !== undefined && (!Number.isSafeInteger(options.deadlineAt) || options.deadlineAt <= now)) throw new ChallengeError('Choose an active challenge attempt.');
  const { engine, runtime } = engineFor(config, 0, now);
  const human = engine.createPlayer({
    id: humanPlayer.id, name: humanPlayer.name, tokenHash: humanPlayer.tokenHash, color: humanPlayer.color,
    fontId: humanPlayer.fontId, symbolId: humanPlayer.symbolId,
  });
  let room = engine.createRoom(roomCode, human) as ChallengeRoom;
  room.game = config.game;
  room.quickPlay = { ruleNumber: config.ruleNumber };
  room.showMoveHints = config.showMoveHints;
  for (const difficulty of config.difficulties) room = engine.applyAction(room, human.id, { type: 'addBot', difficulty }) as ChallengeRoom;
  const bots = room.players.filter(player => player.isBot);
  room.players = [...bots.slice(0, config.humanSeat), human, ...bots.slice(config.humanSeat)];
  room.challenge = {
    config, randomCursor: runtime.cursor, humanPlayerId: human.id, practice: options.practice === true,
    ...(options.attemptId ? { attemptId: options.attemptId } : {}),
    ...(options.deadlineAt !== undefined ? { deadlineAt: options.deadlineAt } : {}),
  };
  enableRecords(room, {
    format: 'challenge', challengeId: config.id, eligible: !room.challenge.practice,
    ...(room.challenge.practice ? { exclusionReason: 'challenge practice replay' } : {}),
  });
  room = engine.applyAction(room, human.id, { type: 'start' }) as ChallengeRoom;
  // First seat and the human's dealt seat are independent frozen inputs.
  room.turnPlayerId = room.players[config.startingSeat].id;
  room.botDueAt = room.players[config.startingSeat].isBot ? now + 240 : 0;
  if (room.records) {
    for (const evidence of Object.values(room.records.current)) evidence.conditions.startingSeat = config.startingSeat;
    for (const event of room.records.events) event.evidence.conditions.startingSeat = config.startingSeat;
  }
  room.challenge.randomCursor = runtime.cursor;
  return room;
}

function assertFrozenRoom(room: RoomState): asserts room is ChallengeRoom {
  if (!isChallengeRoom(room)) throw new ChallengeError('This table is not a controlled challenge.');
  const config = validateChallengeConfig(room.challenge.config);
  if (!Number.isSafeInteger(room.challenge.randomCursor) || room.challenge.randomCursor < 0
    || room.game !== config.game || room.quickPlay?.ruleNumber !== config.ruleNumber
    || room.players.length !== config.difficulties.length + 1
    || room.players.filter(player => !player.isBot).length !== 1
    || room.players[config.humanSeat]?.id !== room.challenge.humanPlayerId
    || room.players.filter(player => player.isBot).some((player, index) => player.difficulty !== config.difficulties[index])
    || room.turnLimitSeconds !== 0 || room.showMoveHints !== config.showMoveHints) throw new ChallengeError('The saved challenge conditions do not match its frozen definition.');
}

const HUMAN_ACTIONS = new Set<GameAction['type']>(['draw', 'goDown', 'layoff', 'layoffMany', 'discard']);

/** No fallback to the changing social-game engine, including unknown old versions. */
export function applyChallengeAction(original: RoomState, actorId: string, action: GameAction,
  now = Date.now()): ChallengeRoom {
  assertFrozenRoom(original);
  if (original.challenge.deadlineAt !== undefined && now >= original.challenge.deadlineAt) throw new ChallengeError('This attempt has closed. Return to Challenges for your result or a practice replay.', 'CHALLENGE_ATTEMPT_CLOSED');
  if (actorId !== original.challenge.humanPlayerId) throw new ChallengeError('Rejoin your own challenge before playing.', 'NOT_IN_ROOM');
  if (!action || (!HUMAN_ACTIONS.has(action.type) && action.type !== 'botStep')) throw new ChallengeError('Challenge rules and seats are fixed. Start a separate practice attempt for a replay.');
  const { engine, runtime } = engineFor(original.challenge.config, original.challenge.randomCursor, now);
  let room: RoomState = original;
  if (action.type !== 'botStep') {
    room = engine.applyAction(original, actorId, action);
  } else {
    const botId = original.turnPlayerId;
    if (original.status !== 'playing' || !original.players.some(player => player.id === botId && player.isBot)) return original;
    // One turn per request keeps bot animation pacing and the existing room CAS.
    for (let step = 0; step < 14 && room.status === 'playing' && room.turnPlayerId === botId; step++) {
      try {
        room = engine.applyAction(room, actorId, { type: 'botStep' });
      } catch (error) {
        if (!(error instanceof engine.GameError)) throw error;
        const bot = room.players.find(player => player.id === botId)!;
        const fallback: GameAction = room.phase === 'draw'
          ? { type: 'draw', source: room.stock.length || room.discardPile.length > 1 ? 'stock' : 'discard' }
          : { type: 'discard', cardId: [...bot.hand].sort((a, b) => engine.cardPoints(b) - engine.cardPoints(a))[0].id };
        room = engine.applyAction(room, botId, fallback);
      }
    }
    if (room.status === 'playing' && room.turnPlayerId === botId) throw new ChallengeError('Computer turn did not finish. Reconnect and retry.');
    room.version = original.version + 1;
  }
  const next = room as ChallengeRoom;
  next.challenge.randomCursor = runtime.cursor;
  return next;
}

export function publicChallengeInfo(room: ChallengeRoom): PublicChallengeInfo {
  const config = room.challenge.config;
  return {
    id: config.id, engineVersion: config.engineVersion, game: config.game, ruleNumber: config.ruleNumber,
    humanSeat: config.humanSeat, startingSeat: config.startingSeat, difficulties: [...config.difficulties],
    showMoveHints: config.showMoveHints, practice: room.challenge.practice,
    ...(room.challenge.deadlineAt !== undefined ? { deadlineAt: room.challenge.deadlineAt } : {}),
  };
}

export function publicChallengeRoom(room: RoomState, youId: string): PublicChallengeRoom {
  assertFrozenRoom(room);
  if (youId !== room.challenge.humanPlayerId) throw new ChallengeError('This challenge belongs to another player.', 'NOT_IN_ROOM');
  const { engine } = engineFor(room.challenge.config, room.challenge.randomCursor, room.updatedAt);
  const completedRecord = completedRecordFor(room, youId);
  const completedPlay = completedPlayFor(room, youId);
  return { ...engine.publicRoom(room, youId), challenge: publicChallengeInfo(room), ...(completedRecord ? { completedRecord } : {}), ...(completedPlay ? { completedPlay } : {}) };
}

