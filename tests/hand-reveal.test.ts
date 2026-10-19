import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createPlayer, createRoom, publicRoom } from '../lib/rummy';
import { completedHandCards, coordinateHandReveal, handRevealDuration, HAND_REVEAL_TIMING } from '../lib/hand-reveal';
import type { WinningCardPlayback } from '../lib/table-motion';

function finishedFixture(quick=false) {
  let room=createRoom('FLIP',createPlayer({id:'a',name:'Host',tokenHash:'a',color:0}));
  room.players.push(createPlayer({id:'b',name:'Guest',tokenHash:'b',color:1}));
  if(quick)room.quickPlay={ruleNumber:9};
  room=applyAction(room,'a',{type:'start'});
  room.phase='play';room.turnPlayerId='a';room.players[0].down=true;
  room.players[0].hand=[{id:'last-card',rank:14,suit:'H'}];
  const before=publicRoom(room,'a');
  const final=applyAction(room,'a',{type:'discard',cardId:'last-card'});
  return {before,final};
}
function deferredPlayback(){
  let land!:()=>void,finish!:()=>void;
  const playback:WinningCardPlayback={landed:new Promise<void>(r=>land=r),finished:new Promise<void>(r=>finish=r),cancel(){land();finish();}};
  return {playback,land,finish};
}
test('only current completed hands reveal opponents; no live or stale-round cards',()=>{
  const {before,final}=finishedFixture();const view=publicRoom(final,'a');
  assert.equal(completedHandCards(before,'b'),null);
  assert.equal((before.players.find(p=>p.id==='b') as unknown as {hand?:unknown}).hand,undefined);
  const cards=completedHandCards(view,'b');assert.equal(cards?.length,10);
  assert.deepEqual(cards,final.players[1].hand);
  assert.deepEqual(completedHandCards(view,'a'),[]);
  assert.equal(completedHandCards(view,'outsider'),null);
  assert.equal(completedHandCards({...view,status:'playing'},'b'),null);
  assert.equal(completedHandCards({...view,round:view.round+1},'b'),null);
  const next=applyAction(final,'a',{type:'nextHand'});
  assert.equal(completedHandCards(publicRoom(next,'a'),'b'),null);
});
test('quick and full-game final score cards retain their authoritative values',()=>{
  const {final}=finishedFixture(true);assert.equal(final.status,'finished');
  for(const viewer of final.players){const view=publicRoom(final,viewer.id);for(const row of final.result!.scores)assert.deepEqual(completedHandCards(view,row.playerId),row.cards);}
});
test('flip starts on landing, before the winner-glow playback finishes',async()=>{
  const source=deferredPlayback();let reveals=0,done=false;
  const playback=coordinateHandReveal(source.playback,()=>{reveals++;},15);
  void playback.finished.then(()=>{done=true;});
  await Promise.resolve();assert.equal(reveals,0);
  source.land();await Promise.resolve();assert.equal(reveals,1);assert.equal(done,false);
  await new Promise(r=>setTimeout(r,25));assert.equal(done,false);
  source.finish();await playback.finished;assert.equal(done,true);assert.equal(reveals,1);
});
test('results wait for card-flip completion when landing glow finishes first',async()=>{
  const source=deferredPlayback();let done=false;
  const p=coordinateHandReveal(source.playback,()=>{},25);void p.finished.then(()=>{done=true;});
  source.land();source.finish();await Promise.resolve();await Promise.resolve();assert.equal(done,false);
  await p.finished;assert.equal(done,true);
});
test('leaving before landing cancels the reveal; leaving during a flip resolves promptly',async()=>{
  const a=deferredPlayback();let count=0;
  const cancelled=coordinateHandReveal(a.playback,()=>{count++;},5000);cancelled.cancel();await cancelled.finished;assert.equal(count,0);
  const b=deferredPlayback();const during=coordinateHandReveal(b.playback,()=>{count++;},5000);
  b.land();await Promise.resolve();assert.equal(count,1);during.cancel();await during.finished;assert.equal(count,1);
});
test('readable stagger duration is bounded and covers the last flipped card',()=>{
  const {final}=finishedFixture();const view=publicRoom(final,'a');
  assert.equal(handRevealDuration(view),HAND_REVEAL_TIMING.flip+9*HAND_REVEAL_TIMING.stagger+HAND_REVEAL_TIMING.hold);
});
