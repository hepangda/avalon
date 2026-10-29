-- Private, immutable cutover evidence. No application HTTP endpoint exposes these tables.
CREATE TABLE IF NOT EXISTS avalon_room_cutover_archive (
  migration text NOT NULL,
  incarnation text NOT NULL,
  code text NOT NULL,
  source_version bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('aborted', 'completed')),
  document jsonb NOT NULL,
  document_hash text NOT NULL,
  original_room jsonb NOT NULL,
  journal jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migration, incarnation)
);
CREATE INDEX IF NOT EXISTS avalon_room_cutover_archive_code ON avalon_room_cutover_archive(code);
CREATE TABLE IF NOT EXISTS avalon_replay_cutover_archive (
  migration text NOT NULL,
  game_id text NOT NULL,
  original_replay jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migration, game_id)
);
