import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { GameMeta, LibraryRow } from '../../src/core/types';
import { fakeUpstream } from '../fixtures/fake-upstream';
import { call, loginCookie, testDeps } from './helpers';

describe('search', () => {
  it('proxies IGDB and reranks: "hades" → Supergiant\'s Hades first', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/search?q=hades', { cookie });
    const { results } = (await res.json()) as { results: GameMeta[] };
    expect(results[0]).toMatchObject({ id: 113112, name: 'Hades' });
  });

  it('needs at least 2 characters', async () => {
    const cookie = await loginCookie();
    expect((await call('/api/search?q=h', { cookie })).status).toBe(400);
  });
});

describe('POST /api/games/:id', () => {
  it('collapses Skyrim Anniversary to Skyrim and stores the chain', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/games/165192', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requestedId: number; rootId: number; meta: GameMeta };
    expect(body.requestedId).toBe(165192);
    expect(body.rootId).toBe(472);
    expect(body.meta.name).toBe('The Elder Scrolls V: Skyrim');
    const rows = await env.DB.prepare('SELECT id, root_id FROM games ORDER BY id').all<{ id: number; root_id: number }>();
    expect(rows.results).toEqual([
      { id: 472, root_id: 472 },
      { id: 19457, root_id: 472 },
      { id: 165192, root_id: 472 },
    ]);
  });

  it('attaches Steam tags and time-to-beat to the root game', async () => {
    const cookie = await loginCookie();
    const { meta } = (await (await call('/api/games/113112', { method: 'POST', cookie })).json()) as { meta: GameMeta };
    expect(meta.steamTags?.[0]).toMatchObject({ tagId: 42804, name: 'Action Roguelike' });
    expect(meta.ttb?.count).toBe(13);
  });

  it('answers 404 for an id IGDB does not know', async () => {
    const cookie = await loginCookie();
    expect((await call('/api/games/999999999', { method: 'POST', cookie })).status).toBe(404);
  });

  it('stops at the last fetched game when IGDB does not return an ancestor', async () => {
    const cookie = await loginCookie();
    // Counter-Strike: Source (307) made to say it is an edition of 999999001, which the fake IGDB doesn't have.
    const brokenChain = testDeps({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await fakeUpstream(input, init);
        if (!String(input).includes('/v4/games')) return res;
        const games = (await res.json()) as { id: number }[];
        const changed = games.map((g) => (g.id === 307 ? { ...g, version_parent: 999999001 } : g));
        return new Response(JSON.stringify(changed), { headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });
    const res = await call('/api/games/307', { method: 'POST', cookie }, brokenChain);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ requestedId: 307, rootId: 307 });
  });
});

describe('POST /api/import/steam', () => {
  it('imports owned games as inbox rows of their root works', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/import/steam', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    const summary = await res.json();
    expect(summary).toEqual({
      owned: 8,
      mapped: 7,
      added: 6,
      updated: 0,
      unmapped: [{ appid: 431960, name: 'Wallpaper Engine' }],
    });

    const { rows, games } = (await (await call('/api/library', { cookie })).json()) as { rows: LibraryRow[]; games: GameMeta[] };
    // BioShock + BioShock Remastered → 20; Skyrim SE → 472; GTA V and GTA V Enhanced stay separate.
    expect(rows.map((r) => r.gameId)).toEqual([20, 472, 1020, 11737, 113112, 334647]);
    expect(rows.every((r) => r.status === 'inbox' && r.source === 'steam')).toBe(true);
    expect(rows.find((r) => r.gameId === 20)?.steamPlaytimeMin).toBe(900); // 600 + 300
    expect(games.find((g) => g.id === 11737)?.steamTags?.length).toBe(20);
  });

  it('maps every Steam appid to its root work', async () => {
    const { results } = await env.DB.prepare("SELECT uid, game_id FROM external_ids WHERE source = 'steam' ORDER BY uid").all<{ uid: string; game_id: number }>();
    const gameOf = new Map(results.map((r) => [r.uid, r.game_id]));
    expect(gameOf.size).toBe(7);
    expect(gameOf.get('409710')).toBe(20); // BioShock Remastered → BioShock
    expect(gameOf.get('489830')).toBe(472); // Skyrim Special Edition → Skyrim
  });

  it('re-import only refreshes playtime and keeps what Bruno changed', async () => {
    const cookie = await loginCookie();
    await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify({ status: 'played', bucket: 'loved' }) });
    const summary = (await (await call('/api/import/steam', { method: 'POST', cookie })).json()) as { added: number; updated: number };
    expect(summary).toMatchObject({ added: 0, updated: 6 });
    const { rows } = (await (await call('/api/library', { cookie })).json()) as { rows: LibraryRow[] };
    expect(rows.find((r) => r.gameId === 11737)).toMatchObject({ status: 'played', bucket: 'loved' });
  });

  it('a refresh keeps the Steam tags the import attached (Skyrim SE tags on root Skyrim)', async () => {
    const cookie = await loginCookie();
    await call('/api/import/steam', { method: 'POST', cookie });
    const before = (await storedMeta(472)).steamTags;
    expect(before?.length).toBeGreaterThan(0);
    // IGDB links no Steam appid to 472 itself; the tags came from the owned appid 489830.
    expect((await call('/api/games/472', { method: 'POST', cookie })).status).toBe(200);
    expect((await storedMeta(472)).steamTags).toEqual(before);
  });
});

/** The stored meta of one game, straight from D1. */
async function storedMeta(id: number): Promise<GameMeta> {
  const row = await env.DB.prepare('SELECT meta FROM games WHERE id = ?').bind(id).first<{ meta: string }>();
  return JSON.parse(row!.meta) as GameMeta;
}
