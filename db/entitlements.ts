import { database, type SqlConnection } from './index';
import { STORE_PRODUCTS, type EntitlementKey, type FontId, type PlayerProfile, type StoreProductKey, type SymbolId, isFontId, isSymbolId } from '../lib/store-catalog';

export const REMOVE_ADS_ENTITLEMENT: EntitlementKey = 'remove_ads';
export const PREMIUM_FONTS_ENTITLEMENT: EntitlementKey = 'premium_fonts';
export const PREMIUM_SYMBOLS_ENTITLEMENT: EntitlementKey = 'premium_symbols';
export const VOICE_CHAT_ENTITLEMENT: EntitlementKey = 'voice_chat';
export const ORIGINAL_RULES_ENTITLEMENT: EntitlementKey = 'original_rules';

let schemaReady: Promise<void> | null = null;
export function ensureStoreSchema() {
  schemaReady ??= (async () => {
    await database.query(`CREATE TABLE IF NOT EXISTS user_entitlements (
      user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      entitlement text NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(), source text NOT NULL, source_ref text,
      PRIMARY KEY (user_id, entitlement))`);
    await database.query(`CREATE TABLE IF NOT EXISTS purchase_receipts (
      id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      product_key text NOT NULL, amount integer NOT NULL, currency text NOT NULL, status text NOT NULL,
      payment_intent text, created_at timestamptz NOT NULL DEFAULT now())`);
    await database.query('CREATE INDEX IF NOT EXISTS purchase_receipts_user_idx ON purchase_receipts(user_id, product_key, status)');
    await database.query('CREATE INDEX IF NOT EXISTS purchase_receipts_payment_intent_idx ON purchase_receipts(payment_intent)');
    await database.query(`CREATE TABLE IF NOT EXISTS payment_events (
      event_id text PRIMARY KEY, event_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await database.query(`CREATE TABLE IF NOT EXISTS premium_access_grants (\n      email text PRIMARY KEY, note text NOT NULL DEFAULT '', granted_at timestamptz NOT NULL DEFAULT now(), granted_by text NOT NULL)`);\n    await database.query(`CREATE TABLE IF NOT EXISTS player_profiles (
      user_id text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
      font_id text NOT NULL DEFAULT 'default', symbol_id text NOT NULL DEFAULT 'initials', updated_at timestamptz NOT NULL DEFAULT now())`);
    await database.query(`CREATE TABLE IF NOT EXISTS voice_presence (
      room_code text NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, player_id text NOT NULL,
      user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, joined_at bigint NOT NULL, last_seen bigint NOT NULL,
      PRIMARY KEY (room_code, player_id), UNIQUE (room_code, user_id))`);
    await database.query('CREATE INDEX IF NOT EXISTS voice_presence_seen_idx ON voice_presence(room_code, last_seen)');
    await database.query(`CREATE TABLE IF NOT EXISTS voice_blocks (
      room_code text NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, blocker_player_id text NOT NULL,
      blocked_player_id text NOT NULL, created_at bigint NOT NULL, PRIMARY KEY (room_code, blocker_player_id, blocked_player_id))`);
    await database.query(`CREATE TABLE IF NOT EXISTS voice_signals (
      id bigserial PRIMARY KEY, room_code text NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      sender_player_id text NOT NULL, recipient_player_id text NOT NULL, kind text NOT NULL, payload text NOT NULL, created_at bigint NOT NULL)`);
    await database.query('CREATE INDEX IF NOT EXISTS voice_signals_recipient_idx ON voice_signals(room_code, recipient_player_id, id)');
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

export interface EntitlementSnapshot {
  removeAds: boolean;
  premiumFonts: boolean;
  premiumSymbols: boolean;
  voiceChat: boolean;
  originalRules: boolean;
}

const EMPTY_ENTITLEMENTS: EntitlementSnapshot = { removeAds: false, premiumFonts: false, premiumSymbols: false, voiceChat: false, originalRules: false };
const allEntitlements: EntitlementKey[] = ['remove_ads','premium_fonts','premium_symbols','voice_chat','original_rules'];

function snapshotFromKeys(keys: ReadonlySet<string>): EntitlementSnapshot {
  return {
    removeAds: keys.has(REMOVE_ADS_ENTITLEMENT),
    premiumFonts: keys.has(PREMIUM_FONTS_ENTITLEMENT),
    premiumSymbols: keys.has(PREMIUM_SYMBOLS_ENTITLEMENT),
    voiceChat: keys.has(VOICE_CHAT_ENTITLEMENT),
    originalRules: keys.has(ORIGINAL_RULES_ENTITLEMENT),
  };
}

function normalizeAccessEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isFullAccessAdmin(email: string) {
  const configured = (process.env.PARKES_ADMIN_EMAILS?.trim() || 'dan@ibdcollective.net')
    .split(',').map(normalizeAccessEmail).filter(Boolean);
  return configured.includes(normalizeAccessEmail(email));
}

async function fullAccessGranted(userId: string) {
  const result = await database.query<{ email: string; granted: boolean }>(
    `SELECT lower(u.email) AS email,
            EXISTS (SELECT 1 FROM premium_access_grants g WHERE g.email = lower(u.email)) AS granted
       FROM "user" u
      WHERE u.id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return Boolean(row && (row.granted || isFullAccessAdmin(row.email)));
}

export async function hasEntitlement(userId: string, entitlement: EntitlementKey) {
  const snapshot = await getEntitlements(userId);
  const lookup: Record<EntitlementKey, boolean> = {
    remove_ads: snapshot.removeAds,
    premium_fonts: snapshot.premiumFonts,
    premium_symbols: snapshot.premiumSymbols,
    voice_chat: snapshot.voiceChat,
    original_rules: snapshot.originalRules,
  };
  return lookup[entitlement];
}

export async function getEntitlements(userId: string): Promise<EntitlementSnapshot> {
  await ensureStoreSchema();
  if (!userId) return EMPTY_ENTITLEMENTS;
  if (await fullAccessGranted(userId)) return { removeAds:true, premiumFonts:true, premiumSymbols:true, voiceChat:true, originalRules:true };
  const [result, purchases] = await Promise.all([
    database.query<{ entitlement: string }>('SELECT entitlement FROM user_entitlements WHERE user_id = $1', [userId]),
    database.query<{ product_key: StoreProductKey }>("SELECT product_key FROM purchase_receipts WHERE user_id = $1 AND status = 'paid'", [userId]),
  ]);
  const keys = new Set(result.rows.map(row => row.entitlement));
  for (const row of purchases.rows) for (const entitlement of STORE_PRODUCTS[row.product_key]?.grants ?? []) keys.add(entitlement);
  return snapshotFromKeys(keys);
}

export interface FullAccessGrant { email: string; note: string; grantedAt: string; grantedBy: string }

export async function listFullAccessGrants(): Promise<FullAccessGrant[]> {
  await ensureStoreSchema();
  const result = await database.query<{ email:string; note:string; granted_at:Date|string; granted_by:string }>(
    'SELECT email,note,granted_at,granted_by FROM premium_access_grants ORDER BY granted_at DESC, email ASC',
  );
  return result.rows.map(row => ({ email:row.email, note:row.note, grantedAt:new Date(row.granted_at).toISOString(), grantedBy:row.granted_by }));
}

export async function grantFullAccessEmail(email: string, note: string, grantedBy: string) {
  await ensureStoreSchema();
  const normalized = normalizeAccessEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error('INVALID_EMAIL');
  const cleanNote = note.trim().slice(0,120);
  await database.query(
    `INSERT INTO premium_access_grants (email,note,granted_by)
     VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET note=EXCLUDED.note, granted_at=now(), granted_by=EXCLUDED.granted_by`,
    [normalized, cleanNote, normalizeAccessEmail(grantedBy)],
  );
  return normalized;
}

export async function revokeFullAccessEmail(email: string) {
  await ensureStoreSchema();
  const normalized = normalizeAccessEmail(email);
  await database.query('DELETE FROM premium_access_grants WHERE email=$1', [normalized]);
  return normalized;
}

export async function getPlayerProfile(userId: string): Promise<PlayerProfile> {
  await ensureStoreSchema();
  const result = await database.query<{ font_id: string; symbol_id: string }>('SELECT font_id, symbol_id FROM player_profiles WHERE user_id = $1', [userId]);
  const row = result.rows[0];
  return {
    font: row && isFontId(row.font_id) ? row.font_id : 'default',
    symbol: row && isSymbolId(row.symbol_id) ? row.symbol_id : 'initials',
  };
}

export async function setPlayerProfile(userId: string, profile: PlayerProfile, entitlements?: EntitlementSnapshot): Promise<PlayerProfile> {
  await ensureStoreSchema();
  const owned = entitlements ?? await getEntitlements(userId);
  const font: FontId = isFontId(profile.font) && (profile.font === 'default' || owned.premiumFonts) ? profile.font : 'default';
  const symbol: SymbolId = isSymbolId(profile.symbol) && (profile.symbol === 'initials' || owned.premiumSymbols) ? profile.symbol : 'initials';
  await database.transaction(async connection => {
    await connection.query(
      `INSERT INTO player_profiles (user_id, font_id, symbol_id, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (user_id) DO UPDATE SET font_id = EXCLUDED.font_id, symbol_id = EXCLUDED.symbol_id, updated_at = now()`,
      [userId, font, symbol],
    );
    const memberships = await connection.query<{ room_code:string; player_id:string; state:string; version:number }>(
      `SELECT r.code AS room_code,m.player_id,r.state,r.version FROM room_memberships m JOIN rooms r ON r.code=m.room_code WHERE m.user_id=$1`, [userId],
    );
    for (const row of memberships.rows) {
      try {
        const room = JSON.parse(row.state) as { players?: Array<{id:string;fontId?:string;symbolId?:string}>; updatedAt?:number; version?:number };
        const player = room.players?.find(candidate => candidate.id === row.player_id);
        if (!player) continue;
        player.fontId = font; player.symbolId = symbol; room.updatedAt = Date.now(); room.version = row.version + 1;
        await connection.query('UPDATE rooms SET state=$1, version=$2, updated_at=$3 WHERE code=$4 AND version=$5', [JSON.stringify(room),row.version+1,room.updatedAt,row.room_code,row.version]);
      } catch { /* Old/corrupt rooms are ignored rather than blocking profile changes. */ }
    }
  });
  return { font, symbol };
}

function productsGranting(entitlement: EntitlementKey): StoreProductKey[] {
  return (Object.keys(STORE_PRODUCTS) as StoreProductKey[]).filter(key => (STORE_PRODUCTS[key].grants as readonly EntitlementKey[]).includes(entitlement));
}

async function syncEntitlement(connection: SqlConnection, userId: string, entitlement: EntitlementKey) {
  const products = productsGranting(entitlement);
  const result = await connection.query<{ id: string }>(
    `SELECT id FROM purchase_receipts
     WHERE user_id = $1 AND product_key = ANY($2::text[]) AND status = 'paid'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, products],
  );
  if (result.rows[0]) {
    await connection.query(
      `INSERT INTO user_entitlements (user_id, entitlement, source, source_ref)
       VALUES ($1,$2,'stripe',$3)
       ON CONFLICT (user_id, entitlement) DO UPDATE SET source = EXCLUDED.source, source_ref = EXCLUDED.source_ref`,
      [userId, entitlement, result.rows[0].id],
    );
  } else {
    await connection.query('DELETE FROM user_entitlements WHERE user_id = $1 AND entitlement = $2', [userId, entitlement]);
  }
}

export async function grantProductFromCheckout(input: {
  eventId: string; sessionId: string; paymentIntent: string | null; userId: string; productKey: StoreProductKey; amount: number; currency: string;
}) {
  await ensureStoreSchema();
  return database.transaction(async connection => {
    const prior = await connection.query('SELECT 1 FROM payment_events WHERE event_id = $1', [input.eventId]);
    if (prior.rowCount) return false;
    await connection.query('INSERT INTO payment_events (event_id, event_type) VALUES ($1, $2)', [input.eventId, 'checkout.session.completed']);
    await connection.query(
      `INSERT INTO purchase_receipts (id, user_id, product_key, amount, currency, status, payment_intent)
       VALUES ($1,$2,$3,$4,$5,'paid',$6)
       ON CONFLICT (id) DO UPDATE SET status = 'paid', payment_intent = EXCLUDED.payment_intent`,
      [input.sessionId, input.userId, input.productKey, input.amount, input.currency, input.paymentIntent],
    );
    for (const entitlement of STORE_PRODUCTS[input.productKey].grants) {
      await connection.query(
        `INSERT INTO user_entitlements (user_id, entitlement, source, source_ref)
         VALUES ($1,$2,'stripe',$3)
         ON CONFLICT (user_id, entitlement) DO UPDATE SET source = EXCLUDED.source, source_ref = EXCLUDED.source_ref`,
        [input.userId, entitlement, input.sessionId],
      );
    }
    return true;
  });
}

async function revokeForPayment(input: { eventId: string; eventType: string; paymentIntent: string; status: 'refunded' | 'disputed' }) {
  await ensureStoreSchema();
  return database.transaction(async connection => {
    const prior = await connection.query('SELECT 1 FROM payment_events WHERE event_id = $1', [input.eventId]);
    if (prior.rowCount) return false;
    await connection.query('INSERT INTO payment_events (event_id, event_type) VALUES ($1, $2)', [input.eventId, input.eventType]);
    const receipts = await connection.query<{ user_id: string; product_key: StoreProductKey }>(
      `UPDATE purchase_receipts SET status = $2 WHERE payment_intent = $1 AND status = 'paid' RETURNING user_id, product_key`,
      [input.paymentIntent, input.status],
    );
    const affected = new Map<string, Set<EntitlementKey>>();
    for (const row of receipts.rows) {
      const set = affected.get(row.user_id) ?? new Set<EntitlementKey>();
      for (const entitlement of STORE_PRODUCTS[row.product_key]?.grants ?? []) set.add(entitlement);
      affected.set(row.user_id, set);
    }
    for (const [userId, entitlements] of affected) for (const entitlement of entitlements) await syncEntitlement(connection, userId, entitlement);
    return true;
  });
}

export async function revokeProductForRefund(input: { eventId: string; paymentIntent: string; fullyRefunded: boolean }) {
  if (!input.fullyRefunded) return false;
  return revokeForPayment({ eventId: input.eventId, eventType: 'charge.refunded', paymentIntent: input.paymentIntent, status: 'refunded' });
}

export async function revokeProductForDispute(input: { eventId: string; paymentIntent: string }) {
  return revokeForPayment({ eventId: input.eventId, eventType: 'charge.dispute.created', paymentIntent: input.paymentIntent, status: 'disputed' });
}

/** Useful for migration tests and account deletion. */
export const entitlementKeys = allEntitlements;
