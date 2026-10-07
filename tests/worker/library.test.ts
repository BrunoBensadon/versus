import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { normalizeIgdb } from '../../src/core/catalog';
import type { LibraryRow, Sublist } from '../../src/core/types';
import { putGameStatement } from '../../src/worker/db/games';
import games from '../fixtures/igdb/games.json';
import { call, loginCookie, NOW } from './helpers';

/** Store Outer Wilds' metadata as if POST /api/games/11737 had run (that route comes in a later task). */
async function storeOuterWilds(): Promise<void> {
  const meta = normalizeIgdb(games.find((g) => g.id === 11737));
  await putGameStatement(env.DB, { meta, rootId: meta.id, fetchedAt: NOW.toISOString() }).run();
}

describe('library', () => {
  it('starts empty', async () => {
    const cookie = await loginCookie();
    const body = await (await call('/api/library', { cookie })).json();
    expect(body).toEqual({ rows: [], games: [], fetchedAt: {} });
  });

  it('refuses to add a game whose metadata was never fetched', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify({ status: 'backlog' }) });
    expect(res.status).toBe(404);
  });

  it('adds a fetched game as a manual entry, then patches it', async () => {
    const cookie = await loginCookie();
    await storeOuterWilds();
    const add = await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify({ status: 'backlog', platforms: ['Switch'] }) });
    expect(add.status).toBe(200);
    const patch = await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify({ status: 'played', bucket: 'loved' }) });
    const { row } = (await patch.json()) as { row: LibraryRow };
    expect(row).toMatchObject({ gameId: 11737, status: 'played', bucket: 'loved', platforms: ['Switch'], source: 'manual' });

    const lib = (await (await call('/api/library', { cookie })).json()) as {
      rows: LibraryRow[];
      games: { id: number }[];
      fetchedAt: Record<number, string>;
    };
    expect(lib.rows.map((r) => r.gameId)).toEqual([11737]);
    expect(lib.games.map((g) => g.id)).toContain(11737);
    expect(lib.fetchedAt).toEqual({ 11737: NOW.toISOString() });
  });

  it('validates the patch', async () => {
    const cookie = await loginCookie();
    for (const body of [{ status: 'finished' }, { bucket: 'meh' }, { platforms: 'PC' }]) {
      const res = await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
    expect((await call('/api/library/abc', { method: 'PUT', cookie, body: '{}' })).status).toBe(400);
  });
});

describe('sub-lists', () => {
  it('saves, lists, replaces and deletes filter and set sub-lists', async () => {
    const cookie = await loginCookie();
    const put = (id: string, body: unknown) => call(`/api/sublists/${id}`, { method: 'PUT', cookie, body: JSON.stringify(body) });
    expect((await put('switch', { name: 'On Switch', kind: 'filter', filter: { platform: 'Switch' } })).status).toBe(200);
    expect((await put('coop', { name: 'Co-op nights', kind: 'set', items: [113112, 11737] })).status).toBe(200);
    expect((await put('coop', { name: 'Co-op nights', kind: 'set', items: [11737] })).status).toBe(200);

    const { sublists } = (await (await call('/api/sublists', { cookie })).json()) as { sublists: Sublist[] };
    // Ordered by creation time, then id (both were created at the same test clock time).
    expect(sublists.map((s) => [s.id, s.kind, s.items])).toEqual([
      ['coop', 'set', [11737]],
      ['switch', 'filter', []],
    ]);
    expect(sublists[1].filter).toEqual({ platform: 'Switch' });

    await call('/api/sublists/coop', { method: 'DELETE', cookie });
    const after = (await (await call('/api/sublists', { cookie })).json()) as { sublists: Sublist[] };
    expect(after.sublists.map((s) => s.id)).toEqual(['switch']);
  });

  it('validates sub-lists', async () => {
    const cookie = await loginCookie();
    const bad = [{ name: '', kind: 'set' }, { name: 'x', kind: 'smart' }, { name: 'x', kind: 'filter' }, { name: 'x', kind: 'set', items: ['a'] }];
    for (const body of bad) {
      expect((await call('/api/sublists/x', { method: 'PUT', cookie, body: JSON.stringify(body) })).status).toBe(400);
    }
  });
});
