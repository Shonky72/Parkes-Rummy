import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, chooseBotAction, createPlayer, createRoom, findBotOpening, findOpeningMelds, publicRoom, RULES } from '../lib/rummy';
import { advanceBotTurn } from '../lib/bot-turn';
import type { Card, GameType, RoomState, Suit } from '../lib/types';
let sequence = 0;
const card = (rank: number, suit: Suit): Card => ({ id: `bot-test-${++sequence}`, rank, suit });
function table(game: GameType = 4, rule = 1): RoomState {
  const human = createPlayer({ id: 'human', name: 'Dan', tokenHash: '', color: 0 });
  let room = createRoom('TNFG', human);
  room = applyAction(room, human.id, { type: 'setGame', game });
  room = applyAction(room, human.id, { type: 'addBot', difficulty: 'medium' });
  room = applyAction(room, human.id, { type: 'addBot', difficulty: 'easy' });
  room = applyAction(room, human.id, { type: 'start' });
  const bot = room.players[1]; bot.ruleNumber = rule; bot.completedTurns = 1;
  room.turnPlayerId = bot.id; room.phase = 'play'; room.botDueAt = Date.now() - 300_000;
  return room;
}

test('Original Rule 1: a four-suit set no longer traps Alex in repeated rejected openings', () => {
  const room = table(); const bot = room.players[1];
  bot.hand = [card(10,'H'),card(10,'D'),card(10,'C'),card(10,'S'),card(5,'H'),card(6,'C'),card(7,'D'),card(8,'S'),card(9,'H'),card(12,'C'),card(13,'D')];
  assert.equal(findBotOpening(bot.hand, 4, 1), null);
  for (const difficulty of ['easy','medium','hard'] as const) {
    const action = chooseBotAction(publicRoom(room, bot.id), difficulty);
    assert.equal(action.type, 'discard');
    assert.doesNotThrow(() => applyAction(room, bot.id, action));
  }
  const before = structuredClone(room);
  const next = advanceBotTurn(room, 'human');
  assert.notEqual(next.turnPlayerId, bot.id);
  assert.equal(next.version, room.version + 1);
  assert.deepEqual(room, before, 'No mutation of the input or live seat');
  assert.deepEqual(next.players[0].hand, room.players[0].hand, 'No human move');
});

test('Original Rule 1: search skips invalid generic sets to find printed-suit pairs', () => {
  const hand = [card(10,'H'),card(10,'D'),card(10,'C'),card(10,'S'),card(7,'H'),card(7,'H'),card(7,'C'),card(2,'C'),card(13,'S'),card(5,'D'),card(11,'C')];
  const opening = findBotOpening(hand, 4, 1)!;
  assert.ok(opening);
  const selected = opening.flatMap(m => m.cards);
  assert.ok(findOpeningMelds(selected,4,1));
  assert.equal(selected.length,4);
  assert.ok(selected.every(c => c.rank === 7 || c.rank === 2));
});

test('All ten Original Rules use the same opening validation for AI and human players', () => {
  const rankSet = (rank: number, count: number, suit: Suit = 'H') => Array.from({length:count},()=>card(rank,suit));
  const examples: Card[][] = [
    [card(7,'H'),card(7,'H'),card(7,'C'),card(2,'C')],
    [...rankSet(7,4),...rankSet(9,3,'C'),...rankSet(12,2,'D')],
    Array.from({length:10},(_,i)=>card(5+i,i%2?'H':'D')),
    [...rankSet(7,3),...rankSet(9,3,'C'),...rankSet(2,3,'D')],
    Array.from({length:6},(_,i)=>card(5+i,i%2?'C':'H')),
    [card(10,'H'),card(11,'H'),card(2,'H'),card(13,'H'),card(14,'H')],
    [...rankSet(7,4,'H'),...rankSet(9,4,'C')],
    [card(5,'C'),card(5,'C'),card(6,'D'),card(6,'D'),card(7,'H'),card(2,'H'),card(8,'S'),card(8,'S')],
    [...Array.from({length:6},(_,i)=>card(5+i,'D')),card(14,'H'),card(2,'H')],
    [...Array.from({length:5},(_,i)=>card(5+i,'H')),card(12,'H'),card(12,'H'),card(2,'H')],
  ];
  for (const [index, cards] of examples.entries()) {
    const room=table(4,index+1), bot=room.players[1];
    bot.hand=[...cards,card(13,'S')];
    assert.ok(findOpeningMelds(cards,4,index+1), `Fixture rule ${index+1}`);
    for (const difficulty of ['easy','medium','hard'] as const) {
      const action=chooseBotAction(publicRoom(room,bot.id),difficulty);
      assert.equal(action.type,'goDown', `Rule ${index+1} ${difficulty}`);
      assert.doesNotThrow(()=>applyAction(room,bot.id,action));
    }
    const next=advanceBotTurn(room,'human');
    assert.ok(next.status!=='playing'||next.turnPlayerId!==bot.id);
    assert.ok(next.players[1].down);
  }
});

test('One request completes a draw and discard, without advancing another bot or a human', () => {
  const room=table(), bot=room.players[1]; room.phase='draw'; bot.completedTurns=0;
  const next=advanceBotTurn(room,'human');
  assert.equal(next.turnPlayerId,room.players[2].id);
  assert.equal(next.players[1].completedTurns,1);
  assert.equal(next.players[1].hand.length,10);
  assert.equal(next.players[2].completedTurns,0);
  assert.equal(next.version,room.version+1);
  assert.ok(next.botDueAt-Date.now()<=250);
});

test('Engine botStep remains a single action for compatibility; no work during a human turn', () => {
  const room=table(); room.phase='draw';
  const next=applyAction(room,'human',{type:'botStep'});
  assert.equal(next.phase,'play'); assert.equal(next.turnPlayerId,room.turnPlayerId);
  const human=table(); human.turnPlayerId='human';
  assert.equal(advanceBotTurn(human,'human'),human);
  assert.throws(()=>advanceBotTurn(room,'outsider'));
});

test('Every game/rule/difficulty produces legal bounded computer turns from random deals', () => {
  const started=performance.now();
  for (const game of [1,2,3,4] as const) for(const rule of RULES[game]) for(const difficulty of ['easy','medium','hard'] as const) {
    const room=table(game,rule.number); const bot=room.players[1];
    bot.difficulty=difficulty; room.phase='draw';
    const next=advanceBotTurn(room,'human');
    assert.ok(next.status!=='playing'||next.turnPlayerId!==bot.id,`${game}/${rule.number}/${difficulty}`);
    assert.equal(next.version,room.version+1);
    assert.deepEqual(next.players[0].hand,room.players[0].hand);
  }
  assert.ok(performance.now()-started<20_000,'120 AI turns should not take minutes');
});
