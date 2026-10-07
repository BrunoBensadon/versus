// Steam Web API client (spec §8). The key goes in the query string, so URLs are never logged and
// errors only name the endpoint (see upstream.ts).
//
// Tags come from IStoreBrowseService/GetItems, an undocumented endpoint (⚠️ spec §9). If it breaks,
// SteamSpy is the documented fallback; it is not built in v1.

import { steamItemsByAppid, steamItemsInput, steamTagNames } from '../core/catalog';
import { chunks } from './db/util';
import type { Ctx } from './env';
import { fetchUpstream } from './upstream';

function steamUrl(ctx: Ctx, path: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, key: ctx.env.STEAM_API_KEY });
  return `${ctx.env.STEAM_BASE_URL ?? 'https://api.steampowered.com'}/${path}?${q}`;
}

export interface OwnedGame {
  appid: number;
  name: string;
  playtimeMin: number;
}

export async function steamOwnedGames(ctx: Ctx): Promise<OwnedGame[]> {
  const url = steamUrl(ctx, 'IPlayerService/GetOwnedGames/v1/', {
    steamid: ctx.env.STEAM_ID64,
    include_appinfo: '1',
    include_played_free_games: '1',
  });
  const body = (await (await fetchUpstream(ctx, 'Steam GetOwnedGames', url)).json()) as {
    response?: { games?: { appid: number; name?: string; playtime_forever?: number }[] };
  };
  return (body.response?.games ?? []).map((g) => ({ appid: g.appid, name: g.name ?? `App ${g.appid}`, playtimeMin: g.playtime_forever ?? 0 }));
}

/** appid → raw store item (with up to 20 weighted user tags), 50 apps per call. */
export async function steamStoreItems(ctx: Ctx, appids: number[]): Promise<Map<number, unknown>> {
  const out = new Map<number, unknown>();
  for (const part of chunks(appids, 50)) {
    const url = steamUrl(ctx, 'IStoreBrowseService/GetItems/v1/', {
      input_json: steamItemsInput(part),
    });
    const raw = await (await fetchUpstream(ctx, 'Steam GetItems', url)).json();
    for (const [appid, item] of steamItemsByAppid(raw)) out.set(appid, item);
  }
  return out;
}

export async function steamTagList(ctx: Ctx): Promise<Map<number, string>> {
  const url = steamUrl(ctx, 'IStoreService/GetTagList/v1/', { language: 'english' });
  return steamTagNames(await (await fetchUpstream(ctx, 'Steam GetTagList', url)).json());
}
