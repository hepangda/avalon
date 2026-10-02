/** Additive startup schema. Keep legacy snapshots and account data intact. */
export const DDL = `
CREATE TABLE IF NOT EXISTS avalon_role_weights (
  account text PRIMARY KEY, weights jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS avalon_role_weight_games (
  game_id text NOT NULL, account text NOT NULL, PRIMARY KEY (game_id, account)
);
CREATE TABLE IF NOT EXISTS avalon_cards (
  account text PRIMARY KEY, cards integer NOT NULL DEFAULT 0 CHECK (cards BETWEEN 0 AND 2),
  completed_games integer NOT NULL DEFAULT 0, last_daily_day text
);
CREATE TABLE IF NOT EXISTS avalon_game_rewards (
  game_id text NOT NULL, account text NOT NULL, PRIMARY KEY (game_id, account)
);
CREATE TABLE IF NOT EXISTS avalon_runtime (
  id integer PRIMARY KEY CHECK (id = 1), token text NOT NULL
);
CREATE TABLE IF NOT EXISTS avalon_rooms (
  code text PRIMARY KEY CHECK (code ~ '^[0-9]{4}$'),
  version integer NOT NULL,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE avalon_rooms ADD COLUMN IF NOT EXISTS snapshot_version integer;
ALTER TABLE avalon_rooms ADD COLUMN IF NOT EXISTS snapshot_hash text;
ALTER TABLE avalon_rooms ADD COLUMN IF NOT EXISTS state_hash text;
UPDATE avalon_rooms SET snapshot_version = version WHERE snapshot_version IS NULL;
CREATE TABLE IF NOT EXISTS avalon_room_journal (
  code text NOT NULL REFERENCES avalon_rooms(code) ON DELETE CASCADE,
  version integer NOT NULL, entry jsonb NOT NULL,
  PRIMARY KEY (code, version)
);
CREATE TABLE IF NOT EXISTS avalon_replays (
  game_id text PRIMARY KEY,
  revision integer NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS avalon_profiles (
  account text PRIMARY KEY, alias text NOT NULL DEFAULT ''
);
ALTER TABLE avalon_profiles ALTER COLUMN alias SET DEFAULT '';
ALTER TABLE avalon_profiles ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}';`;
