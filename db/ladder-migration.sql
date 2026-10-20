-- Additive ranked Game 1 schema and account-deletion cleanup.
DO $$ BEGIN
-- All three releases share this namespace to coordinate cold workers.
-- The lock releases automatically when this query's transaction ends.
PERFORM pg_advisory_xact_lock(1346458187,1);
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
