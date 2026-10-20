-- Additive controlled challenges, private clubs, duels and rematches.
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
 score jsonb, daily_day text, source_token text, created_at bigint NOT NULL, deadline_at bigint NOT NULL, finished_at bigint);
ALTER TABLE competition_attempts ADD COLUMN IF NOT EXISTS source_token text;
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
