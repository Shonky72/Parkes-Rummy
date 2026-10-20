import { CompetitionRepository, competitionRepository } from '../db/competition';
import { requestSecurity, SecurityError, type RequestSecurity } from '../db/security';
import { resolveAccountUser } from './auth';
import { ACCOUNT_IDENTITY_HEADER, accountMarker, type AccountUser } from './auth-config';
import { isAllowedRoomWriteOrigin } from './request-origin';
import { boundedJson } from './request-body';
import { RECORDS_PRIVATE_HEADERS, RECORDS_PUBLIC_HEADERS } from './records-server';
import { isProductionDeployment } from './deployment-context';
type Resolver=(request:Request)=>Promise<AccountUser|null>;
function identifier(value:unknown,label='competition'):string {
  if(typeof value!=='string'||!value||value.length>200||/[\u0000-\u001f\u007f]/.test(value))throw new SecurityError(`Choose a valid ${label}.`,400);
  return value;
}
function failure(error:unknown):Response {
  if(error instanceof SecurityError)return Response.json({error:error.message},{status:error.status,headers:{...RECORDS_PRIVATE_HEADERS,'Retry-After':String(error.retryAfter)}});
  if(error instanceof Error&&error.name==='GameError')return Response.json({error:error.message},{status:400,headers:RECORDS_PRIVATE_HEADERS});
  return Response.json({error:'Competition is unavailable for the moment. Reconnect and try again.'},{status:503,headers:RECORDS_PRIVATE_HEADERS});
}
export function createCompetitionHandlers(options:{competition?:CompetitionRepository;resolveSession?:Resolver;security?:RequestSecurity;enabled?:boolean}={}) {
  const competition=options.competition??competitionRepository,resolve=options.resolveSession??resolveAccountUser,security=options.security??requestSecurity;
  const enabled=options.enabled??isProductionDeployment();
  async function authenticate(request:Request,write:boolean):Promise<AccountUser> {
    if(!enabled)throw new SecurityError('Continue Challenges on parkesrummy.com. Preview deployments do not create or change competition records.',409);
    if(request.headers.get('Sec-Fetch-Site')==='cross-site'||write&&!isAllowedRoomWriteOrigin(request)||request.headers.has('Origin')&&!isAllowedRoomWriteOrigin(request))throw new SecurityError('Open Parkes Rummy directly to continue.',403);
    const user=await resolve(request);if(!user)throw new SecurityError('Sign in with Google to play and save your challenge attempts.',401);
    if(request.headers.get(ACCOUNT_IDENTITY_HEADER)!==accountMarker(user.id))throw new SecurityError('Your account changed. Reconnect before continuing.',401);
    await security.check(request,'profile',user.id);return user;
  }
  return {
    snapshot:async(request:Request):Promise<Response>=>{
      try {
        const user=await authenticate(request,false),params=new URL(request.url).searchParams;
        const data=params.has('clubId')?await competition.club(user.id,identifier(params.get('clubId'),'club'))
          :params.has('duel')?await competition.duelInvitation(user.id,identifier(params.get('duel'),'duel invitation'))
          :params.has('rematch')?await competition.rematchInvitation(user.id,identifier(params.get('rematch'),'rematch invitation'))
          :await competition.snapshot(user.id);
        return Response.json(data,{headers:RECORDS_PRIVATE_HEADERS});
      }catch(error){return failure(error);}
    },
    mutate:async(request:Request):Promise<Response>=>{
      try {
        const user=await authenticate(request,true),body=await boundedJson(request,8192);let data:unknown={ok:true};
        switch(body.action){
          case 'createChallenge':data={challenge:await competition.createChallenge(user.id,body)};break;
          case 'startAttempt':
            if(body.practice!==undefined&&typeof body.practice!=='boolean')throw new SecurityError('Choose a scored attempt or practice replay.',400);
            data={...await competition.reserveAttempt(user.id,identifier(body.token,'challenge invitation'),body.practice===true),token:accountMarker(user.id)};break;
          case 'resumeAttempt':data={...await competition.resumeAttempt(user.id,identifier(body.attemptId,'saved attempt')),token:accountMarker(user.id)};break;
          case 'withdrawAttempt':await competition.withdrawAttempt(user.id,identifier(body.attemptId,'attempt'));break;
          case 'shareChallenge':data={challenge:await competition.shareChallenge(user.id,identifier(body.attemptId,'completed attempt'))};break;
          case 'revokeChallenge':await competition.revokeChallenge(user.id,identifier(body.challengeId,'challenge'));break;
          case 'createClub':data={club:await competition.createClub(user.id,body.name)};break;
          case 'requestClub':data={club:await competition.requestClub(user.id,identifier(body.code,'club code'))};break;
          case 'approveMember':case 'rejectMember':case 'removeMember':case 'blockMember':case 'unblockMember':case 'transferClub':
            await competition.clubAction(user.id,body.action,identifier(body.clubId,'club'),identifier(body.memberId,'club member'));break;
          case 'leaveClub':case 'deleteClub':case 'rotateClubCode':await competition.clubAction(user.id,body.action,identifier(body.clubId,'club'));break;
          case 'createDuel':data={duel:await competition.createDuel(user.id,identifier(body.friendId,'friend'))};break;
          case 'acceptDuel':case 'revokeDuel':await competition.duelAction(user.id,body.action,identifier(body.duelId,'duel'));break;
          case 'createRematch':data={rematch:await competition.createRematch(user.id,identifier(body.friendId,'friend'),identifier(body.handId,'completed hand'))};break;
          case 'acceptRematch':case 'revokeRematch':data={...await competition.rematchAction(user.id,body.action,identifier(body.rematchId,'rematch')),token:accountMarker(user.id)};break;
          default:throw new SecurityError('Choose a competition action.',400);
        }
        return Response.json(data,{headers:RECORDS_PRIVATE_HEADERS});
      }catch(error){return failure(error);}
    },
    challenge:async(request:Request,token:string):Promise<Response>=>{
      try {
        if(!enabled)throw new SecurityError('Open this challenge on parkesrummy.com. Preview deployments do not access competition records.',409);
        if(request.headers.get('Sec-Fetch-Site')==='cross-site'&&request.headers.has('Origin'))throw new SecurityError('Open the challenge link directly.',403);
        await security.check(request,'profile');const user=await resolve(request);
        if(user&&request.headers.get(ACCOUNT_IDENTITY_HEADER)!==accountMarker(user.id))throw new SecurityError('Your account changed. Reconnect before continuing.',401);
        return Response.json({challenge:await competition.challenge(token,user?.id??null)},{headers:RECORDS_PUBLIC_HEADERS});
      }catch(error){return failure(error);}
    },
  };
}
const handlers=createCompetitionHandlers();
export const readCompetition=handlers.snapshot;
export const writeCompetition=handlers.mutate;
export const readChallenge=handlers.challenge;
