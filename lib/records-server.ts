import { RecordsRepository, recordsRepository, type SharedRecord } from '../db/records';
import { requestSecurity, SecurityError, type RequestSecurity } from '../db/security';
import { resolveAccountUser } from './auth';
import { ACCOUNT_IDENTITY_HEADER, accountMarker, type AccountUser } from './auth-config';
import { isAllowedRoomWriteOrigin } from './request-origin';
import { boundedJson } from './request-body';
import { isProductionDeployment } from './deployment-context';

export const RECORDS_PRIVATE_HEADERS = {
  'Cache-Control':'private, no-store, max-age=0', 'CDN-Cache-Control':'no-store',
  'Netlify-CDN-Cache-Control':'no-store', 'Vary':'Cookie, Authorization, X-Parkes-Identity',
  'X-Robots-Tag':'noindex, nofollow', 'Referrer-Policy':'no-referrer',
};
export const RECORDS_PUBLIC_HEADERS = {
  'Cache-Control':'no-store, max-age=0', 'CDN-Cache-Control':'no-store',
  'Netlify-CDN-Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow', 'Referrer-Policy':'no-referrer',
};
const errorResponse = (status:number,message:string) => Response.json({error:message},{status,headers:RECORDS_PRIVATE_HEADERS});
const fail = (error:unknown) => error instanceof SecurityError
  ? Response.json({error:error.message},{status:error.status,headers:{...RECORDS_PRIVATE_HEADERS,'Retry-After':String(error.retryAfter)}})
  : errorResponse(503,'Records are unavailable for the moment. Please try again.');
const identifier = (value:unknown, label='record'):string => {
  if(typeof value!=='string'||!value||value.length>200||/[\u0000-\u001f\u007f]/.test(value))throw new SecurityError(`Choose a valid ${label}.`,400);
  return value;
};
type Resolver=(request:Request)=>Promise<AccountUser|null>;

export function createRecordsHandlers(options:{records?:RecordsRepository;security?:RequestSecurity;resolveSession?:Resolver;enabled?:boolean}={}) {
  const records=options.records??recordsRepository,security=options.security??requestSecurity,resolve=options.resolveSession??resolveAccountUser;
  const enabled=options.enabled??isProductionDeployment();
  function requireProduction() {
    if(!enabled)throw new SecurityError('Open records on parkesrummy.com. Preview deployments do not access or change saved records.',409);
  }
  async function authenticate(request:Request,write:boolean):Promise<AccountUser> {
    requireProduction();
    if(request.headers.get('Sec-Fetch-Site')==='cross-site'||(write&&!isAllowedRoomWriteOrigin(request))||
      (request.headers.has('Origin')&&!isAllowedRoomWriteOrigin(request)))throw new SecurityError('Open Parkes Rummy directly to continue.',403);
    const user=await resolve(request);
    if(!user)throw new SecurityError('Sign in with Google to save your records.',401);
    if(request.headers.get(ACCOUNT_IDENTITY_HEADER)!==accountMarker(user.id))throw new SecurityError('Your account changed. Reconnect to continue.',401);
    await security.check(request,'profile',user.id);
    return user;
  }
  return {
    snapshot: async(request:Request):Promise<Response>=>{
      try {
        const user=await authenticate(request,false),url=new URL(request.url);
        if(url.searchParams.has('friendId'))return Response.json(await records.comparison(user.id,identifier(url.searchParams.get('friendId'),'friend')),{headers:RECORDS_PRIVATE_HEADERS});
        const [profile,summary,history,friends,shares]=await Promise.all([
          records.profile(user.id),records.aggregate(user.id),records.history(user.id,{cursor:url.searchParams.get('cursor')??undefined,handId:url.searchParams.has('handId')?identifier(url.searchParams.get('handId')):undefined}),records.friends(user.id),records.shares(user.id),
        ]);
        return Response.json({profile,summary,...history,friends,shares},{headers:RECORDS_PRIVATE_HEADERS});
      } catch(error){return fail(error);}
    },
    mutate: async(request:Request):Promise<Response>=>{
      try {
        const user=await authenticate(request,true),body=await boundedJson(request,4096);
        switch(body.action){
          case 'profile': return Response.json({profile:await records.updateProfile(user.id,body.displayName,body.featuredBadges)},{headers:RECORDS_PRIVATE_HEADERS});
          case 'rotateFriendCode': return Response.json({profile:await records.rotateFriendCode(user.id)},{headers:RECORDS_PRIVATE_HEADERS});
          case 'requestFriend': await records.requestFriend(user.id,body.friendCode);break;
          case 'acceptFriend': case 'revokeFriend': case 'unfriend': case 'blockFriend': case 'unblockFriend':
            await records.friendAction(user.id,body.action,identifier(body.friendId,'friend'));break;
          case 'createShare':return Response.json({share:await records.createShare(user.id,identifier(body.handId))},{status:201,headers:RECORDS_PRIVATE_HEADERS});
          case 'revokeShare':await records.revokeShare(user.id,identifier(body.shareId,'share'));break;
          default:throw new SecurityError('Choose a records action.',400);
        }
        return Response.json({ok:true},{headers:RECORDS_PRIVATE_HEADERS});
      } catch(error){return fail(error);}
    },
    shared: async(request:Request,token:string):Promise<SharedRecord|Response>=>{
      try {
        requireProduction();
        await security.check(request,'profile');
        const record=await records.shared(token);
        return record??new Response('This shared record is no longer available.',{status:404,headers:RECORDS_PUBLIC_HEADERS});
      } catch(error){return fail(error);}
    },
  };
}
const handlers=createRecordsHandlers();
export const readRecords=handlers.snapshot;
export const writeRecords=handlers.mutate;
export const readSharedRecord=handlers.shared;
