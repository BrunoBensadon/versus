// Turn an export (GET /api/export, the backup repo, or Settings → Export) into SQL statements that
// rebuild a FRESH, migrated D1 database (spec §10: "Restore = replay events into a fresh D1").
// Events keep their original seq numbers, so the order derived from them is identical.
// Pure string building, so it runs in Node (scripts/restore.ts) and in the Worker tests.

import { canonicalWork } from '../src/core/catalog';
import type { ExportFile, GameMeta } from '../src/core/types';

function lit(v: string | number | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

export function restoreStatements(file: ExportFile, nowIso: string): string[] {
  if (file.version !== 1) throw new Error(`unsupported export version ${String(file.version)}`);
  const out: string[] = [];
  for (const e of file.events) {
    out.push(
      `INSERT INTO events (seq, id, ts, list_id, type, game_id, data) VALUES (${lit(e.seq)}, ${lit(e.id)}, ${lit(e.ts)}, ${lit(e.listId)}, ${lit(e.type)}, ${lit(e.gameId)}, ${lit(JSON.stringify(e.data))});`,
    );
  }
  // root_id isn't in the export; recompute it from the exported games (ancestors are exported too).
  const byId = new Map<number, GameMeta>(file.games.map((g) => [g.id, g]));
  for (const g of file.games) {
    const root = canonicalWork(g.id, (id) => byId.get(id));
    out.push(`INSERT INTO games (id, root_id, meta, fetched_at) VALUES (${lit(g.id)}, ${lit(root)}, ${lit(JSON.stringify(g))}, ${lit(nowIso)});`);
  }
  for (const x of file.externalIds) {
    out.push(`INSERT INTO external_ids (source, uid, game_id) VALUES (${lit(x.source)}, ${lit(x.uid)}, ${lit(x.gameId)});`);
  }
  for (const r of file.library) {
    out.push(
      `INSERT INTO library (game_id, status, bucket, platforms, source, steam_playtime_min, added_at, updated_at) VALUES (${lit(r.gameId)}, ${lit(r.status)}, ${lit(r.bucket)}, ${lit(JSON.stringify(r.platforms))}, ${lit(r.source)}, ${lit(r.steamPlaytimeMin)}, ${lit(r.addedAt)}, ${lit(r.updatedAt)});`,
    );
  }
  for (const s of file.sublists) {
    out.push(
      `INSERT INTO sublists (id, name, kind, filter, created_at) VALUES (${lit(s.id)}, ${lit(s.name)}, ${lit(s.kind)}, ${lit(s.filter === null ? null : JSON.stringify(s.filter))}, ${lit(s.createdAt)});`,
    );
    for (const item of s.items) out.push(`INSERT INTO sublist_items (sublist_id, game_id) VALUES (${lit(s.id)}, ${lit(item)});`);
  }
  return out;
}
