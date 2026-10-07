// SQL for game metadata and external ids (Steam appid → canonical game).

import type { ExternalId, GameId, GameMeta } from '../../core/types';
import { chunks, marks } from './util';

export interface GameRow {
  meta: GameMeta;
  rootId: GameId;
  fetchedAt: string;
}

export function putGameStatement(db: D1Database, row: GameRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO games (id, root_id, meta, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET root_id = excluded.root_id, meta = excluded.meta, fetched_at = excluded.fetched_at`,
    )
    .bind(row.meta.id, row.rootId, JSON.stringify(row.meta), row.fetchedAt);
}

/** Root games only (the ones the app ranks and shows). With `ids`, just those. */
export async function getGames(db: D1Database, ids?: GameId[]): Promise<GameMeta[]> {
  if (!ids) {
    const { results } = await db.prepare('SELECT meta FROM games WHERE id = root_id ORDER BY id').all<{ meta: string }>();
    return results.map((r) => JSON.parse(r.meta) as GameMeta);
  }
  const out: GameMeta[] = [];
  for (const part of chunks(ids, 90)) {
    const { results } = await db.prepare(`SELECT meta FROM games WHERE id IN (${marks(part.length)})`).bind(...part).all<{ meta: string }>();
    out.push(...results.map((r) => JSON.parse(r.meta) as GameMeta));
  }
  return out;
}

/** When each root game's metadata was fetched (the PWA refreshes entries older than 30 days, spec §8). */
export async function getFetchedAt(db: D1Database): Promise<Record<number, string>> {
  const { results } = await db.prepare('SELECT id, fetched_at FROM games WHERE id = root_id').all<{ id: number; fetched_at: string }>();
  return Object.fromEntries(results.map((r) => [r.id, r.fetched_at]));
}

export async function getGameRow(db: D1Database, id: GameId): Promise<GameRow | null> {
  const r = await db.prepare('SELECT meta, root_id, fetched_at FROM games WHERE id = ?').bind(id).first<{ meta: string; root_id: number; fetched_at: string }>();
  return r ? { meta: JSON.parse(r.meta), rootId: r.root_id, fetchedAt: r.fetched_at } : null;
}

export function putExternalIdStatement(db: D1Database, x: ExternalId): D1PreparedStatement {
  return db
    .prepare('INSERT INTO external_ids (source, uid, game_id) VALUES (?, ?, ?) ON CONFLICT(source, uid) DO UPDATE SET game_id = excluded.game_id')
    .bind(x.source, x.uid, x.gameId);
}

export async function getExternalIds(db: D1Database): Promise<ExternalId[]> {
  const { results } = await db.prepare('SELECT source, uid, game_id FROM external_ids ORDER BY source, uid').all<{ source: string; uid: string; game_id: number }>();
  return results.map((r) => ({ source: r.source, uid: r.uid, gameId: r.game_id }));
}
