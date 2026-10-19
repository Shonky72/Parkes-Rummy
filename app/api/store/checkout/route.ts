import {boundedJson} from '@/lib/request-body';
import { readAuthConfig } from '@/lib/auth-config';
import { secureRoute } from '@/lib/secure-route';
import { resolveAccountUser } from '@/lib/auth';
import { getEntitlements } from '@/db/entitlements';
import { createStripeCheckout } from '@/lib/stripe-lite';
import { STORE_PRODUCTS, type StoreProductKey } from '@/lib/store-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
function ownsProduct(key: StoreProductKey, entitlements: Awaited<ReturnType<typeof getEntitlements>>) {
  const owned = new Set<string>();
  if (entitlements.removeAds) owned.add('remove_ads');
  if (entitlements.premiumFonts) owned.add('premium_fonts');
  if (entitlements.premiumSymbols) owned.add('premium_symbols');
  if (entitlements.voiceChat) owned.add('voice_chat');
  if (entitlements.originalRules) owned.add('original_rules');
  return STORE_PRODUCTS[key].grants.every(grant => owned.has(grant));
}
async function handlePost(request: Request) {
  const user = await resolveAccountUser(request);
  if (!user) return json({ error: 'Sign in to keep purchases across devices.' }, 401);
  let body: { product?: string } = {};
  try { body = await boundedJson(request,2048); } catch { return json({ error: 'Choose a store item.' }, 400); }
  const productKey = body.product as StoreProductKey;
  if (!productKey || !Object.hasOwn(STORE_PRODUCTS, productKey)) return json({ error: 'Choose a store item.' }, 400);
  const entitlements = await getEntitlements(user.id);
  if (ownsProduct(productKey, entitlements)) return json({ error: 'This account already owns this item.' }, 409);
  try {
    const origin = readAuthConfig()?.origin || 'https://parkesrummy.com';
    const checkout = await createStripeCheckout({ userId: user.id, email: user.email, origin, productKey });
    return json({ url: checkout.url });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_CONFIGURED') return json({ error: 'This store item is being set up.' }, 503);
    console.error('Parkes Rummy store checkout failed', productKey);
    return json({ error: 'Checkout did not open. Please try again.' }, 502);
  }
}

export const POST=secureRoute('checkout',handlePost);
