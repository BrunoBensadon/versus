import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { fakeUpstream } from '../fixtures/fake-upstream';
import { call, loginCookie, testDeps } from './helpers';

describe('upstream errors', () => {
  it('never puts the Steam key in an error body, even when the fetch error contains the URL', async () => {
    const cookie = await loginCookie();
    const leaky = testDeps({
      fetch: (async (input: RequestInfo | URL) => {
        throw new Error(`connect failed for ${String(input)}`); // the URL includes ?key=...
      }) as typeof fetch,
    });
    const res = await call('/api/import/steam', { method: 'POST', cookie }, leaky);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(env.STEAM_API_KEY);
    expect(text).not.toContain(env.STEAM_ID64);
    expect(JSON.parse(text)).toEqual({ error: 'Steam GetOwnedGames: network error' });
  });

  it('retries a 429 twice, then succeeds', async () => {
    const cookie = await loginCookie();
    let calls = 0;
    const sleeps: number[] = [];
    const flaky = testDeps({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/v4/games') && calls++ < 2) return new Response('slow down', { status: 429 });
        return fakeUpstream(input, init);
      }) as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const res = await call('/api/search?q=hades', { cookie }, flaky);
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after the third 429', async () => {
    const cookie = await loginCookie();
    const always429 = testDeps({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/v4/games') ? new Response('', { status: 429 }) : fakeUpstream(input, init)) as typeof fetch,
    });
    const res = await call('/api/search?q=hades', { cookie }, always429);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'IGDB games: HTTP 429' });
  });

  it('on an IGDB 401 fetches a new token once and retries', async () => {
    const cookie = await loginCookie();
    // Start without a cached token ('igdb_token' is TOKEN_KEY in igdb.ts), so the count is exact.
    await env.DB.prepare("DELETE FROM kv WHERE key = 'igdb_token'").run();
    let tokens = 0;
    const auths: string[] = [];
    const revoked = testDeps({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/oauth2/token')) {
          tokens += 1;
          return new Response(JSON.stringify({ access_token: `token-${tokens}`, expires_in: 5_184_000 }), { headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/v4/games')) {
          auths.push(new Headers(init?.headers).get('Authorization') ?? '');
          if (auths.length === 1) return new Response('', { status: 401 }); // first token revoked
        }
        return fakeUpstream(input, init);
      }) as typeof fetch,
    });
    const res = await call('/api/search?q=hades', { cookie }, revoked);
    expect(res.status).toBe(200);
    expect(tokens).toBe(2);
    expect(auths).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('gives up with a label-only 502 when IGDB keeps answering 401', async () => {
    const cookie = await loginCookie();
    const always401 = testDeps({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/v4/games') ? new Response('', { status: 401 }) : fakeUpstream(input, init)) as typeof fetch,
    });
    const res = await call('/api/search?q=hades', { cookie }, always401);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'IGDB games: HTTP 401' });
    expect(text).not.toContain('igdb.com');
    expect(text).not.toContain('fake-igdb-token');
    expect(text).not.toContain(env.TWITCH_CLIENT_SECRET);
  });
});
