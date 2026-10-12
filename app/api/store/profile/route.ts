import { resolveAccountUser } from '@/lib/auth';
import { getEntitlements, setPlayerProfile } from '@/db/entitlements';
import { isFontId, isSymbolId } from '@/lib/store-catalog';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return Response.json({ error:'Open Parkes Rummy directly to continue.' }, { status:403 });
  const user = await resolveAccountUser(request);
  if (!user) return Response.json({ error:'Sign in to save your player style.' }, { status:401 });
  const body = await request.json().catch(() => ({})) as { font?: string; symbol?: string };
  if (!body.font || !body.symbol || !isFontId(body.font) || !isSymbolId(body.symbol)) return Response.json({ error:'Choose a valid player style.' }, { status:400 });
  const entitlements = await getEntitlements(user.id);
  if (body.font !== 'default' && !entitlements.premiumFonts) return Response.json({ error:'The Fonts Pack is required for this style.' }, { status:403 });
  if (body.symbol !== 'initials' && !entitlements.premiumSymbols) return Response.json({ error:'The Symbols Pack is required for this symbol.' }, { status:403 });
  const profile = await setPlayerProfile(user.id, { font:body.font, symbol:body.symbol }, entitlements);
  return Response.json({ profile });
}
