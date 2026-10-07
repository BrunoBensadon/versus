// Restore drill as a test (spec §10): an export applied to a fresh database exports identically.
// This file's database starts empty (each Worker test file gets its own).

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ExportFile } from '../../src/core/types';
import { restoreStatements } from '../../scripts/restore-sql';
import { syntheticGames } from '../fixtures/synthetic';
import { call, loginCookie, NOW } from './helpers';

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
