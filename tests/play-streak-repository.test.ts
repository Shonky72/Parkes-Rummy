import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite,type Transaction} from '@electric-sql/pglite';
import type {QueryResultRow} from 'pg';
import {RecordsRepository} from '../db/records';
import type {SqlConnection,SqlDatabase} from '../db';
import type {PlayCompletionReceipt} from '../lib/play-streak';

const pg=new PGlite();
const statements:string[]=[];
function connection(target:Pick<PGlite|Transaction,'query'>):SqlConnection {
  return {async query<T extends QueryResultRow>(sql:string,values?:unknown[]) {
    statements.push(sql);
    const result=await target.query<T>(sql,values);
    return {rows:result.rows,rowCount:result.affectedRows??result.rows.length};
  }};
}
const db:SqlDatabase={...connection(pg),transaction:work=>pg.transaction(tx=>work(connection(tx)))};
const records=new RecordsRepository(db);
const NOW=Date.parse('2026-10-30T01:00:00Z');
let sequence=0;
async function save(owner:string,finishedAt:number,changes:Partial<PlayCompletionReceipt>={}) {
  const id=String(++sequence);
  const receipt:PlayCompletionReceipt={gameId:`game-${id}`,handId:`hand-${id}`,status:'completed',
    startedAt:finishedAt-60_000,finishedAt,endActionId:20,eligible:true,exclusionReason:null,
    conditions:{format:'quick-play',singleHand:true},gameOutcome:{finished:true,observedFromStart:true},...changes};
  await db.query(`INSERT INTO records_evidence(user_id,hand_id,game_id,player_id,room_code,rule_id,status,
    source_event,started_at,updated_at,payload) VALUES($1,$2,$3,$4,'TEST','1:1',$5,$6,$7,$8,$9::jsonb)`,
  [owner,receipt.handId,receipt.gameId,`seat-${id}`,receipt.status,`event-${id}`,receipt.startedAt,
    receipt.finishedAt??receipt.startedAt,JSON.stringify({...receipt,completed:false,wentOut:false,
      timeline:[{text:'Private full hand and card history'}],actualOpening:null})]);
  return receipt;
}
before(async()=>{
  await pg.exec('CREATE TABLE "user"(id text PRIMARY KEY)');
  await records.ensure();
  await pg.exec("INSERT INTO \"user\"(id) VALUES('owner'),('other'),('qualification')");
});
after(async()=>{await pg.close();});

test('saved completion summary isolates account history and never creates profiles or changes evidence',async()=>{
  await save('owner',Date.parse('2026-10-28T01:00:00Z'));
  await save('owner',Date.parse('2026-10-29T01:00:00Z'));
  await save('other',NOW-1000);
  const beforeRows=await pg.query('SELECT * FROM records_evidence ORDER BY user_id,hand_id');
  statements.length=0;
  const summary=await records.playStreak('owner',NOW);
  assert.equal(summary.current,2);assert.equal(summary.best,2);assert.equal(summary.completedToday,false);
  assert.deepEqual(summary.completedDays,['2026-10-28','2026-10-29']);
  assert.equal(summary.todayFirstHandId,null);assert.equal(summary.todayFirstCompletedAt,null);
  assert.equal(statements.length,1);assert.match(statements[0],/^SELECT /);
  assert.ok(!JSON.stringify(summary).includes('Private'));
  assert.deepEqual((await pg.query('SELECT * FROM records_evidence ORDER BY user_id,hand_id')).rows,beforeRows.rows);
  assert.deepEqual((await pg.query('SELECT * FROM records_profiles')).rows,[]);
  const tomorrow=await records.playStreak('owner',Date.parse('2026-10-31T01:00:00Z'));
  assert.equal(tomorrow.current,0);assert.equal(tomorrow.best,2);
});

test('database receipts include completed practice losses but exclude unfinished and intermediate rounds',async()=>{
  await save('qualification',NOW-6000,{status:'started'});
  await save('qualification',NOW-5000,{status:'abandoned'});
  await save('qualification',NOW-4000,{conditions:{format:'full-game'},gameOutcome:{finished:false,observedFromStart:true}});
  await save('qualification',NOW-3000,{eligible:false,exclusionReason:'guest seat'});
  const practice=await save('qualification',NOW-2000,{eligible:false,exclusionReason:'challenge practice replay',
    conditions:{format:'challenge',singleHand:true,challengeId:'daily:2026-10-29'}});
  await save('qualification',NOW-1000);
  const summary=await records.playStreak('qualification',NOW);
  assert.equal(summary.current,1);assert.equal(summary.best,1);assert.equal(summary.completedToday,true);
  assert.deepEqual(summary.completedDays,['2026-10-30']);
  assert.equal(summary.todayFirstHandId,practice.handId);
  assert.equal(summary.todayFirstCompletedAt,practice.finishedAt);
});
