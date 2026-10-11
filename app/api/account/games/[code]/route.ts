import { removeAccountGameRequest } from '@/lib/room-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function DELETE(request: Request, context: { params: Promise<{ code: string }> }) {
  return removeAccountGameRequest(request, (await context.params).code);
}
