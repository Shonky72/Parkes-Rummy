import { readSharedRecord, RECORDS_PUBLIC_HEADERS } from '@/lib/records-server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{token:string}>}) {
  const record=await readSharedRecord(request,(await params).token);
  return record instanceof Response?record:Response.json(record,{headers:RECORDS_PUBLIC_HEADERS});
}
