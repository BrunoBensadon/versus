// SQL for sub-lists (spec §6.5): saved filters and hand-picked sets.

import type { Sublist, SublistFilter } from '../../core/types';

export async function getSublists(db: D1Database): Promise<Sublist[]> {
  const lists = await db.prepare('SELECT * FROM sublists ORDER BY created_at, id').all<{ id: string; name: string; kind: string; filter: string | null; created_at: string }>();
  const items = await db.prepare('SELECT sublist_id, game_id FROM sublist_items ORDER BY game_id').all<{ sublist_id: string; game_id: number }>();
  return lists.results.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind as Sublist['kind'],
    filter: s.filter === null ? null : (JSON.parse(s.filter) as SublistFilter),
    items: items.results.filter((i) => i.sublist_id === s.id).map((i) => i.game_id),
    createdAt: s.created_at,
  }));
}

export async function putSublist(db: D1Database, s: Sublist): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO sublists (id, name, kind, filter, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, filter = excluded.filter`,
    ).bind(s.id, s.name, s.kind, s.filter === null ? null : JSON.stringify(s.filter), s.createdAt),
    db.prepare('DELETE FROM sublist_items WHERE sublist_id = ?').bind(s.id),
    ...s.items.map((g) => db.prepare('INSERT INTO sublist_items (sublist_id, game_id) VALUES (?, ?)').bind(s.id, g)),
  ]);
}

export async function deleteSublist(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sublist_items WHERE sublist_id = ?').bind(id),
    db.prepare('DELETE FROM sublists WHERE id = ?').bind(id),
  ]);
}
