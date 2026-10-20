import { recordPresence } from '@/lib/activity-server';
import { deploymentContext } from '@/lib/deployment-context';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  // Preview QA must not register as a real visitor in the production dashboard.
  const context = deploymentContext();
  if (context === 'deploy-preview' || context === 'branch-deploy') {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }
  return recordPresence(request);
}
