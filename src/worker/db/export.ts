// The full export (GET /api/export, nightly backup, Export button).

import type { ExportFile, GameMeta } from '../../core/types';
import { listEvents } from './events';
import { getExternalIds } from './games';
import { getLibrary } from './library';
import { getSublists } from './sublists';

export async function exportAll(db: D1Database, nowIso: string): Promise<ExportFile> {
  const { results } = await db.prepare('SELECT meta FROM games ORDER BY id').all<{ meta: string }>();
  return {
    version: 1,
    exportedAt: nowIso,
    events: await listEvents(db, 0),
    library: await getLibrary(db),
    games: results.map((r) => JSON.parse(r.meta) as GameMeta),
    externalIds: await getExternalIds(db),
    sublists: await getSublists(db),
  };
}
