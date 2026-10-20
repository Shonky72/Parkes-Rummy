-- Parkes Rummy records, chosen names, friendships and revocable shares.
-- Additive and repeatable; room deletion never deletes earned evidence.
DO $$ BEGIN
-- All three releases share this namespace to coordinate cold workers.
-- The lock releases automatically when this query's transaction ends.
PERFORM pg_advisory_xact_lock(1346458187,1);
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
