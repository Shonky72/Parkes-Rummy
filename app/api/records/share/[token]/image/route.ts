import { readSharedRecord } from '@/lib/records-server';
import { sharedRecordImage } from '@/lib/records-share-image';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{token:string}>}) {
  const record=await readSharedRecord(request,(await params).token);
  return record instanceof Response?record:sharedRecordImage(record);
}
