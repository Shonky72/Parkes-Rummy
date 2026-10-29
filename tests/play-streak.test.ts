import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifiesForPlayStreak, summarizePlayStreak, type PlayCompletionReceipt } from '../lib/play-streak';

const NOW = Date.parse('2026-10-30T01:00:00Z');
let sequence = 0;
function receipt(finishedAt = NOW - 1000, changes: Partial<PlayCompletionReceipt> = {}): PlayCompletionReceipt {
  const id = String(++sequence);
  return {
    gameId:`game-${id}`, handId:`hand-${id}`, status:'completed', startedAt:finishedAt-60_000,
    finishedAt, endActionId:20, eligible:true, exclusionReason:null,
    conditions:{format:'quick-play',singleHand:true},
    gameOutcome:{finished:true,observedFromStart:true}, ...changes,
  };
}
const day = (value: string) => Date.parse(`${value}T01:00:00Z`);

test('empty history reports an unearned streak and the server Sydney date', () => {
  assert.deepEqual(summarizePlayStreak([], NOW), {
    today:'2026-10-30',timeZone:'Australia/Sydney',current:0,best:0,completedToday:false,completedDays:[],
    todayFirstHandId:null,todayFirstCompletedAt:null,
  });
});

test('finishing counts after a loss without an opening; repeats and different modes earn one day', () => {
  const loss = {...receipt(),completed:false,wentOut:false};
  const win = {...receipt(),completed:true,wentOut:true};
  const challenge = receipt(NOW-500,{conditions:{format:'challenge',singleHand:true,challengeId:'daily:2026-10-30'}});
  assert.equal(qualifiesForPlayStreak(loss,NOW),true);
  const summary = summarizePlayStreak([loss,loss,win,challenge],NOW);
  assert.equal(summary.current,1);
  assert.equal(summary.best,1);
  assert.equal(summary.completedToday,true);
  assert.deepEqual(summary.completedDays,['2026-10-30']);
});

test('visits, starts, withdrawals, interruptions and missing finish receipts never earn credit', () => {
  const rows = [
    receipt(NOW-1000,{status:'started'}), receipt(NOW-1000,{status:'abandoned'}),
    receipt(NOW-1000,{status:'service-interrupted'}), receipt(NOW-1000,{finishedAt:null}),
    receipt(NOW-1000,{endActionId:null}), receipt(NOW-1000,{gameOutcome:null}),
    receipt(NOW-1000,{gameOutcome:{finished:false,observedFromStart:true}}),
    receipt(NOW-1000,{gameOutcome:{finished:true,observedFromStart:false}}),
  ];
  assert.ok(rows.every(row=>!qualifiesForPlayStreak(row,NOW)));
  assert.equal(summarizePlayStreak(rows,NOW).current,0);
});

test('a complete observed social or ranked game counts; intermediate hands and forfeits do not', () => {
  for (const format of ['full-game','ranked'] as const) {
    const full = receipt(NOW-1000,{conditions:{format}});
    assert.equal(qualifiesForPlayStreak(full,NOW),true);
    assert.equal(qualifiesForPlayStreak({...full,gameOutcome:{finished:false,observedFromStart:true}},NOW),false);
    assert.equal(qualifiesForPlayStreak({...full,conditions:{format,singleHand:true}},NOW),false);
    assert.equal(qualifiesForPlayStreak({...full,status:'abandoned'},NOW),false);
    assert.equal(qualifiesForPlayStreak({...full,status:'service-interrupted',eligible:false},NOW),false);
  }
});

test('finished challenge practice earns participation credit without accepting other exclusions', () => {
  const practice = receipt(NOW-1000,{
    conditions:{format:'challenge',singleHand:true,challengeId:'daily:2026-10-29'},
    eligible:false,exclusionReason:'challenge practice replay',
  });
  assert.equal(qualifiesForPlayStreak(practice,NOW),true);
  assert.equal(qualifiesForPlayStreak({...practice,exclusionReason:'guest seat'},NOW),false);
  assert.equal(qualifiesForPlayStreak({...practice,exclusionReason:'confirmed service interruption'},NOW),false);
  assert.equal(qualifiesForPlayStreak({...practice,conditions:{format:'quick-play'}},NOW),false);
});

test('current streak survives today until a full day is missed and best stays intact', () => {
  const rows = [receipt(day('2026-10-28')),receipt(day('2026-10-29'))];
  const today = summarizePlayStreak(rows,NOW);
  assert.equal(today.current,2);
  assert.equal(today.completedToday,false);
  assert.equal(today.best,2);
  const tomorrow = summarizePlayStreak(rows,day('2026-10-31'));
  assert.equal(tomorrow.current,0);
  assert.equal(tomorrow.best,2);
});

test('best spans all history while completedDays reveals only this Monday to Sunday week', () => {
  const dates = ['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-29','2026-10-30'];
  const summary = summarizePlayStreak(dates.reverse().map(value=>receipt(day(value))),NOW);
  assert.equal(summary.current,2);
  assert.equal(summary.best,5);
  assert.deepEqual(summary.completedDays,['2026-10-29','2026-10-30']);
});

test('Sydney completion date decides credit across midnight, independently of challenge date', () => {
  const before = Date.parse('2026-10-29T12:59:59Z');
  const after = Date.parse('2026-10-29T13:00:00Z');
  const rows = [receipt(before),receipt(after,{
    startedAt:before-60_000,conditions:{format:'challenge',singleHand:true,challengeId:'daily:2026-10-29'},
  })];
  const summary = summarizePlayStreak(rows,after+1);
  assert.equal(summary.today,'2026-10-30');
  assert.equal(summary.current,2);
  assert.deepEqual(summary.completedDays,['2026-10-29','2026-10-30']);
});

test('streaks follow civil days across both Sydney daylight saving transitions', () => {
  const spring = ['2026-10-03T02:00:00Z','2026-10-04T01:00:00Z','2026-10-05T01:00:00Z'].map(Date.parse);
  const autumn = ['2026-04-04T01:00:00Z','2026-04-05T02:00:00Z','2026-04-06T02:00:00Z'].map(Date.parse);
  for (const dates of [spring,autumn]) {
    const summary=summarizePlayStreak(dates.map(value=>receipt(value)),dates.at(-1)!+1);
    assert.equal(summary.current,3);
    assert.equal(summary.best,3);
  }
});

test('invalid, future or backwards timestamps cannot manufacture a completed day', () => {
  const rows = [receipt(NOW+1),receipt(NaN),receipt(Infinity),receipt(NOW-1000,{startedAt:NOW}),
    receipt(NOW-1000,{endActionId:-1}),receipt(NOW-1000,{endActionId:1.5})];
  assert.equal(summarizePlayStreak(rows,NOW).best,0);
});

test('today first completion identifies only the earliest qualifying hand with stable tie breaking', () => {
  const firstTime=NOW-3000;
  const later=receipt(NOW-1000,{handId:'later'});
  const first=receipt(firstTime,{handId:'a-first'});
  const tied=receipt(firstTime,{handId:'b-tied'});
  const abandoned=receipt(firstTime-1000,{handId:'not-earned',status:'abandoned'});
  const yesterday=receipt(day('2026-10-29'),{handId:'yesterday'});
  const summary=summarizePlayStreak([later,tied,abandoned,yesterday,first,first],NOW);
  assert.equal(summary.todayFirstHandId,'a-first');
  assert.equal(summary.todayFirstCompletedAt,firstTime);
  const tomorrow=summarizePlayStreak([first],day('2026-10-31'));
  assert.equal(tomorrow.todayFirstHandId,null);
  assert.equal(tomorrow.todayFirstCompletedAt,null);
});
