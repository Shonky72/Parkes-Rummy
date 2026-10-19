import { readChallenge } from '@/lib/competition-server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{token:string}>}) {
  return readChallenge(request,(await params).token);
}
