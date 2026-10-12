'use client';
import { ArrowLeft } from 'lucide-react';
import StorePanel from '../components/StorePanel';
import DeveloperCredit from '../components/DeveloperCredit';
import { AccountControls, AccountLoading, useAccountSession } from '../components/AccountControls';
export default function StorePageClient(){
  const account=useAccountSession();
  if(account.status!=='ready')return <AccountLoading account={account}/>;
  return <main className="standalone-store"><a className="text-link" href="/"><ArrowLeft size={18}/>Back to game</a><div className="panel standalone-store-card"><AccountControls account={account}/><StorePanel account={account}/></div><DeveloperCredit/></main>;
}
