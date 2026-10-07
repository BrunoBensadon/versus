// Restore drill as a test (spec §10): an export applied to a fresh database exports identically.
// This file's database starts empty (each Worker test file gets its own).

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ExportFile } from '../../src/core/types';
import { restoreStatements } from '../../scripts/restore-sql';
import { kvGet } from '../../src/worker/db/kv';
import { exportRoutes } from '../../src/worker/routes/export';
import { syntheticGames } from '../fixtures/synthetic';
import { call, loginCookie, NOW, testDeps } from './helpers';

function sampleExport(): ExportFile {
  const games = syntheticGames({ games: 4, seed: 3, noise: 0 });
  return {
    version: 1,
    exportedAt: NOW.toISOString(),
    events: [
      { seq: 3, id: 'a', ts: NOW.toISOString(), listId: 'global', type: 'session_started', gameId: 1, data: { session: 's', bucket: 'loved' } },
      { seq: 4, id: 'b', ts: NOW.toISOString(), listId: 'global', type: 'placed', gameId: 1, data: { session: 's', bucket: 'loved', below: null } },
      { seq: 9, id: "it's", ts: NOW.toISOString(), listId: 'global', type: 'unranked', gameId: 2, data: {} },
    ],
    library: [
      { gameId: 1, status: 'played', bucket: 'loved', platforms: ['PC'], source: 'steam', steamPlaytimeMin: 42, addedAt: 'a', updatedAt: 'b' },
      { gameId: 2, status: 'backlog', bucket: null, platforms: [], source: 'manual', steamPlaytimeMin: null, addedAt: 'c', updatedAt: 'd' },
    ],
    games,
    externalIds: [{ source: 'steam', uid: '10', gameId: 1 }],
    sublists: [
      { id: 'f', name: "Bruno's PC", kind: 'filter', filter: { platform: 'PC' }, items: [], createdAt: 'e' },
      { id: 's', name: 'Set', kind: 'set', filter: null, items: [1, 2], createdAt: 'f' },
    ],
  };
}

describe('export and restore', () => {
  it('an export restored into a fresh database exports the same data, seq numbers included', async () => {
    const original = sampleExport();
    const statements = restoreStatements(original, NOW.toISOString());
    await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));

    const cookie = await loginCookie();
    const res = await call('/api/export', { cookie });
    expect(res.headers.get('content-disposition')).toContain('versus-export-2026-10-06.json');
    const restored = (await res.json()) as ExportFile;
    expect(restored).toEqual(original);
  });

  it('the backup token reads /api/export, and only /api/export', async () => {
    const headers = { authorization: `Bearer ${env.BACKUP_TOKEN}` };
    expect((await call('/api/events', { headers })).status).toBe(401);
    expect((await call('/api/export', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  });

  it('the backup token records last_backup_at, shown by /api/status', async () => {
    const res = await call('/api/export', { headers: { authorization: `Bearer ${env.BACKUP_TOKEN}` } });
    expect(res.status).toBe(200);
    const cookie = await loginCookie();
    const status = await (await call('/api/status', { cookie })).json();
    expect(status).toEqual({ lastBackupAt: NOW.toISOString(), eventCount: 3 });
  });

  it('a failed export does not record last_backup_at', async () => {
    // Start without a recorded backup (the test above set one), so "not recorded" means null.
    await env.DB.prepare("DELETE FROM kv WHERE key = 'last_backup_at'").run();
    // A database whose events table can't be read: exportAll() fails part-way through.
    const brokenDb = {
      prepare: (sql: string) => {
        if (sql.includes('FROM events')) throw new Error('events table unusable');
        return env.DB.prepare(sql);
      },
    } as unknown as D1Database;
    const ctx = { env: { ...env, DB: brokenDb }, deps: testDeps() };
    const req = new Request('https://versus.test/api/export');
    const run = exportRoutes[0].run({ req, url: new URL(req.url), ctx, params: [], nowIso: NOW.toISOString(), viaBackupToken: true });
    await expect(run).rejects.toThrow('events table unusable');
    expect(await kvGet(env.DB, 'last_backup_at', NOW.toISOString())).toBeNull();
  });

  it('refuses an unknown export version', () => {
    expect(() => restoreStatements({ ...sampleExport(), version: 2 as 1 }, NOW.toISOString())).toThrow(/version/);
  });

  it('a game whose parent is not in the export is restored as its own root, like the live Worker does', async () => {
    // A remaster (game type 9, which canonicalWork follows) of game 9000, which was never fetched.
    // Ids 9000/9001 are not used by the other tests in this file.
    const [base] = syntheticGames({ games: 1, seed: 5, noise: 0 });
    const remaster = { ...base, id: 9001, name: 'Remaster', gameType: 9, parentGame: 9000 };
    const file: ExportFile = {
      version: 1, exportedAt: NOW.toISOString(), events: [], library: [], games: [remaster], externalIds: [], sublists: [],
    };
    const statements = restoreStatements(file, NOW.toISOString());
    await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));

    const row = await env.DB.prepare('SELECT root_id FROM games WHERE id = ?').bind(9001).first<{ root_id: number }>();
    expect(row?.root_id).toBe(9001);
    const cookie = await loginCookie();
    const lib = (await (await call('/api/library', { cookie })).json()) as { games: { id: number }[] };
    expect(lib.games.map((g) => g.id)).toContain(9001);
  });
});
