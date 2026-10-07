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
});
