import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {SecurityError} from '../db/security';
const NAME='parkes-activity-visitor';
export function activityVisitor(request:Request):{id:string;cookie?:string}{
  const secret=process.env.BETTER_AUTH_SECRET;
  if(!secret||secret.length<32)throw new SecurityError('Activity is unavailable for the moment.',503);
  const sign=(id:string)=>createHmac('sha256',secret).update(`activity:${id}`).digest('hex');
  const value=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(NAME+'='))?.slice(NAME.length+1)||'';
  const [id,signature]=value.split('.');
  if(/^[a-f0-9-]{36}$/.test(id||'')&&/^[a-f0-9]{64}$/.test(signature||'')&&timingSafeEqual(Buffer.from(sign(id),'hex'),Buffer.from(signature,'hex')))return {id};
  const fresh=randomUUID();return {id:fresh,cookie:`${NAME}=${fresh}.${sign(fresh)}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`};
}
