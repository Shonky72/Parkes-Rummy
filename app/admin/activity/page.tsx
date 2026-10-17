import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { resolveAccountUser } from '@/lib/auth';
import { isActivityOwner } from '@/lib/activity-server';
import GameLogo from '@/app/components/GameLogo';
import ActivityDashboard from './ActivityDashboard';
import './activity.css';

export const dynamic='force-dynamic';
export const runtime='nodejs';
export const metadata:Metadata={title:'Owner activity | Parkes Rummy',robots:{index:false,follow:false}};
export default async function ActivityPage(){
  let allowed=false;
  try { const incoming=await headers(); const user=await resolveAccountUser(new Request('https://parkesrummy.com/admin/activity',{headers:incoming})); allowed=await isActivityOwner(user); } catch { /* Fail closed, including during an authentication outage. */ }
  if(!allowed)return <div className="parkes-app activity-page"><header className="activity-header"><GameLogo/></header><main className="panel activity-denied"><h1>Owner access required</h1><p>This dashboard is private. Sign in to Parkes Rummy with the authorised Google account, then return here.</p><Link href="/" className="button gold">Back to sign in</Link></main></div>;
  return <ActivityDashboard/>;
}
