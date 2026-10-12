import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const handlers = toNextJsHandler(async (request: Request) => {
  const auth = getAuth();
  if (!auth) return Response.json({ error: 'Google sign-in is not configured yet.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return auth.handler(request);
});
export const GET = handlers.GET;
export const POST = handlers.POST;
