import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { database, type SqlDatabase } from './index';

export class SecurityError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter = 60) { super(message); }
}
export const SECURITY_SCHEMA = `DO $$ BEGIN
CREATE TABLE IF NOT EXISTS security_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS security_limits_expiry ON security_limits(expires_at);
CREATE TABLE IF NOT EXISTS security_probes (key text NOT NULL, code text NOT NULL, expires_at bigint NOT NULL, PRIMARY KEY(key,code));
CREATE INDEX IF NOT EXISTS security_probes_expiry ON security_probes(expires_at);
END $$;
`;
export const securityHash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Only Netlify's connection header is authoritative in production. Never use XFF. */
export function trustedClientIp(request: Request): string | null {
  const ip = request.headers.get('x-nf-client-connection-ip')?.trim();
  if (ip && isIP(ip)) return ip.toLowerCase();
  const host = new URL(request.url).hostname;
  if (process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1','game.test'].includes(host)) return '127.0.0.1';
  return null;
}
type Scope = 'create'|'preview'|'join'|'requests'|'read'|'action'|'presence'|'checkout'|'voice'|'profile';
const budgets: Record<Scope, [number,number]> = {
  create:[15,300], preview:[60,60], join:[24,300], requests:[90,60], read:[600,60],
  action:[600,60], presence:[120,60], checkout:[10,300], voice:[600,60], profile:[30,60],
};
export interface RequestSecurity { check(request: Request, scope: Scope, actor?: string, code?: string): Promise<void> }
export class PostgresRequestSecurity implements RequestSecurity {
  private ready: Promise<unknown> | undefined;
  private nextCleanup = 0;
  constructor(private readonly db: SqlDatabase = database) {}
  async check(request: Request, scope: Scope, actor?: string, code?: string) {
    const ip = trustedClientIp(request);
    if (!ip) throw new SecurityError('Please reconnect and try again.',503);
    this.ready ??= this.db.query(SECURITY_SCHEMA).catch(error=>{this.ready=undefined;throw error;});
    await this.ready;
    const now = Date.now();
    if (now >= this.nextCleanup) {
      this.nextCleanup=now+300_000;
      // At most one worker performs housekeeping per five-minute window.
      const claim=await this.db.query(`INSERT INTO security_limits(key,count,expires_at) VALUES('cleanup',1,$1)
        ON CONFLICT(key) DO UPDATE SET expires_at=EXCLUDED.expires_at WHERE security_limits.expires_at<=$2 RETURNING key`,[now+300_000,now]);
      if(claim.rows.length){await this.db.query('DELETE FROM security_limits WHERE expires_at<$1',[now]);await this.db.query('DELETE FROM security_probes WHERE expires_at<$1',[now]);}
    }
    const consume=async(key:string,max:number,seconds:number)=>{
      const result=await this.db.query<{count:number;expires_at:string}>(`INSERT INTO security_limits(key,count,expires_at) VALUES($1,1,$2)
        ON CONFLICT(key) DO UPDATE SET count=CASE WHEN security_limits.expires_at<=$3 THEN 1 ELSE security_limits.count+1 END,
        expires_at=CASE WHEN security_limits.expires_at<=$3 THEN EXCLUDED.expires_at ELSE security_limits.expires_at END RETURNING count,expires_at`,[securityHash(key),now+seconds*1000,now]);
      if(result.rows[0].count>max)throw new SecurityError('Please wait before trying again.',429,Math.max(1,Math.ceil((Number(result.rows[0].expires_at)-now)/1000)));
    };
    await consume(`all:${ip}`,1500,60);
    const [max,seconds]=budgets[scope];
    await consume(`${scope}:global`,scope==='create'||scope==='checkout'?300:scope==='presence'?3000:10000,60);
    // Shared households get room for eight simultaneous participants.
    await consume(`${scope}:ip:${ip}`,actor?Math.max(max,scope==='create'?15:max*8):max,seconds);
    if(actor)await consume(`${scope}:actor:${actor}`,max,seconds);
    if((scope==='preview'||scope==='join') && code){
      // Serialize a client's distinct-code budget across workers and rotations.
      await this.db.transaction(async connection=>{
        const key=securityHash(`probes:${ip}`), expiry=now+300_000;
        await connection.query(`INSERT INTO security_limits(key,count,expires_at) VALUES($1,0,$2) ON CONFLICT(key) DO NOTHING`,[key,expiry]);
        await connection.query('SELECT key FROM security_limits WHERE key=$1 FOR UPDATE',[key]);
        await connection.query('DELETE FROM security_probes WHERE key=$1 AND expires_at<=$2',[key,now]);
        const prior=await connection.query('SELECT 1 FROM security_probes WHERE key=$1 AND code=$2',[key,securityHash(code)]);
        if(prior.rows.length)return;
        const count=await connection.query<{count:string}>('SELECT count(*) AS count FROM security_probes WHERE key=$1',[key]);
        if(Number(count.rows[0].count)>=12)throw new SecurityError('Please check the invitation with your host and try again later.',429,300);
        await connection.query('INSERT INTO security_probes(key,code,expires_at) VALUES($1,$2,$3)',[key,securityHash(code),expiry]);
      });
    }
  }
}
export const requestSecurity = new PostgresRequestSecurity();
export function securityFailure(error: unknown): Response | null {
  if (!(error instanceof SecurityError)) return null;
  return Response.json({error:error.message},{status:error.status,headers:{'Cache-Control':'no-store','Retry-After':String(error.retryAfter)}});
}
