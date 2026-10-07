// SQL for the library table.

import type { GameId, LibraryRow } from '../../core/types';

interface LibraryDbRow {
  game_id: number;
  status: string;
  bucket: string | null;
  platforms: string;
  source: string;
  steam_playtime_min: number | null;
  added_at: string;
  updated_at: string;
}

function toLibraryRow(r: LibraryDbRow): LibraryRow {
  return {
    gameId: r.game_id,
    status: r.status as LibraryRow['status'],
    bucket: r.bucket as LibraryRow['bucket'],
    platforms: JSON.parse(r.platforms),
    source: r.source as LibraryRow['source'],
    steamPlaytimeMin: r.steam_playtime_min,
    addedAt: r.added_at,
    updatedAt: r.updated_at,
  };
}

export async function getLibrary(db: D1Database): Promise<LibraryRow[]> {
  const { results } = await db.prepare('SELECT * FROM library ORDER BY game_id').all<LibraryDbRow>();
  return results.map(toLibraryRow);
}

export async function getLibraryRow(db: D1Database, gameId: GameId): Promise<LibraryRow | null> {
  const r = await db.prepare('SELECT * FROM library WHERE game_id = ?').bind(gameId).first<LibraryDbRow>();
  return r ? toLibraryRow(r) : null;
}

export function upsertLibraryStatement(db: D1Database, row: LibraryRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO library (game_id, status, bucket, platforms, source, steam_playtime_min, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET status = excluded.status, bucket = excluded.bucket,
         platforms = excluded.platforms, source = excluded.source,
         steam_playtime_min = excluded.steam_playtime_min, updated_at = excluded.updated_at`,
    )
    .bind(row.gameId, row.status, row.bucket, JSON.stringify(row.platforms), row.source, row.steamPlaytimeMin, row.addedAt, row.updatedAt);
}

export async function upsertLibrary(db: D1Database, row: LibraryRow): Promise<void> {
  await upsertLibraryStatement(db, row).run();
}
