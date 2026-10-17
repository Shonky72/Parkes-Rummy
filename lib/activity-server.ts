import { createHash } from 'node:crypto';
import { database, type SqlDatabase } from '../db';
import { ActivityRepository, activityRepository, activityHash } from '../db/activity';
import { PostgresRoomRepository, type RoomRepository } from '../db/room-repository';
import { resolveAccountUser } from './auth';
import { ACCOUNT_IDENTITY_HEADER, accountMarker, type AccountUser } from './auth-config';
import { isAllowedRoomWriteOrigin } from './request-origin';
import { validActivityPulse, type ActivityPlace } from './activity-types';

export const ACTIVITY_OWNER_EMAIL = 'dan@ibdcollective.net';
const privateHeaders = { 'Cache-Control':'private, no-store, max-age=0', 'CDN-Cache-Control':'no-store', 'Netlify-CDN-Cache-Control':'no-store', 'Vary':'Cookie, Authorization', 'X-Robots-Tag':'noindex, nofollow' };
const error = (status:number,message:string) => Response.json({error:message},{status,headers:privateHeaders});
type Resolver = (request:Request) => Promise<AccountUser|null>;

/** The server session, verified database email AND Google linkage must all agree.
 * Complimentary full access, display names, request bodies and caller headers grant no owner privilege.
 */
export async function isActivityOwner(user:AccountUser|null, db:SqlDatabase=database):Promise<boolean> {
  if (!user || user.email.trim().toLowerCase() !== ACTIVITY_OWNER_EMAIL) return false;
  const result = await db.query(`SELECT u.id FROM "user" u WHERE u.id=$1 AND lower(trim(u.email))=$2 AND u."emailVerified"=true
    AND EXISTS(SELECT 1 FROM "account" a WHERE a."userId"=u.id AND a."providerId"='google') LIMIT 1`,[user.id,ACTIVITY_OWNER_EMAIL]);
  return result.rows.length === 1;
}
export function createActivityHandlers(options:{resolveSession?:Resolver; db?:SqlDatabase; activity?:ActivityRepository; rooms?:RoomRepository}={}) {
  const resolve = options.resolveSession??resolveAccountUser;
  const db = options.db??database;
  const activity = options.activity??activityRepository;
  const rooms = options.rooms??new PostgresRoomRepository();
  return {
    snapshot: async (request:Request) => {
      try {
        if (request.headers.get('Sec-Fetch-Site')==='cross-site') return error(403,'Owner access required.');
        const user = await resolve(request);
        if (!user) return error(401,'Sign in with the owner Google account to view activity.');
        if (!await isActivityOwner(user,db)) return error(403,'Owner access required.');
        return Response.json(await activity.snapshot(),{headers:privateHeaders});
      } catch { return error(503,'Activity is unavailable for the moment. Game play is unaffected.'); }
    },
    pulse: async (request:Request) => {
      try {
        if (!isAllowedRoomWriteOrigin(request)) return error(403,'Open Parkes Rummy directly.');
        if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return error(415,'JSON required.');
        if (Number(request.headers.get('Content-Length')??0)>2048) return error(413,'Request too large.');
        const raw = await request.text();
        if (new TextEncoder().encode(raw).length>2048) return error(413,'Request too large.');
        let pulse:unknown;
        try { pulse=JSON.parse(raw); } catch { return error(400,'Invalid presence.'); }
        if (!validActivityPulse(pulse)) return error(400,'Invalid presence.');
        const user = await resolve(request);
        const identity = user?accountMarker(user.id):'guest';
        if (request.headers.get(ACCOUNT_IDENTITY_HEADER)!==identity) return error(401,'Your account changed.');
        const actorKey = activityHash(user?`account:${user.id}`:`guest:${pulse.guestId}`);
        const sessionKey = activityHash(`${actorKey}:${pulse.tabId}`);
        if (!pulse.visible) {
          await activity.leave(sessionKey,actorKey);
          return new Response(null,{status:204,headers:privateHeaders});
        }
        let name = user?.name||pulse.name?.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,24)||'Guest';
        let place:ActivityPlace='home';
        let code:string|null=null;
        if (pulse.roomCode) {
          const record = await rooms.load(pulse.roomCode);
          if (!record) return error(404,'Table not found.');
          const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
          const digest = token?createHash('sha256').update(token).digest('hex'):null;
          const member = user?record.memberships.find(m=>m.userId===user.id):null;
          const player = record.room.players.find(p=>!p.isBot && (user ? p.id===member?.playerId : digest===p.tokenHash && !record.memberships.some(m=>m.playerId===p.id)));
          if (!player) return error(403,'This seat is not available to this account.');
          code=record.room.code;
          name=user?.name||player.name;
          place=record.room.status==='playing'?'playing':record.room.status==='lobby'?'lobby':'results';
        }
        await activity.pulse({sessionKey,actorKey,userId:user?.id??null,name,roomCode:code,place});
        return new Response(null,{status:204,headers:privateHeaders});
      } catch { return error(503,'Activity is unavailable for the moment.'); }
    },
  };
}
const handlers = createActivityHandlers();
export const readActivity = handlers.snapshot;
export const recordPresence = handlers.pulse;
