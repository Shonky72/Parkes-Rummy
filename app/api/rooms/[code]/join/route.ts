import { joinRoomRequest } from '@/lib/room-server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  return joinRoomRequest(request, (await context.params).code);
}
