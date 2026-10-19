import {boundedJson} from './request-body';
import { secureRoute } from './secure-route';
import { accountMarker } from './auth-config';
import { database } from '../db';
import { resolveAccountUser } from './auth';
import { ensureStoreSchema, hasEntitlement, VOICE_CHAT_ENTITLEMENT } from '../db/entitlements';
import { isRoomCode, normalizeRoomCode } from './room-code';

type VoiceAction = 'join' | 'poll' | 'signal' | 'block' | 'leave';
type SignalKind = 'offer' | 'answer' | 'candidate';
const PRESENCE_TTL = 30_000;
const SIGNAL_TTL = 90_000;
function reply(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control':'no-store' } }); }
function codeOf(value: unknown) { const code = typeof value === 'string' ? normalizeRoomCode(value) : ''; if (!isRoomCode(code)) throw new Error('ROOM'); return code; }
async function member(userId: string, code: string) {
  const result = await database.query<{ player_id:string; state:string }>(
    `SELECT m.player_id, r.state FROM room_memberships m JOIN rooms r ON r.code = m.room_code
     WHERE m.user_id = $1 AND m.room_code = $2 AND m.hidden = false`, [userId, code],
  );
  const row = result.rows[0];
  if (!row) return null;
  const state = JSON.parse(row.state) as { players?: Array<{id:string;name:string;isBot?:boolean}> };
  const player = state.players?.find(item => item.id === row.player_id && !item.isBot);
  return player ? { playerId:row.player_id, name:player.name } : null;
}
async function clean(code: string, now: number) {
  await database.query('DELETE FROM voice_presence WHERE room_code = $1 AND last_seen < $2', [code, now - PRESENCE_TTL]);
  await database.query('DELETE FROM voice_signals WHERE room_code = $1 AND created_at < $2', [code, now - SIGNAL_TTL]);
}
async function blockedFor(code: string, playerId: string) {
  const result = await database.query<{ other:string }>(
    `SELECT CASE WHEN blocker_player_id = $2 THEN blocked_player_id ELSE blocker_player_id END AS other
     FROM voice_blocks WHERE room_code = $1 AND (blocker_player_id = $2 OR blocked_player_id = $2)`, [code, playerId],
  );
  return [...new Set(result.rows.map(row => row.other))];
}
async function pairBlocked(code: string, a: string, b: string) {
  const result = await database.query<{ exists:boolean }>(
    `SELECT EXISTS(SELECT 1 FROM voice_blocks WHERE room_code=$1 AND ((blocker_player_id=$2 AND blocked_player_id=$3) OR (blocker_player_id=$3 AND blocked_player_id=$2))) AS exists`,
    [code,a,b],
  );
  return Boolean(result.rows[0]?.exists);
}
async function cloudflareIceServers(): Promise<RTCIceServer[] | null> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (!keyId || !token) return null;
  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method:'POST',
        headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ ttl:28_800 }),
        cache:'no-store',
      },
    );
    if (!response.ok) return null;
    const data = await response.json() as { iceServers?: RTCIceServer[] };
    return Array.isArray(data.iceServers) && data.iceServers.length ? data.iceServers : null;
  } catch { return null; }
}
async function iceServers() {
  const cloudflare = await cloudflareIceServers();
  if (cloudflare) return cloudflare;
  const servers: RTCIceServer[] = [{ urls:'stun:stun.cloudflare.com:3478' }, { urls:'stun:stun.l.google.com:19302' }];
  const url = process.env.VOICE_TURN_URL?.trim();
  const username = process.env.VOICE_TURN_USERNAME?.trim();
  const credential = process.env.VOICE_TURN_CREDENTIAL?.trim();
  if (url && username && credential) servers.push({ urls:url, username, credential });
  return servers;
}
async function handleVoice(request: Request) {

  const user = await resolveAccountUser(request);
  if (!user) return reply({ error:'Sign in to use table voice.' }, 401);
  if(request.headers.get('X-Parkes-Identity')!==accountMarker(user.id))return reply({error:'Your account changed.'},401);
  await ensureStoreSchema();
  if (!await hasEntitlement(user.id, VOICE_CHAT_ENTITLEMENT)) return reply({ error:'Voice Chat is not owned on this account.' }, 403);
  const body = await boundedJson(request,32_768);
  const action = body.action as VoiceAction;
  let code = '';
  try { code = codeOf(body.code); } catch { return reply({ error:'Choose a valid room.' }, 400); }
  const membership = await member(user.id, code);
  if (!membership) return reply({ error:'Join this table before joining voice.' }, 403);
  const now = Date.now();
  await clean(code, now);
  if (action === 'leave') {
    await database.query('DELETE FROM voice_presence WHERE room_code=$1 AND player_id=$2', [code,membership.playerId]);
    await database.query('DELETE FROM voice_signals WHERE room_code=$1 AND (sender_player_id=$2 OR recipient_player_id=$2)', [code,membership.playerId]);
    return reply({ ok:true });
  }
  await database.query(
    `INSERT INTO voice_presence (room_code, player_id, user_id, joined_at, last_seen) VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (room_code, player_id) DO UPDATE SET user_id=EXCLUDED.user_id,last_seen=EXCLUDED.last_seen`,
    [code,membership.playerId,user.id,now],
  );
  if (action === 'block') {
    const other = typeof body.playerId === 'string' ? body.playerId : '';
    const actualPeer=await database.query('SELECT 1 FROM voice_presence WHERE room_code=$1 AND player_id=$2',[code,other]);
    if (!actualPeer.rows.length || !other || other === membership.playerId) return reply({ error:'Choose another player.' }, 400);
    const blocked = body.blocked === true;
    if (blocked) await database.query(
      `INSERT INTO voice_blocks (room_code, blocker_player_id, blocked_player_id, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (room_code, blocker_player_id, blocked_player_id) DO NOTHING`, [code,membership.playerId,other,now],
    );
    else await database.query('DELETE FROM voice_blocks WHERE room_code=$1 AND blocker_player_id=$2 AND blocked_player_id=$3', [code,membership.playerId,other]);
    return reply({ blockedPlayerIds:await blockedFor(code,membership.playerId) });
  }
  if (action === 'signal') {
    const recipient = typeof body.playerId === 'string' ? body.playerId : '';
    const kind = body.kind as SignalKind;
    const payload = typeof body.payload === 'string' ? body.payload : '';
    if (!recipient || recipient === membership.playerId || !['offer','answer','candidate'].includes(kind) || !payload || payload.length > 24_000) return reply({ error:'Voice signal was rejected.' }, 400);
    const present = await database.query('SELECT 1 FROM voice_presence WHERE room_code=$1 AND player_id=$2 AND last_seen >= $3', [code,recipient,now-PRESENCE_TTL]);
    if (!present.rowCount || await pairBlocked(code,membership.playerId,recipient)) return reply({ ok:false });
    await database.query(
      `INSERT INTO voice_signals (room_code,sender_player_id,recipient_player_id,kind,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [code,membership.playerId,recipient,kind,payload,now],
    );
    return reply({ ok:true });
  }
  if (action !== 'join' && action !== 'poll') return reply({ error:'Choose a voice action.' }, 400);
  const since = Number.isFinite(Number(body.since)) ? Math.max(0, Number(body.since)) : 0;
  const [presence, signals, blocked] = await Promise.all([
    database.query<{player_id:string;state:string}>(
      `SELECT p.player_id,r.state FROM voice_presence p JOIN rooms r ON r.code=p.room_code
       WHERE p.room_code=$1 AND p.player_id<>$2 AND p.last_seen >= $3 ORDER BY p.joined_at`, [code,membership.playerId,now-PRESENCE_TTL]),
    database.query<{id:string;sender_player_id:string;kind:SignalKind;payload:string}>(
      `SELECT id::text,sender_player_id,kind,payload FROM voice_signals WHERE room_code=$1 AND recipient_player_id=$2 AND id>$3 ORDER BY id LIMIT 100`,
      [code,membership.playerId,since],
    ),
    blockedFor(code,membership.playerId),
  ]);
  const peers = presence.rows.flatMap(row => {
    try { const state=JSON.parse(row.state) as {players?:Array<{id:string;name:string;isBot?:boolean}>}; const p=state.players?.find(x=>x.id===row.player_id&&!x.isBot); return p?[{id:p.id,name:p.name}]:[]; } catch { return []; }
  });
  const latestSignalId = signals.rows.reduce((max,row)=>Math.max(max,Number(row.id)||0),since);
  return reply({ playerId:membership.playerId, peers, blockedPlayerIds:blocked, signals:signals.rows.map(row=>({id:Number(row.id),from:row.sender_player_id,kind:row.kind,payload:row.payload})), latestSignalId, iceServers:action==='join'?await iceServers():undefined });
}

export const voiceRequest=secureRoute('voice',handleVoice);
