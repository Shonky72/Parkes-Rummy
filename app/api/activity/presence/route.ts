import { recordPresence } from '@/lib/activity-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  // Preview QA must not register as a real visitor in the production dashboard.
  if (process.env.CONTEXT === 'deploy-preview' || process.env.CONTEXT === 'branch-deploy') {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }
  return recordPresence(request);
}
