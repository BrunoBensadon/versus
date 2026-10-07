-- versus schema v1 (spec §5).

-- The crown jewels. Append-only: the triggers below forbid UPDATE and DELETE.
CREATE TABLE events (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,      -- total order of the log
  id       TEXT    NOT NULL UNIQUE,                -- client-generated UUID → idempotent retries
  ts       TEXT    NOT NULL,                       -- ISO-8601 UTC, client clock
  list_id  TEXT    NOT NULL DEFAULT 'global',      -- reserved for own-criterion sub-lists (Later)
  type     TEXT    NOT NULL CHECK (type IN ('session_started','answer','undo','session_cancelled',
                                              'placed','unranked','merged','unmerged')),
  game_id  INTEGER NOT NULL,                       -- the game being ranked / merged-from
  data     TEXT    NOT NULL DEFAULT '{}'           -- JSON payload (spec §5 table)
);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TABLE games (
  id         INTEGER PRIMARY KEY,                  -- IGDB id
  root_id    INTEGER NOT NULL,                     -- canonicalWork(id); equals id for root works
  meta       TEXT    NOT NULL,                     -- JSON GameMeta
  fetched_at TEXT    NOT NULL
);

CREATE TABLE external_ids (
  source  TEXT    NOT NULL,                        -- 'steam'
  uid     TEXT    NOT NULL,                        -- Steam appid
  game_id INTEGER NOT NULL,                        -- canonical id
  PRIMARY KEY (source, uid)
);

CREATE TABLE library (
  game_id            INTEGER PRIMARY KEY,          -- canonical id
  status             TEXT    NOT NULL CHECK (status IN ('inbox','wishlist','backlog','playing','played','dropped','ignored')),
  bucket             TEXT    CHECK (bucket IN ('loved','liked','disliked')),
  platforms          TEXT    NOT NULL DEFAULT '[]', -- JSON string[]
  source             TEXT    NOT NULL CHECK (source IN ('steam','manual')),
  steam_playtime_min INTEGER,
  added_at           TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

CREATE TABLE sublists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('filter','set')),
  filter     TEXT,                                 -- JSON SublistFilter when kind = 'filter'
  created_at TEXT NOT NULL
);

CREATE TABLE sublist_items (
  sublist_id TEXT    NOT NULL,
  game_id    INTEGER NOT NULL,
  PRIMARY KEY (sublist_id, game_id)
);

CREATE TABLE kv (                                  -- IGDB token, last_backup_at, login failure counters
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at TEXT
);
