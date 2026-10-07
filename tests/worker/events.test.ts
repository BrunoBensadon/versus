import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { RankEvent } from '../../src/core/types';
import { call, loginCookie, newEvent } from './helpers';

async function post(cookie: string, events: unknown[]): Promise<Response> {
  return call('/api/events', { method: 'POST', cookie, body: JSON.stringify({ events }) });
}

describe('events', () => {
  it('appends a batch and assigns increasing seq numbers', async () => {
    const cookie = await loginCookie();
    const batch = [
      newEvent({ type: 'session_started', gameId: 11737, data: { session: 's1', bucket: 'loved' } }),
      newEvent({ type: 'placed', gameId: 11737, data: { session: 's1', bucket: 'loved', below: null } }),
    ];
    const res = await post(cookie, batch);
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as { events: RankEvent[] };
    expect(events.map((e) => e.id)).toEqual(batch.map((e) => e.id));
    expect(events[1].seq).toBeGreaterThan(events[0].seq);
    expect(events[1].data).toEqual({ session: 's1', bucket: 'loved', below: null });
  });

  it('is idempotent: re-posting the same ids stores nothing new and returns the same seqs', async () => {
    const cookie = await loginCookie();
    const batch = [newEvent({ type: 'unranked', gameId: 5, data: {} })];
    const first = (await (await post(cookie, batch)).json()) as { events: RankEvent[] };
    const again = (await (await post(cookie, batch)).json()) as { events: RankEvent[] };
    expect(again.events).toEqual(first.events);
    const count = await env.DB.prepare('SELECT count(*) AS n FROM events WHERE id = ?').bind(batch[0].id).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('GET ?since returns only newer events, in order', async () => {
    const cookie = await loginCookie();
    const all = (await (await call('/api/events', { cookie })).json()) as { events: RankEvent[] };
    const last = all.events.at(-1)!.seq;
    await post(cookie, [newEvent({ type: 'unranked', gameId: 6, data: {} })]);
    const newer = (await (await call(`/api/events?since=${last}`, { cookie })).json()) as { events: RankEvent[] };
    expect(newer.events).toHaveLength(1);
    expect(newer.events[0].gameId).toBe(6);
  });

  it('a placed event updates the library bucket', async () => {
    const cookie = await loginCookie();
    await env.DB.prepare(
      "INSERT INTO library (game_id, status, bucket, platforms, source, added_at, updated_at) VALUES (77, 'played', 'liked', '[]', 'manual', 'x', 'x')",
    ).run();
    await post(cookie, [newEvent({ type: 'placed', gameId: 77, data: { session: 's77', bucket: 'loved', below: null } })]);
    const row = await env.DB.prepare('SELECT bucket FROM library WHERE game_id = 77').first<{ bucket: string }>();
    expect(row?.bucket).toBe('loved');
  });

  it('a retried old placed event does not roll the bucket back', async () => {
    const cookie = await loginCookie();
    await env.DB.prepare(
      "INSERT INTO library (game_id, status, bucket, platforms, source, added_at, updated_at) VALUES (78, 'played', 'disliked', '[]', 'manual', 'x', 'x')",
    ).run();
    const batch1 = [newEvent({ type: 'placed', gameId: 78, data: { session: 's78', bucket: 'loved', below: null } })];
    const batch2 = [newEvent({ type: 'placed', gameId: 78, data: { session: 's78', bucket: 'liked', below: null } })];
    await post(cookie, batch1);
    await post(cookie, batch2);
    await post(cookie, batch1); // late retry of the first POST (same event ids)
    const row = await env.DB.prepare('SELECT bucket FROM library WHERE game_id = 78').first<{ bucket: string }>();
    expect(row?.bucket).toBe('liked');
    const count = await env.DB.prepare("SELECT count(*) AS n FROM events WHERE type = 'placed' AND game_id = 78").first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it.each([
    ['no events array', {}],
    ['empty batch', { events: [] }],
    ['unknown type', { events: [{ id: 'a', ts: '2026-10-06T00:00:00Z', type: 'deleted', gameId: 1, data: {} }] }],
    ['bad game id', { events: [{ id: 'a', ts: '2026-10-06T00:00:00Z', type: 'unranked', gameId: -1, data: {} }] }],
    ['bad bucket', { events: [{ id: 'a', ts: '2026-10-06T00:00:00Z', type: 'session_started', gameId: 1, data: { session: 's', bucket: 'meh' } }] }],
    ['bad date', { events: [{ id: 'a', ts: 'yesterday', type: 'unranked', gameId: 1, data: {} }] }],
  ])('rejects a malformed batch (%s) with 400', async (_name, body) => {
    const cookie = await loginCookie();
    const res = await call('/api/events', { method: 'POST', cookie, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
  });
});
