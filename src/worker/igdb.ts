// IGDB client (spec §8). IGDB has no CORS and needs a Twitch app token, so every call goes through
// the Worker. The token (valid ~60 days) is cached in the kv table.

import {
  gamesByIdQuery, searchQuery, steamExternalQuery, steamUidForGameQuery, timeToBeatQuery,
} from '../core/catalog';
import { kvDelete, kvGet, kvPut } from './db/kv';
import { chunks } from './db/util';
import type { Ctx } from './env';
import { HttpError } from './http';
import { fetchUpstream } from './upstream';

const TOKEN_KEY = 'igdb_token';

async function token(ctx: Ctx): Promise<string> {
  const now = ctx.deps.now();
  const cached = await kvGet(ctx.env.DB, TOKEN_KEY, now.toISOString());
  if (cached) return cached;
  const params = new URLSearchParams({
    client_id: ctx.env.TWITCH_CLIENT_ID,
    client_secret: ctx.env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  const url = `${ctx.env.TWITCH_TOKEN_URL ?? 'https://id.twitch.tv/oauth2/token'}?${params}`;
  const body = (await (await fetchUpstream(ctx, 'Twitch token', url, { method: 'POST' })).json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token || !body.expires_in) throw new HttpError(502, 'Twitch token: unexpected response');
  // Refresh an hour early so a token never expires in the middle of an import.
  const expiresAt = new Date(now.getTime() + (body.expires_in - 3600) * 1000).toISOString();
  await kvPut(ctx.env.DB, TOKEN_KEY, body.access_token, expiresAt);
  return body.access_token;
}

/** POST one APICalypse query. On 401 (token revoked) fetch a new token once and retry. */
export async function igdbQuery(ctx: Ctx, endpoint: string, query: string): Promise<unknown[]> {
  const url = `${ctx.env.IGDB_BASE_URL ?? 'https://api.igdb.com/v4'}/${endpoint}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchUpstream(ctx, `IGDB ${endpoint}`, url, {
      method: 'POST',
      headers: { 'Client-ID': ctx.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${await token(ctx)}`, Accept: 'application/json' },
      body: query,
    }, [401]);
    if (res.status === 401) {
      if (attempt > 0) throw new HttpError(502, `IGDB ${endpoint}: HTTP 401`);
      await kvDelete(ctx.env.DB, TOKEN_KEY);
      continue;
    }
    return (await res.json()) as unknown[];
  }
}

export function igdbSearch(ctx: Ctx, text: string): Promise<unknown[]> {
  return igdbQuery(ctx, 'games', searchQuery(text));
}

export async function igdbGames(ctx: Ctx, ids: number[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const part of chunks(ids, 500)) out.push(...(await igdbQuery(ctx, 'games', gamesByIdQuery(part))));
  return out;
}

/** Steam appid → IGDB game id, via IGDB external_games (source 1 = Steam). */
export async function igdbSteamMappings(ctx: Ctx, appids: number[]): Promise<{ uid: string; game: number }[]> {
  const out: { uid: string; game: number }[] = [];
  for (const part of chunks(appids, 200)) {
    out.push(...((await igdbQuery(ctx, 'external_games', steamExternalQuery(part))) as { uid: string; game: number }[]));
  }
  return out;
}

export async function igdbSteamAppids(ctx: Ctx, gameId: number): Promise<number[]> {
  const rows = (await igdbQuery(ctx, 'external_games', steamUidForGameQuery(gameId))) as { uid: string }[];
  return rows.map((r) => Number(r.uid)).filter((n) => Number.isInteger(n) && n > 0);
}

/** game id → raw time-to-beat record. */
export async function igdbTimeToBeat(ctx: Ctx, ids: number[]): Promise<Map<number, unknown>> {
  const out = new Map<number, unknown>();
  for (const part of chunks(ids, 500)) {
    for (const t of (await igdbQuery(ctx, 'game_time_to_beats', timeToBeatQuery(part))) as { game_id: number }[]) {
      out.set(t.game_id, t);
    }
  }
  return out;
}
