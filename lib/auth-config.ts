export interface GoogleAuthConfig { origin: string; clientId: string; clientSecret: string; secret: string }
/** Missing setup disables Google sign-in; builds never create credentials or contact a database. */
export function readAuthConfig(environment: Record<string, string | undefined> = process.env): GoogleAuthConfig | null {
  const origin = environment.BETTER_AUTH_URL?.trim() || environment.URL?.trim() || environment.NEXT_PUBLIC_SITE_URL?.trim();
  const clientId = environment.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
  const secret = environment.BETTER_AUTH_SECRET?.trim();
  if (!environment.DATABASE_URL?.trim() || !origin || !clientId || !clientSecret || !secret || secret.length < 32) return null;
  if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) return null;
  try {
    const url = new URL(origin);
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
    const local = environment.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return { origin: url.origin, clientId, clientSecret, secret };
  } catch { return null; }
}
export interface AccountUser { id: string; name: string; email: string; image: string | null }
export const ACCOUNT_IDENTITY_HEADER = 'X-Parkes-Identity';
export const accountMarker = (userId: string) => `account:${userId}`;
