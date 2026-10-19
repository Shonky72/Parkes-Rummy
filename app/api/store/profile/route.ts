import {boundedJson} from '@/lib/request-body';
import { secureRoute } from '@/lib/secure-route';
import { resolveAccountUser } from '@/lib/auth';
import { getEntitlements, setPlayerProfile } from '@/db/entitlements';
import { isFontId, isSymbolId } from '@/lib/store-catalog';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function handlePost(request: Request) {
  const user = await resolveAccountUser(request);
  if (!user) return Response.json({ error:'Sign in to save your player style.' }, { status:401 });
  const body = await boundedJson(request,2048).catch(() => ({})) as { font?: string; symbol?: string };
  if (!body.font || !body.symbol || !isFontId(body.font) || !isSymbolId(body.symbol)) return Response.json({ error:'Choose a valid player style.' }, { status:400 });
  const entitlements = await getEntitlements(user.id);
  if (body.font !== 'default' && !entitlements.premiumFonts) return Response.json({ error:'The Fonts Pack is required for this style.' }, { status:403 });
  if (body.symbol !== 'initials' && !entitlements.premiumSymbols) return Response.json({ error:'The Symbols Pack is required for this symbol.' }, { status:403 });
  const profile = await setPlayerProfile(user.id, { font:body.font, symbol:body.symbol }, entitlements);
  return Response.json({ profile });
}

export const POST=secureRoute('profile',handlePost);
