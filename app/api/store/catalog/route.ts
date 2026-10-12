import { resolveAccountUser } from '@/lib/auth';
import { getEntitlements, getPlayerProfile } from '@/db/entitlements';
import { STORE_PRODUCTS, productPriceId } from '@/lib/store-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return Response.json({ error: 'Open Parkes Rummy directly to continue.' }, { status: 403 });
  const user = await resolveAccountUser(request);
  if (!user) return Response.json({ signedIn: false, entitlements: null, profile: { font:'default',symbol:'initials' }, items: Object.entries(STORE_PRODUCTS).map(([key,item]) => ({ key, label:item.label, amount:item.amount, description:item.description, configured:Boolean(productPriceId(key as keyof typeof STORE_PRODUCTS)) })) });
  const [entitlements, profile] = await Promise.all([getEntitlements(user.id), getPlayerProfile(user.id)]);
  return Response.json({ signedIn: true, entitlements, profile, items: Object.entries(STORE_PRODUCTS).map(([key,item]) => ({ key, label:item.label, amount:item.amount, description:item.description, configured:Boolean(productPriceId(key as keyof typeof STORE_PRODUCTS)) })) }, { headers: { 'Cache-Control':'no-store' } });
}
