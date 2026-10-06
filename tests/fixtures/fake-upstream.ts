// A fake IGDB + Twitch + Steam that answers from the captured fixtures. Used as `deps.fetch` in the
// Worker tests, and served over HTTP for the end-to-end tests (Plan 5, tests/e2e/fake-upstream-server.ts).
// It recognizes requests by path and query text, the same way the real APIs would be called.

import externalSteam from './igdb/external-steam.json';
import games from './igdb/games.json';
import searchHades from './igdb/search-hades.json';
import searchOuterWild from './igdb/search-outer-wild.json';
import timeToBeat from './igdb/time-to-beat.json';
import getItems from './steam/get-items.json';
import owned from './steam/owned.json';
import tagList from './steam/tag-list.json';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Numbers inside the first "(...)" after `field =` in an APICalypse query. */
function listAfter(query: string, field: string): string[] {
  const m = query.match(new RegExp(`${field} = \\(([^)]*)\\)`));
  return m ? m[1].split(',').map((s) => s.replace(/"/g, '').trim()) : [];
}

async function igdb(endpoint: string, query: string): Promise<Response> {
  if (endpoint === 'games') {
    const search = query.match(/^search "([^"]*)"/);
    if (search) {
      const q = search[1].toLowerCase();
      if (q.includes('hades')) return json(searchHades);
      if (q.includes('outer wild')) return json(searchOuterWild);
      return json([]);
    }
    const ids = listAfter(query, 'id').map(Number);
    return json(games.filter((g) => ids.includes(g.id)));
  }
  if (endpoint === 'external_games') {
    const uids = listAfter(query, 'uid');
    if (uids.length > 0) return json(externalSteam.filter((e) => uids.includes(e.uid)));
    const game = Number(query.match(/game = (\d+)/)?.[1]);
    return json(externalSteam.filter((e) => e.game === game));
  }
  if (endpoint === 'game_time_to_beats') {
    const ids = listAfter(query, 'game_id').map(Number);
    return json(timeToBeat.filter((t) => ids.includes(t.game_id)));
  }
  return json({ message: `fake IGDB has no ${endpoint}` }, 404);
}

function steam(url: URL): Response {
  if (url.pathname.includes('GetOwnedGames')) return json(owned);
  if (url.pathname.includes('GetTagList')) return json(tagList);
  if (url.pathname.includes('GetItems')) {
    const input = JSON.parse(url.searchParams.get('input_json') ?? '{}') as { ids?: { appid: number }[] };
    const wanted = new Set((input.ids ?? []).map((i) => i.appid));
    return json({ response: { store_items: getItems.response.store_items.filter((i) => wanted.has(i.appid)) } });
  }
  return json({ message: 'fake Steam: unknown endpoint' }, 404);
}

/** Drop-in replacement for fetch() that never touches the network. */
export async function fakeUpstream(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.pathname.endsWith('/oauth2/token')) {
    return json({ access_token: 'fake-igdb-token', expires_in: 5_184_000, token_type: 'bearer' });
  }
  const igdbEndpoint = url.pathname.match(/\/v4\/([a-z_]+)$/)?.[1];
  if (igdbEndpoint) return igdb(igdbEndpoint, await request.text());
  if (url.pathname.startsWith('/IPlayerService/') || url.pathname.startsWith('/IStore')) return steam(url);
  return json({ message: `fake upstream: no route for ${url.pathname}` }, 404);
}
