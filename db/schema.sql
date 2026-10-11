-- Parkes Rummy: fresh PostgreSQL database, Better Auth 1.7 core schema.
-- Safe to run again. This script does not delete or import existing games.
BEGIN;
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text, "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session"("userId");
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  "scope" text, "password" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON "account"("userId");
CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification"("identifier");
CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id" text PRIMARY KEY, "key" text NOT NULL UNIQUE, "count" integer NOT NULL, "lastRequest" bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  code text PRIMARY KEY, state text NOT NULL, version integer NOT NULL CHECK (version > 0),
  created_at bigint NOT NULL, updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_updated_at_idx ON rooms(updated_at);
CREATE TABLE IF NOT EXISTS room_memberships (
  room_code text NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  player_id text NOT NULL, hidden boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_code, user_id), UNIQUE (room_code, player_id)
);
CREATE INDEX IF NOT EXISTS room_memberships_user_idx ON room_memberships(user_id, hidden);
CREATE TABLE IF NOT EXISTS room_creation_limits (
  key text PRIMARY KEY, window_start bigint NOT NULL, count integer NOT NULL
);
COMMIT;

-- One-off account entitlements and payment audit records.
CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  entitlement text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  source_ref text,
  PRIMARY KEY (user_id, entitlement)
);
CREATE TABLE IF NOT EXISTS purchase_receipts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  product_key text NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  payment_intent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_receipts_user_idx ON purchase_receipts(user_id, product_key, status);
CREATE INDEX IF NOT EXISTS purchase_receipts_payment_intent_idx ON purchase_receipts(payment_intent);
CREATE TABLE IF NOT EXISTS payment_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Premium player style and browser WebRTC signalling.
CREATE TABLE IF NOT EXISTS player_profiles (
  user_id text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  font_id text NOT NULL DEFAULT 'default',
  symbol_id text NOT NULL DEFAULT 'initials',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS voice_presence (
  room_code text NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  player_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  joined_at bigint NOT NULL,
  last_seen bigint NOT NULL,
  PRIMARY KEY (room_code, player_id),
  UNIQUE (room_code, user_id)
);
CREATE INDEX IF NOT EXISTS voice_presence_seen_idx ON voice_presence(room_code, last_seen);
CREATE TABLE IF NOT EXISTS voice_blocks (
  room_code text NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  blocker_player_id text NOT NULL,
  blocked_player_id text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (room_code, blocker_player_id, blocked_player_id)
);
CREATE TABLE IF NOT EXISTS voice_signals (
  id bigserial PRIMARY KEY,
  room_code text NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  sender_player_id text NOT NULL,
  recipient_player_id text NOT NULL,
  kind text NOT NULL,
  payload text NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS voice_signals_recipient_idx ON voice_signals(room_code, recipient_player_id, id);
