/** Read-only local benchmark: no database, network, accounts or production records. */
import { performance } from 'node:perf_hooks';
import { applyAction, createPlayer, createRoom, enableRecords, findBotOpening, getRuleExample } from '../lib/rummy';
import type { Card, GameType, RoomState, Suit } from '../lib/types';

let seed = 20261020;
const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x100000000; };
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const describe = (values: number[]) => ({ samples: values.length, medianMs: rounded(percentile(values, .5)), p95Ms: rounded(percentile(values, .95)), maxMs: rounded(Math.max(...values)) });
let serial = 0;
function hand(count: number): Card[] {
  const deck = Array.from({ length: 2 }, (_, pack) => (['C', 'D', 'H', 'S'] as Suit[]).flatMap(suit => [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(rank => ({ id: `bench-${pack}-${rank}${suit}-${++serial}`, rank, suit })))).flat();
  for (let index = deck.length - 1; index > 0; index--) { const other = Math.floor(next() * (index + 1)); [deck[index], deck[other]] = [deck[other], deck[index]]; }
  return deck.slice(0, count);
}
function started(game: GameType, ruleNumber: number, playerCount: number): RoomState {
  let room = createRoom('BNCH', createPlayer({ id: 'benchmark-0', name: 'Benchmark', color: 0, tokenHash: '' }));
  for (let index = 1; index < playerCount; index++) room.players.push(createPlayer({ id: `benchmark-${index}`, name: `Synthetic ${index}`, color: index, tokenHash: '' }));
  room.game = game;
  if (playerCount <= 4) room.quickPlay = { ruleNumber };
  enableRecords(room, { eligible: false, exclusionReason: 'local benchmark' });
  room = applyAction(room, 'benchmark-0', { type: 'start' });
  // This local benchmark selects the same rule on every table size.
  for (const player of room.players) {
    player.ruleNumber = ruleNumber;
    room.records!.current[player.id].ruleNumber = ruleNumber;
    room.records!.current[player.id].ruleId = `${game}:${ruleNumber}`;
  }
  room.records!.events = [];
  return room;
}

const readiness: number[] = [];
const examples: number[] = [];
const byRule: { rule: string; readiness: ReturnType<typeof describe> }[] = [];
const actionCases: { players: number; plain: number[]; recorded: number[] }[] = [2, 4, 8].map(players => ({ players, plain: [], recorded: [] }));
for (const game of [1, 2, 3, 4] as const) for (let rule = 1; rule <= 10; rule++) {
  let start = performance.now(); getRuleExample(game, rule); examples.push(performance.now() - start);
  const times: number[] = [];
  for (let sample = 0; sample < 30; sample++) {
    const cards = hand(sample % 2 ? 10 : 11);
    start = performance.now(); findBotOpening(cards, game, rule); times.push(performance.now() - start);
  }
  readiness.push(...times); byRule.push({ rule: `${game}:${rule}`, readiness: describe(times) });
  for (const scenario of actionCases) {
    const recorded = started(game, rule, scenario.players);
    const plain = structuredClone(recorded); delete plain.records;
    for (let sample = 0; sample < 10; sample++) {
      start = performance.now(); applyAction(plain, 'benchmark-0', { type: 'draw', source: 'stock' }); scenario.plain.push(performance.now() - start);
      start = performance.now(); applyAction(recorded, 'benchmark-0', { type: 'draw', source: 'stock' }); scenario.recorded.push(performance.now() - start);
    }
  }
}
console.log(JSON.stringify({
  runtime: process.version, readiness: describe(readiness), exampleCatalogMs: rounded(examples.reduce((sum, value) => sum + value, 0)),
  acceptedDraw: actionCases.map(scenario => ({ players: scenario.players, plain: describe(scenario.plain), recorded: describe(scenario.recorded), medianAddedMs: rounded(percentile(scenario.recorded, .5) - percentile(scenario.plain, .5)) })),
  slowestRules: byRule.sort((a, b) => b.readiness.p95Ms - a.readiness.p95Ms).slice(0, 8),
}, null, 2));
