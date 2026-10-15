/**
 * Validate browser POST origins against the addresses that actually serve
 * Parkes Rummy, rather than assuming the URL seen inside a hosting function
 * is the same URL the player sees in Chrome.
 *
 * Netlify can present Next.js route handlers with an internal deployment URL
 * (including a :80 port). Comparing request.url.origin to the browser's
 * Origin header then rejects an entirely legitimate same-site card action.
 *
 * A cross-site Fetch Metadata signal or unexpected Origin still fails closed.
 * No untrusted Host or X-Forwarded-Host header becomes an authority here.
 */
const PUBLIC_ORIGINS = new Set([
  'https://parkesrummy.com',
  'https://www.parkesrummy.com',
  'https://parkes-rummy.netlify.app',
]);

const NETLIFY_APP_DEPLOY = /^[a-z0-9-]+--parkes-rummy\.netlify\.app$/;

function trustedDeploymentOrigins(): Set<string> {
  const origins = new Set(PUBLIC_ORIGINS);
  // Platform-supplied addresses are explicit, not arbitrary browser headers.
  for (const key of ['URL', 'DEPLOY_URL', 'DEPLOY_PRIME_URL'] as const) {
    const value = process.env[key];
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'https:') origins.add(parsed.origin);
    } catch { /* Ignore a malformed optional deployment environment value. */ }
  }
  return origins;
}

export function isAllowedRoomWriteOrigin(request: Pick<Request, 'url' | 'headers'>): boolean {
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return false;
  const supplied = request.headers.get('Origin');
  if (!supplied || supplied === 'null') return false;

  let origin: URL;
  try { origin = new URL(supplied); } catch { return false; }
  // A browser's Origin header consists of an origin only, with no path.
  if (origin.origin !== supplied || origin.username || origin.password) return false;

  if (trustedDeploymentOrigins().has(origin.origin)) return true;
  if (origin.protocol === 'https:' && !origin.port && NETLIFY_APP_DEPLOY.test(origin.hostname)) return true;

  // Dev and controlled local integration tests don't use a public domain.
  // Do not permit this fallback inside a production server.
  if (process.env.NODE_ENV !== 'production') {
    const local = new URL(request.url);
    if (local.origin === origin.origin &&
      (['localhost', '127.0.0.1', 'game.test'].includes(local.hostname))) return true;
  }
  return false;
}
