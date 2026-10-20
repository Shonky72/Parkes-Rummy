import { ladderRepository, type LadderRepository, type RankedMatchPreview } from '../db/ladder';
import { requestSecurity, SecurityError, type RequestSecurity } from '../db/security';
import { resolveAccountUser } from './auth';
import { ACCOUNT_IDENTITY_HEADER, accountMarker, type AccountUser } from './auth-config';
import { isAllowedRoomWriteOrigin } from './request-origin';
import { boundedJson } from './request-body';
import { isProductionDeployment } from './deployment-context';

export const LADDER_PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store',
  'Netlify-CDN-Cache-Control': 'no-store', Vary: 'Cookie, Authorization, X-Parkes-Identity',
  'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
};
type Resolver = (request: Request) => Promise<AccountUser | null>;
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new SecurityError(`Choose a valid ${label}.`, 400);
  return value;
}
function failure(error: unknown): Response {
  if (error instanceof SecurityError) return Response.json({ error: error.message }, {
    status: error.status, headers: { ...LADDER_PRIVATE_HEADERS, ...(error.status === 429 ? { 'Retry-After': String(error.retryAfter) } : {}) },
  });
  return Response.json({ error: 'Ranked play is unavailable for the moment. Please reconnect.' }, { status: 503, headers: LADDER_PRIVATE_HEADERS });
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: LADDER_PRIVATE_HEADERS });

export function createLadderHandlers(options: {
  ladder?: LadderRepository; security?: RequestSecurity; resolveSession?: Resolver; now?: () => number; enabled?: boolean;
} = {}) {
  const ladder = options.ladder ?? ladderRepository, security = options.security ?? requestSecurity;
  const resolve = options.resolveSession ?? resolveAccountUser, now = options.now ?? Date.now;
  const enabled = options.enabled ?? isProductionDeployment();
  async function authenticate(request: Request, write: boolean): Promise<AccountUser> {
    // Snapshot creates an account's initial ladder row. Gate both routes before
    // authentication, rate-limit writes or any repository call in a preview.
    if (!enabled) throw new SecurityError('Continue ranked play on parkesrummy.com. Preview deployments do not create or change ladder records.', 409);
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (write && !isAllowedRoomWriteOrigin(request))
      || (request.headers.has('Origin') && !isAllowedRoomWriteOrigin(request))) throw new SecurityError('Open Parkes Rummy directly to continue.', 403);
    const user = await resolve(request);
    if (!user) throw new SecurityError('Sign in with Google for ranked play.', 401);
    if (request.headers.get(ACCOUNT_IDENTITY_HEADER) !== accountMarker(user.id)) throw new SecurityError('Your account changed. Reconnect to continue.', 401);
    return user;
  }
  function matchReply(match: RankedMatchPreview, user: AccountUser, status = 200): Response {
    return reply({ match, ...(match.state === 'active' && match.roomCode ? { roomCode: match.roomCode, token: accountMarker(user.id) } : {}) }, status);
  }
  return {
    snapshot: async (request: Request): Promise<Response> => {
      try {
        const user = await authenticate(request, false);
        await security.check(request, 'read', user.id);
        const url = new URL(request.url);
        if (url.searchParams.has('matchId')) return reply({ match: await ladder.match(user.id, identifier(url.searchParams.get('matchId'), 'ranked match'), now()) });
        return reply(await ladder.snapshot(user.id, now()));
      } catch (error) { return failure(error); }
    },
    mutate: async (request: Request): Promise<Response> => {
      try {
        const user = await authenticate(request, true);
        const body = await boundedJson(request, 4096);
        const creation = ['invite', 'accept', 'joinQueue'].includes(String(body.action));
        await security.check(request, body.action === 'heartbeat' ? 'presence' : creation ? 'create' : 'profile', user.id);
        switch (body.action) {
          case 'invite': return matchReply(await ladder.invite(user.id, identifier(body.friendId, 'friend'), body.consent, now()), user, 201);
          case 'accept': return matchReply(await ladder.accept(user.id, identifier(body.matchId, 'ranked match'), body.consent, now()), user);
          case 'cancel': case 'decline': return matchReply(await ladder.invitationAction(user.id, identifier(body.matchId, 'ranked match'), body.action, now()), user);
          case 'joinQueue': {
            const result = await ladder.joinQueue(user.id, body.consent, now());
            return result.match ? matchReply(result.match, user) : reply(result);
          }
          case 'leaveQueue': await ladder.leaveQueue(user.id); return reply({ ok: true, waiting: false });
          case 'heartbeat': await ladder.heartbeat(user.id, body.matchId === undefined ? undefined : identifier(body.matchId, 'ranked match'), now()); return reply({ ok: true });
          case 'forfeit': case 'claimForfeit': return matchReply(await ladder.forfeit(user.id, identifier(body.matchId, 'ranked match'), body.action === 'claimForfeit', now()), user);
          case 'voidMatch': await ladder.voidMatch(user, identifier(body.matchId, 'ranked match'), body.reason, now()); return reply({ ok: true });
          default: throw new SecurityError('Choose a ranked action.', 400);
        }
      } catch (error) { return failure(error); }
    },
  };
}
const handlers = createLadderHandlers();
export const readLadder = handlers.snapshot;
export const writeLadder = handlers.mutate;
