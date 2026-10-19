-- Additive security migration. Does not rewrite rooms, cards, users or purchases.
DO $$ BEGIN
CREATE TABLE IF NOT EXISTS security_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS security_limits_expiry ON security_limits(expires_at);
CREATE TABLE IF NOT EXISTS security_probes (key text NOT NULL, code text NOT NULL, expires_at bigint NOT NULL, PRIMARY KEY(key,code));
CREATE INDEX IF NOT EXISTS security_probes_expiry ON security_probes(expires_at);
END $$;

DO $$ BEGIN CREATE TABLE IF NOT EXISTS join_requests (
 id text PRIMARY KEY, room_code text NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, room_instance bigint NOT NULL,
 actor text NOT NULL, user_id text REFERENCES "user"(id) ON DELETE CASCADE, player text NOT NULL,
 status text NOT NULL, expires_at bigint NOT NULL, UNIQUE(room_code,room_instance,actor));
 CREATE INDEX IF NOT EXISTS join_requests_expiry ON join_requests(expires_at); END $$;
