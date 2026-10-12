import { readRoomRequest, deleteRoomRequest } from '@/lib/room-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  return readRoomRequest(request, (await context.params).code);
}
export async function DELETE(request: Request, context: { params: Promise<{ code: string }> }) {
  return deleteRoomRequest(request, (await context.params).code);
}
