import { resolveAccountUser } from '@/lib/auth';
import { hasEntitlement, REMOVE_ADS_ENTITLEMENT } from '@/db/entitlements';
import { createStripeCheckout } from '@/lib/stripe-lite';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
export async function POST(request: Request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Open Parkes Rummy directly to continue.' }, 403);
  const user = await resolveAccountUser(request);
  if (!user) return json({ error: 'Sign in to remove ads across your devices.' }, 401);
  if (await hasEntitlement(user.id, REMOVE_ADS_ENTITLEMENT)) return json({ error: 'Ads are already removed on this account.' }, 409);
  try {
    const checkout = await createStripeCheckout({ userId:user.id, email:user.email, origin:new URL(request.url).origin, productKey:'remove_ads' });
    return json({ url:checkout.url });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_CONFIGURED') return json({ error:'Remove Ads checkout is being set up.' }, 503);
    return json({ error:'Checkout could not be opened. Please try again.' }, 502);
  }
}
