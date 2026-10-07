// SQL for the append-only event log (spec §5).

import type { NewEvent, RankEvent } from '../../core/types';
import { chunks, marks } from './util';

interface EventRow {
  seq: number;
  id: string;
  ts: string;
  list_id: string;
  type: string;
  game_id: number;
  data: string;
}

function toEvent(r: EventRow): RankEvent {
  return { seq: r.seq, id: r.id, ts: r.ts, listId: r.list_id, type: r.type, gameId: r.game_id, data: JSON.parse(r.data) } as RankEvent;
}

/**
 * Append events. A retry with the same client UUIDs inserts nothing (idempotent).
 * A `placed` event also sets the library row's bucket (spec §5, bucket rule).
 * Returns the stored events (with their seq), in log order.
 */
export async function insertEvents(db: D1Database, events: NewEvent[], nowIso: string): Promise<RankEvent[]> {
  const statements: D1PreparedStatement[] = [];
  for (const e of events) {
    statements.push(
      db.prepare('INSERT INTO events (id, ts, list_id, type, game_id, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(e.id, e.ts, e.listId, e.type, e.gameId, JSON.stringify(e.data)),
    );
    if (e.type === 'placed') {
      statements.push(
        db.prepare('UPDATE library SET bucket = ?, updated_at = ? WHERE game_id = ?').bind(e.data.bucket, nowIso, e.gameId),
      );
    }
  }
  if (statements.length > 0) await db.batch(statements);
  const stored: RankEvent[] = [];
  for (const ids of chunks(events.map((e) => e.id), 90)) {
    const { results } = await db.prepare(`SELECT * FROM events WHERE id IN (${marks(ids.length)})`).bind(...ids).all<EventRow>();
    stored.push(...results.map(toEvent));
  }
  return stored.sort((a, b) => a.seq - b.seq);
}

export async function listEvents(db: D1Database, since = 0): Promise<RankEvent[]> {
  const { results } = await db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq').bind(since).all<EventRow>();
  return results.map(toEvent);
}
