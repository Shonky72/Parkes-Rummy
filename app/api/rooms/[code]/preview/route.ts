import { roomPreviewRequest } from '@/lib/room-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  return roomPreviewRequest(request, (await context.params).code);
}
