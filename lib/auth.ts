import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { getPool } from '../db';
import { readAuthConfig, type AccountUser, type GoogleAuthConfig } from './auth-config';

function createAuth(config: GoogleAuthConfig) {
  return betterAuth({
    appName: 'Parkes Rummy', baseURL: config.origin, secret: config.secret, database: getPool(),
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: config.clientId, clientSecret: config.clientSecret,
        scope: ['openid', 'email', 'profile'], prompt: 'select_account',
        accessType: 'online', disableIdTokenSignIn: true,
      },
    },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    trustedOrigins: [config.origin],
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100 },
    advanced: {
      cookiePrefix: 'parkes-rummy', useSecureCookies: config.origin.startsWith('https:'),
      database: { generateId: () => crypto.randomUUID() },
    },
    // Forward refreshed session cookies from server-side getSession calls.
    plugins: [nextCookies()],
    logger: { level: 'error', log: () => { console.error('Parkes Rummy authentication request failed'); } },
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  const config = readAuthConfig();
  if (!config) return null;
  instance ??= createAuth(config);
  return instance;
}
export async function resolveAccountUser(request: Request): Promise<AccountUser | null> {
  const auth = getAuth();
  if (!auth) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null };
}
