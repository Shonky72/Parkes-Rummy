import { recordsRepository, type RecordsRepository } from '../db/records';
import { requestSecurity, SecurityError, type RequestSecurity } from '../db/security';
import { resolveAccountUser } from './auth';
import { ACCOUNT_IDENTITY_HEADER, accountMarker, type AccountUser } from './auth-config';
import { isProductionDeployment } from './deployment-context';
import { RECORDS_PRIVATE_HEADERS } from './records-server';
import { isAllowedRoomWriteOrigin } from './request-origin';

type Resolver = (request: Request) => Promise<AccountUser | null>;

export function createPlayStreakHandler(options: {
  records?: Pick<RecordsRepository, 'playStreak'>;
  security?: RequestSecurity;
  resolveSession?: Resolver;
  enabled?: boolean;
  now?: () => number;
} = {}) {
  const records = options.records ?? recordsRepository;
  const security = options.security ?? requestSecurity;
  const resolve = options.resolveSession ?? resolveAccountUser;
  const enabled = options.enabled ?? isProductionDeployment();
  const now = options.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== 'GET') return Response.json({error:'Use GET to read your play streak.'}, {
        status:405, headers:{...RECORDS_PRIVATE_HEADERS, Allow:'GET'},
      });
      if (!enabled) throw new SecurityError('Open your play streak on parkesrummy.com. Preview deployments do not access saved records.',409);
      if (request.headers.get('Sec-Fetch-Site') === 'cross-site'
        || request.headers.has('Origin') && !isAllowedRoomWriteOrigin(request)) {
        throw new SecurityError('Open Parkes Rummy directly to continue.',403);
      }
      const user = await resolve(request);
      if (!user) throw new SecurityError('Sign in with Google to save your play streak.',401);
      if (request.headers.get(ACCOUNT_IDENTITY_HEADER) !== accountMarker(user.id)) {
        throw new SecurityError('Your account changed. Reconnect to continue.',401);
      }
      await security.check(request,'profile',user.id);
      return Response.json(await records.playStreak(user.id,now()), {headers:RECORDS_PRIVATE_HEADERS});
    } catch (error) {
      if (error instanceof SecurityError) return Response.json({error:error.message}, {
        status:error.status, headers:{...RECORDS_PRIVATE_HEADERS,'Retry-After':String(error.retryAfter)},
      });
      return Response.json({error:'Your play streak is unavailable for the moment. Please try again.'}, {
        status:503, headers:RECORDS_PRIVATE_HEADERS,
      });
    }
  };
}

export const readPlayStreak = createPlayStreakHandler();
