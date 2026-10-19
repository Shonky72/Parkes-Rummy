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

-- Gamification Releases 1, 2 and 3: additive migrations.
-- Parkes Rummy records, chosen names, friendships and revocable shares.
-- Additive and repeatable; room deletion never deletes earned evidence.
DO $$ BEGIN
CREATE TABLE IF NOT EXISTS records_profiles (
 user_id text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
 display_name text NOT NULL DEFAULT 'Player', friend_code text NOT NULL UNIQUE,
 featured_badges text[] NOT NULL DEFAULT '{}', created_at bigint NOT NULL, updated_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS records_evidence (
 user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 hand_id text NOT NULL, game_id text NOT NULL, player_id text NOT NULL, room_code text NOT NULL,
 rule_id text NOT NULL, status text NOT NULL CHECK(status IN ('started','completed','abandoned','service-interrupted')),
 source_event text NOT NULL, started_at bigint NOT NULL, updated_at bigint NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(user_id,hand_id), UNIQUE(hand_id,player_id));
CREATE INDEX IF NOT EXISTS records_evidence_owner_history ON records_evidence(user_id,started_at DESC,hand_id DESC);
CREATE INDEX IF NOT EXISTS records_evidence_room ON records_evidence(room_code,status);
CREATE INDEX IF NOT EXISTS records_evidence_game ON records_evidence(user_id,game_id);
CREATE TABLE IF NOT EXISTS records_friendships (
 id text PRIMARY KEY, first_user text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 second_user text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 requester_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN ('pending','accepted')), created_at bigint NOT NULL,
 UNIQUE(first_user,second_user), CHECK(first_user<>second_user));
CREATE INDEX IF NOT EXISTS records_friendships_second ON records_friendships(second_user,state);
CREATE TABLE IF NOT EXISTS records_blocks (
 id text PRIMARY KEY, blocker_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 blocked_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 created_at bigint NOT NULL, UNIQUE(blocker_id,blocked_id), CHECK(blocker_id<>blocked_id));
CREATE TABLE IF NOT EXISTS records_shares (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 hand_id text NOT NULL, token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE,
 payload jsonb NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL,
 FOREIGN KEY(user_id,hand_id) REFERENCES records_evidence(user_id,hand_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS records_shares_owner ON records_shares(user_id,created_at DESC);
END $$;

-- Parkes Rummy controlled deals, first attempts, clubs and invitations.
-- Additive and repeatable; all secret seeds stay in server-private config.
DO $$ BEGIN
CREATE TABLE IF NOT EXISTS competition_challenges (
 id text PRIMARY KEY, owner_id text REFERENCES "user"("id") ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('daily','rule-week','custom','duel')),
 day text, week text, config jsonb NOT NULL, token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE,
 shared boolean NOT NULL DEFAULT false, revoked_at bigint, target jsonb, source_attempt_id text, created_at bigint NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS competition_daily_unique ON competition_challenges(day) WHERE kind='daily';
CREATE UNIQUE INDEX IF NOT EXISTS competition_rule_week_unique ON competition_challenges(week) WHERE kind='rule-week';
CREATE INDEX IF NOT EXISTS competition_challenge_owner ON competition_challenges(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS competition_invitations (
 id text PRIMARY KEY, challenge_id text NOT NULL REFERENCES competition_challenges(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE, target jsonb NOT NULL,
 source_attempt_id text NOT NULL, created_at bigint NOT NULL, revoked_at bigint);
CREATE INDEX IF NOT EXISTS competition_invitation_owner ON competition_invitations(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS competition_attempts (
 id text PRIMARY KEY, challenge_id text NOT NULL REFERENCES competition_challenges(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 room_code text NOT NULL UNIQUE, player_id text NOT NULL, hand_id text NOT NULL,
 scored boolean NOT NULL, status text NOT NULL CHECK(status IN ('active','completed','abandoned','service-interrupted')),
 score jsonb, daily_day text, created_at bigint NOT NULL, deadline_at bigint NOT NULL, finished_at bigint);
CREATE UNIQUE INDEX IF NOT EXISTS competition_first_attempt ON competition_attempts(challenge_id,user_id) WHERE scored=true;
CREATE UNIQUE INDEX IF NOT EXISTS competition_active_practice ON competition_attempts(challenge_id,user_id) WHERE scored=false AND status='active';
CREATE INDEX IF NOT EXISTS competition_attempt_owner ON competition_attempts(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS competition_attempt_deadline ON competition_attempts(status,deadline_at);
CREATE TABLE IF NOT EXISTS competition_clubs (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 name text NOT NULL, code text NOT NULL UNIQUE, created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS competition_memberships (
 id text PRIMARY KEY, club_id text NOT NULL REFERENCES competition_clubs(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','member')), status text NOT NULL CHECK(status IN ('pending','member','blocked')),
 requested_at bigint NOT NULL, joined_at bigint, UNIQUE(club_id,user_id));
CREATE INDEX IF NOT EXISTS competition_membership_user ON competition_memberships(user_id,status);
CREATE TABLE IF NOT EXISTS competition_club_weeks (
 club_id text NOT NULL REFERENCES competition_clubs(id) ON DELETE CASCADE,
 week text NOT NULL, published_at bigint NOT NULL, PRIMARY KEY(club_id,week));
CREATE TABLE IF NOT EXISTS competition_trophies (
 club_id text NOT NULL REFERENCES competition_clubs(id) ON DELETE CASCADE, week text NOT NULL,
 user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, points bigint NOT NULL, attempts integer NOT NULL,
 PRIMARY KEY(club_id,week,user_id));
CREATE TABLE IF NOT EXISTS competition_duels (
 id text PRIMARY KEY, creator_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 opponent_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, friend_id text NOT NULL,
 token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE, challenge_ids text[] NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','accepted','revoked')), created_at bigint NOT NULL,
 CHECK(creator_id<>opponent_id), CHECK(array_length(challenge_ids,1)=3));
CREATE INDEX IF NOT EXISTS competition_duels_opponent ON competition_duels(opponent_id,status);
CREATE TABLE IF NOT EXISTS competition_rematches (
 id text PRIMARY KEY, creator_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 opponent_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, friend_id text NOT NULL,
 source_hand_id text NOT NULL, game integer NOT NULL, token text NOT NULL UNIQUE, token_hash text NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('pending','accepted','revoked')), room_code text, created_at bigint NOT NULL,
 CHECK(creator_id<>opponent_id));
CREATE INDEX IF NOT EXISTS competition_rematches_opponent ON competition_rematches(opponent_id,status);
END $$;

-- Additive ranked Game 1 schema and account-deletion cleanup.
DO $$ BEGIN
CREATE TABLE IF NOT EXISTS ladder_players (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 public_id text NOT NULL UNIQUE, rating integer NOT NULL DEFAULT 1000,
 rated_games integer NOT NULL DEFAULT 0 CHECK(rated_games>=0), active_match_id text,
 created_at bigint NOT NULL, updated_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS ladder_matches (
 id text PRIMARY KEY, format text NOT NULL CHECK(format='ranked-human-v1'),
 first_user text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 second_user text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 source text NOT NULL CHECK(source IN ('friend','queue')),
 state text NOT NULL CHECK(state IN ('invited','active','completed','forfeited','void','declined','cancelled','expired')),
 first_accepted_at bigint NOT NULL, second_accepted_at bigint,
 first_player_id text, second_player_id text, game_id text UNIQUE,
 room_code text UNIQUE REFERENCES rooms(code) ON DELETE SET NULL,
 first_seen_at bigint, second_seen_at bigint, first_connected_at bigint, second_connected_at bigint,
 created_at bigint NOT NULL, expires_at bigint NOT NULL, started_at bigint, finished_at bigint,
 CHECK(first_user<>second_user));
CREATE INDEX IF NOT EXISTS ladder_matches_first ON ladder_matches(first_user,created_at DESC);
CREATE INDEX IF NOT EXISTS ladder_matches_second ON ladder_matches(second_user,created_at DESC);
IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='ladder_players_active_match_fk') THEN
 ALTER TABLE ladder_players ADD CONSTRAINT ladder_players_active_match_fk FOREIGN KEY(active_match_id) REFERENCES ladder_matches(id) ON DELETE SET NULL;
END IF;
CREATE TABLE IF NOT EXISTS ladder_queue (
 user_id text PRIMARY KEY REFERENCES ladder_players(user_id) ON DELETE CASCADE,
 queued_at bigint NOT NULL, seen_at bigint NOT NULL, consent_format text NOT NULL CHECK(consent_format='ranked-human-v1'));
CREATE INDEX IF NOT EXISTS ladder_queue_wait ON ladder_queue(queued_at,seen_at);
CREATE TABLE IF NOT EXISTS ladder_queue_lock (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO ladder_queue_lock(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ladder_pair_days (
 first_user text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 second_user text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 day text NOT NULL, rated_games integer NOT NULL DEFAULT 0 CHECK(rated_games>=0),
 PRIMARY KEY(first_user,second_user,day), CHECK(first_user<second_user));
CREATE TABLE IF NOT EXISTS ladder_results (
 game_id text PRIMARY KEY, match_id text NOT NULL UNIQUE REFERENCES ladder_matches(id) ON DELETE CASCADE,
 outcome text NOT NULL CHECK(outcome IN ('completed','forfeit','service-interrupted')),
 result text CHECK(result IN ('first','second','tie')), rated boolean NOT NULL,
 first_rating integer NOT NULL, second_rating integer NOT NULL, first_delta integer NOT NULL, second_delta integer NOT NULL,
 first_total integer, second_total integer, reason text, finished_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS ladder_service_voids (
 match_id text PRIMARY KEY REFERENCES ladder_matches(id) ON DELETE CASCADE,
 owner_id text REFERENCES "user"(id) ON DELETE SET NULL, note text NOT NULL, created_at bigint NOT NULL);
CREATE OR REPLACE FUNCTION ladder_deleted_match_cleanup() RETURNS trigger AS $ladder_cleanup$
BEGIN
 IF OLD.room_code IS NOT NULL THEN
  UPDATE records_evidence SET status='service-interrupted',updated_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,
   payload=payload || jsonb_build_object('status','service-interrupted','eligible',false,'exclusionReason','ranked participant account deleted',
    'finishedAt',(extract(epoch FROM clock_timestamp())*1000)::bigint,'achievements','[]'::jsonb)
   WHERE room_code=OLD.room_code AND status='started';
  DELETE FROM rooms WHERE code=OLD.room_code AND state::jsonb->'ranked'->>'matchId'=OLD.id;
 END IF;
 RETURN OLD;
END $ladder_cleanup$ LANGUAGE plpgsql;
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ladder_deleted_match_cleanup_trigger') THEN
 CREATE TRIGGER ladder_deleted_match_cleanup_trigger AFTER DELETE ON ladder_matches FOR EACH ROW EXECUTE FUNCTION ladder_deleted_match_cleanup();
END IF;
END $$;
