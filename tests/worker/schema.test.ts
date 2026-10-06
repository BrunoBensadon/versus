// The database schema and the request pipeline, before any feature route exists.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../../src/worker/http';
import { call, loginCookie } from './helpers';

describe('schema', () => {
  it('creates every table', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(['events', 'external_ids', 'games', 'kv', 'library', 'sublist_items', 'sublists']);
  });

  it('refuses UPDATE and DELETE on events (append-only triggers)', async () => {
    await env.DB.prepare("INSERT INTO events (id, ts, type, game_id) VALUES ('raw-1', 'x', 'unranked', 1)").run();
    await expect(env.DB.prepare("UPDATE events SET game_id = 2 WHERE id = 'raw-1'").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM events WHERE id = 'raw-1'").run()).rejects.toThrow(/append-only/);
  });

  it('rejects an unknown event type at the database level', async () => {
    await expect(env.DB.prepare("INSERT INTO events (id, ts, type, game_id) VALUES ('raw-2', 'x', 'deleted', 1)").run()).rejects.toThrow();
  });
});

describe('request pipeline', () => {
  it('answers 404 outside /api', async () => {
    expect((await call('/index.html')).status).toBe(404);
  });

  it('answers 401 for an unknown /api route without a session, 404 with one', async () => {
    expect((await call('/api/nope')).status).toBe(401);
    const cookie = await loginCookie();
    const res = await call('/api/nope', { cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no route for GET /api/nope' });
  });

  it('redacts secrets from unexpected error messages', async () => {
    const res = errorResponse(new Error(`boom at ?key=${env.STEAM_API_KEY}&steamid=${env.STEAM_ID64}`), env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom at ?key=***&steamid=***' });
  });
});
