import { joinRequestsRequest, reviewJoinRequest, cancelJoinRequest } from '@/lib/room-server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
type Context={params:Promise<{code:string}>};
export async function GET(request:Request,context:Context){return joinRequestsRequest(request,(await context.params).code);}
export async function POST(request:Request,context:Context){return reviewJoinRequest(request,(await context.params).code);}
export async function DELETE(request:Request,context:Context){return cancelJoinRequest(request,(await context.params).code);}
