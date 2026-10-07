// Steam import (spec §8, R-DATA-2): owned games → IGDB ids → root works → tags and time-to-beat →
// games, external_ids and library rows. New games land in `inbox`; existing rows only get their
// playtime updated. About 10 upstream requests for ~120 games (Workers limit: 50 per request).
// ⚠️ CPU: the free plan allows 10 ms CPU per request; Plan 6 measures this import with `wrangler tail`.

import type { GameId, LibraryRow } from '../core/types';
import { putExternalIdStatement, putGameStatement } from './db/games';
import { getLibrary, upsertLibraryStatement } from './db/library';
import type { Ctx } from './env';
import { fetchWithAncestors, gameRows, rootOf } from './games';
import { igdbSteamMappings, igdbTimeToBeat } from './igdb';
import { steamOwnedGames, steamStoreItems, steamTagList } from './steam';

export interface ImportSummary {
  owned: number;
  mapped: number; // owned apps that IGDB knows
  added: number; // new library rows (inbox)
  updated: number; // existing rows whose playtime was refreshed
  unmapped: { appid: number; name: string }[]; // usually software, not games
}

export async function importSteam(ctx: Ctx): Promise<ImportSummary> {
  const nowIso = ctx.deps.now().toISOString();
  const owned = await steamOwnedGames(ctx);

  // 1. appid → IGDB game (one per appid; IGDB maps 98% of Bruno's library 1:1)
  const igdbOf = new Map<number, GameId>();
  for (const m of await igdbSteamMappings(ctx, owned.map((g) => g.appid))) igdbOf.set(Number(m.uid), m.game);
  const mapped = owned.filter((g) => igdbOf.has(g.appid));

  // 2. games + ancestors → root work per appid
  const fetched = await fetchWithAncestors(ctx, [...new Set(igdbOf.values())]);
  const rootOfApp = new Map<number, GameId>();
  for (const g of mapped) {
    const igdbId = igdbOf.get(g.appid)!;
    if (fetched.meta.has(igdbId)) rootOfApp.set(g.appid, rootOf(fetched, igdbId));
  }
  const roots = [...new Set(rootOfApp.values())];

  // 3. Steam tags + time-to-beat. When two appids collapse into one root, the higher-playtime appid's tags win.
  const items = await steamStoreItems(ctx, [...rootOfApp.keys()]);
  const tagNames = await steamTagList(ctx);
  const ttb = await igdbTimeToBeat(ctx, roots);
  const appsByPlaytime = [...mapped].sort((a, b) => b.playtimeMin - a.playtimeMin);
  const itemFor = (rootId: GameId) => {
    const app = appsByPlaytime.find((g) => rootOfApp.get(g.appid) === rootId);
    return app ? items.get(app.appid) : undefined;
  };
  const rows = gameRows(fetched, ttb, itemFor, tagNames, nowIso);

  // 4. Library: playtime summed over the appids of one root.
  const playtime = new Map<GameId, number>();
  for (const g of mapped) {
    const root = rootOfApp.get(g.appid);
    if (root !== undefined) playtime.set(root, (playtime.get(root) ?? 0) + g.playtimeMin);
  }
  const existing = new Map((await getLibrary(ctx.env.DB)).map((r) => [r.gameId, r]));
  const libraryRows: LibraryRow[] = roots.map((root) => {
    const old = existing.get(root);
    if (old) return { ...old, steamPlaytimeMin: playtime.get(root) ?? 0, updatedAt: nowIso };
    return {
      gameId: root, status: 'inbox', bucket: null, platforms: ['PC'], source: 'steam',
      steamPlaytimeMin: playtime.get(root) ?? 0, addedAt: nowIso, updatedAt: nowIso,
    };
  });

  const db = ctx.env.DB;
  await db.batch([
    ...rows.map((r) => putGameStatement(db, r)),
    ...[...rootOfApp].map(([appid, gameId]) => putExternalIdStatement(db, { source: 'steam', uid: String(appid), gameId })),
    ...libraryRows.map((r) => upsertLibraryStatement(db, r)),
  ]);

  return {
    owned: owned.length,
    mapped: mapped.length,
    added: libraryRows.filter((r) => !existing.has(r.gameId)).length,
    updated: libraryRows.filter((r) => existing.has(r.gameId)).length,
    unmapped: owned.filter((g) => !igdbOf.has(g.appid)).map((g) => ({ appid: g.appid, name: g.name })),
  };
}
