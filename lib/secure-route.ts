import { requestSecurity, securityFailure } from '../db/security';
import { isAllowedRoomWriteOrigin } from './request-origin';

/** Shared protection for secondary JSON APIs; stateful handlers retain authorization. */
export function secureRoute(scope:Parameters<typeof requestSecurity.check>[1], handler:(request:Request)=>Promise<Response>){
  return async(request:Request)=>{
    try{
      if(!isAllowedRoomWriteOrigin(request))return Response.json({error:'Open Parkes Rummy directly to continue.'},{status:403});
      await requestSecurity.check(request,scope);
      return await handler(request);
    }catch(error){return securityFailure(error)??Response.json({error:'Please reconnect and try again.'},{status:503,headers:{'Cache-Control':'no-store'}});}
  };
}
