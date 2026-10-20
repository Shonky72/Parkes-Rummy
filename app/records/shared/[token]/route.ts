import { readSharedRecord } from '@/lib/records-server';
import { sharedRecordPage } from '@/lib/records-share-page';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{token:string}>}) {
  const {token}=await params,record=await readSharedRecord(request,token);
  return record instanceof Response ? record : sharedRecordPage(record,token);
}
