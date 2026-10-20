import { database, type SqlDatabase } from './index';
import { createPlayer } from '../lib/rummy';
import type { PlayerState, RoomState } from '../lib/types';
import { SecurityError } from './security';

export const JOIN_SCHEMA = `DO $$ BEGIN CREATE TABLE IF NOT EXISTS join_requests (
 id text PRIMARY KEY, room_code text NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, room_instance bigint NOT NULL,
 actor text NOT NULL, user_id text REFERENCES "user"(id) ON DELETE CASCADE, player text NOT NULL,
 status text NOT NULL, expires_at bigint NOT NULL, UNIQUE(room_code,room_instance,actor));
 CREATE INDEX IF NOT EXISTS join_requests_expiry ON join_requests(expires_at); END $$;`;
export interface JoinEntry { id:string; room_code:string; room_instance:string; actor:string; user_id:string|null; player:string; status:'pending'|'approved'|'declined'|'cancelled'; expires_at:string }
export class PostgresJoinRequests {
  private ready: Promise<unknown>|undefined;
  constructor(private readonly db:SqlDatabase=database){}
  async ensure(){this.ready??=this.db.query(JOIN_SCHEMA).catch(e=>{this.ready=undefined;throw e;});await this.ready;}
  async submit(code:string,instance:number,actor:string,userId:string|null,player:PlayerState,validateRoom?:(room:RoomState)=>void){
    await this.ensure();
    return this.db.transaction(async c=>{
      const locked=await c.query<{state:string}>('SELECT state FROM rooms WHERE code=$1 FOR UPDATE',[code]);
      const room=locked.rows[0]?JSON.parse(locked.rows[0].state) as RoomState:null;
      if(!room||room.createdAt!==instance||room.status!=='lobby')throw new SecurityError('This lobby is no longer open.',409);
      // Recheck against the locked state if production started/rematched after
      // the handler's initial read. A preview cannot bypass collection guards.
      validateRoom?.(room);
      const now=Date.now();
      await c.query('DELETE FROM join_requests WHERE expires_at<=$1',[now]);
      const prior=await c.query<JoinEntry>('SELECT * FROM join_requests WHERE room_code=$1 AND room_instance=$2 AND actor=$3',[code,instance,actor]);
      if(prior.rows[0]&&prior.rows[0].status!=='cancelled')return prior.rows[0];
      if(room.players.length>=8)throw new SecurityError('This table has eight players.',409);
      const count=await c.query<{count:string}>("SELECT count(*) AS count FROM join_requests WHERE room_code=$1 AND room_instance=$2 AND status='pending'",[code,instance]);
      if(Number(count.rows[0].count)>=24)throw new SecurityError('The host has several requests to review. Please try again shortly.',429);
      const result=await c.query<JoinEntry>(`INSERT INTO join_requests(id,room_code,room_instance,actor,user_id,player,status,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,'pending',$7) ON CONFLICT(room_code,room_instance,actor) DO UPDATE SET
        id=EXCLUDED.id,player=EXCLUDED.player,status='pending',expires_at=EXCLUDED.expires_at RETURNING *`,
        [crypto.randomUUID(),code,instance,actor,userId,JSON.stringify(player),now+600_000]);
      return result.rows[0];
    });
  }
  async list(code:string,instance:number){await this.ensure();return (await this.db.query<JoinEntry>("SELECT * FROM join_requests WHERE room_code=$1 AND room_instance=$2 AND status='pending' AND expires_at>$3 ORDER BY expires_at",[code,instance,Date.now()])).rows;}
  async own(code:string,instance:number,actor:string){await this.ensure();return (await this.db.query<JoinEntry>('SELECT * FROM join_requests WHERE room_code=$1 AND room_instance=$2 AND actor=$3 AND expires_at>$4',[code,instance,actor,Date.now()])).rows[0]??null;}
  async cancel(code:string,instance:number,actor:string){await this.ensure();await this.db.query("UPDATE join_requests SET status='cancelled' WHERE room_code=$1 AND room_instance=$2 AND actor=$3 AND status='pending'",[code,instance,actor]);}
  async decide(code:string,instance:number,hostId:string,id:string,approve:boolean,validateRoom?:(room:RoomState)=>void){
    await this.ensure();
    return this.db.transaction(async c=>{
      const r=await c.query<{state:string;version:number}>('SELECT state,version FROM rooms WHERE code=$1 FOR UPDATE',[code]);
      const room=r.rows[0]?JSON.parse(r.rows[0].state) as RoomState:null;
      if(!room||room.createdAt!==instance||room.hostId!==hostId)throw new SecurityError('Only the current host can review this request.',403);
      validateRoom?.(room);
      const rows=await c.query<JoinEntry>('SELECT * FROM join_requests WHERE id=$1 AND room_code=$2 AND room_instance=$3 FOR UPDATE',[id,code,instance]);
      const entry=rows.rows[0];
      if(!entry||Number(entry.expires_at)<=Date.now())throw new SecurityError('This request has expired.',410);
      if(entry.status!=='pending')return entry.status;
      if(approve){
        if(room.status!=='lobby'||room.players.length>=8)throw new SecurityError('The lobby is closed or full.',409);
        const candidate=JSON.parse(entry.player) as PlayerState;
        if(room.players.some(p=>p.name.toLocaleLowerCase()===candidate.name.toLocaleLowerCase()))throw new SecurityError('A player at this table already uses that name.',409);
        const color=Array.from({length:8},(_,i)=>i).find(i=>!room.players.some(p=>p.color===i))!;
        room.players.push(createPlayer({...candidate,color}));
        room.version=r.rows[0].version+1;room.updatedAt=Date.now();
        room.events=[...room.events,{id:(room.events.at(-1)?.id??0)+1,type:'join' as const,playerId:candidate.id,text:`${candidate.name} joined the table`,at:Date.now()}].slice(-40);
        await c.query('UPDATE rooms SET state=$1,version=$2,updated_at=$3 WHERE code=$4',[JSON.stringify(room),room.version,room.updatedAt,code]);
        if(entry.user_id)await c.query('INSERT INTO room_memberships(room_code,user_id,player_id) VALUES($1,$2,$3)',[code,entry.user_id,candidate.id]);
      }
      const status=approve?'approved':'declined';
      await c.query('UPDATE join_requests SET status=$1 WHERE id=$2',[status,id]);
      return status;
    });
  }
}
