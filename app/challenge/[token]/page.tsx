import type { Metadata } from 'next';
import ChallengeLanding from '@/app/components/ChallengeLanding';
export const metadata:Metadata={title:'Same deal challenge | Parkes Rummy',robots:{index:false,follow:false}};
export default async function ChallengePage({params}:{params:Promise<{token:string}>}) {
  return <ChallengeLanding token={(await params).token}/>;
}
