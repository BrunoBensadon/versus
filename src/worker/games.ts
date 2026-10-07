// Fetch games from IGDB together with their edition/remaster ancestors, collapse each to its root
// work, and store them (spec §8). Used by POST /api/games/:id and by the Steam import.

import { attachSteam, canonicalWorkKnown, MAX_CHAIN_STEPS, normalizeIgdb, parentIds } from '../core/catalog';
import type { GameId, GameMeta } from '../core/types';
import { getGameRow, getSteamAppids, putGameStatement, type GameRow } from './db/games';
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

/**
 * The root work of a fetched game. If IGDB didn't return an ancestor, the walk stops at the last
 * game that WAS fetched, so the root is always a game we can store.
 */
export function rootOf(fetched: Fetched, id: GameId): GameId {
  // Same helper as scripts/restore-sql.ts, so a restore recomputes the same root ids.
  return canonicalWorkKnown(id, (x) => fetched.meta.get(x));
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

  // Which Steam appid to take the root's tags from. The import links the appids Bruno OWNS to the
  // root (e.g. Skyrim SE 489830 → Skyrim 472), and IGDB often links none to the root itself.
  const storedAppids = await getSteamAppids(ctx.env.DB, rootId);
  let tagAppid: number | undefined;
  if (storedAppids.length === 1) {
    tagAppid = storedAppids[0];
  } else if (storedAppids.length === 0) {
    // Never imported: ask IGDB, and take the smallest appid so the choice is always the same.
    const igdbAppids = await igdbSteamAppids(ctx, rootId);
    tagAppid = igdbAppids.length > 0 ? Math.min(...igdbAppids) : undefined;
  }
  // More than one stored appid: the import chose the tags by playtime, which a refresh can't know
  // per appid, so tagAppid stays undefined and the stored tags are kept (below).

  let item: unknown;
  let tagNames = new Map<number, string>();
  if (tagAppid !== undefined) {
    item = (await steamStoreItems(ctx, [tagAppid])).get(tagAppid);
    if (item !== undefined) tagNames = await steamTagList(ctx);
  }
  // Read the stored root before overwriting it, to keep its tags when there is no new store item.
  const storedRoot = await getGameRow(ctx.env.DB, rootId);

  const rows = gameRows(fetched, ttb, () => item, tagNames, nowIso);
  const rootRow = rows.find((r) => r.meta.id === rootId)!;
  if (item === undefined && storedRoot) {
    // No fresh tags: copy the stored ones instead of writing none (nothing to keep for a new game).
    rootRow.meta = { ...rootRow.meta, steamTags: storedRoot.meta.steamTags };
  }
  await ctx.env.DB.batch(rows.map((r) => putGameStatement(ctx.env.DB, r)));
  return { requestedId: id, rootId, meta: rootRow.meta };
}
