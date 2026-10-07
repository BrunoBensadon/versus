// Fetch games from IGDB together with their edition/remaster ancestors, collapse each to its root
// work, and store them (spec §8). Used by POST /api/games/:id and by the Steam import.

import { attachSteam, canonicalWork, MAX_CHAIN_STEPS, normalizeIgdb, parentIds } from '../core/catalog';
import type { GameId, GameMeta } from '../core/types';
import { putGameStatement, type GameRow } from './db/games';
import type { Ctx } from './env';
import { HttpError } from './http';
import { igdbGames, igdbSteamAppids, igdbTimeToBeat } from './igdb';
import { steamStoreItems, steamTagList } from './steam';

export interface Fetched {
  raw: Map<GameId, unknown>;
  meta: Map<GameId, GameMeta>;
}

/** Fetch `ids` and every ancestor canonicalWork() can visit (up to MAX_CHAIN_STEPS levels up). */
export async function fetchWithAncestors(ctx: Ctx, ids: GameId[]): Promise<Fetched> {
  const fetched: Fetched = { raw: new Map(), meta: new Map() };
  let wanted = [...new Set(ids)];
  for (let round = 0; round <= MAX_CHAIN_STEPS && wanted.length > 0; round++) {
    for (const raw of await igdbGames(ctx, wanted)) {
      const meta = normalizeIgdb(raw);
      fetched.raw.set(meta.id, raw);
      fetched.meta.set(meta.id, meta);
    }
    wanted = [...fetched.meta.values()].flatMap(parentIds).filter((id) => !fetched.meta.has(id));
    wanted = [...new Set(wanted)];
  }
  return fetched;
}

export function rootOf(fetched: Fetched, id: GameId): GameId {
  return canonicalWork(id, (x) => fetched.meta.get(x));
}

/**
 * Build the stored row for every fetched game. Root games get time-to-beat and Steam tags
 * (`steamItemFor` returns the store item to take tags from, or undefined).
 */
export function gameRows(
  fetched: Fetched,
  ttb: Map<GameId, unknown>,
  steamItemFor: (rootId: GameId) => unknown,
  tagNames: Map<number, string>,
  nowIso: string,
): GameRow[] {
  const rows: GameRow[] = [];
  for (const [id, raw] of fetched.raw) {
    const rootId = rootOf(fetched, id);
    let meta = normalizeIgdb(raw, ttb.get(id));
    if (id === rootId) {
      const item = steamItemFor(id);
      if (item !== undefined) meta = attachSteam(meta, item, tagNames);
    }
    rows.push({ meta, rootId, fetchedAt: nowIso });
  }
  return rows;
}

/** POST /api/games/:id: fetch-or-refresh one game (the searched game or the Refresh button). */
export async function refreshGame(ctx: Ctx, id: GameId): Promise<{ requestedId: GameId; rootId: GameId; meta: GameMeta }> {
  const nowIso = ctx.deps.now().toISOString();
  const fetched = await fetchWithAncestors(ctx, [id]);
  if (!fetched.meta.has(id)) throw new HttpError(404, `IGDB has no game ${id}`);
  const rootId = rootOf(fetched, id);
  const ttb = await igdbTimeToBeat(ctx, [rootId]);
  const appids = await igdbSteamAppids(ctx, rootId);
  let items = new Map<number, unknown>();
  let tagNames = new Map<number, string>();
  if (appids.length > 0) {
    items = await steamStoreItems(ctx, appids.slice(0, 1));
    tagNames = await steamTagList(ctx);
  }
  const rows = gameRows(fetched, ttb, () => (appids.length > 0 ? items.get(appids[0]) : undefined), tagNames, nowIso);
  await ctx.env.DB.batch(rows.map((r) => putGameStatement(ctx.env.DB, r)));
  return { requestedId: id, rootId, meta: rows.find((r) => r.meta.id === rootId)!.meta };
}
