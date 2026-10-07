import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { handle } from '../../src/worker/index';
import { call, loginCookie, NOW, testDeps } from './helpers';

const PROTECTED: [string, string][] = [
  ['GET', '/api/events'],
  ['POST', '/api/events'],
  ['GET', '/api/library'],
  ['PUT', '/api/library/1'],
  ['GET', '/api/search?q=hades'],
  ['POST', '/api/import/steam'],
  ['POST', '/api/games/1'],
  ['GET', '/api/export'],
  ['GET', '/api/status'],
  ['GET', '/api/sublists'],
  ['PUT', '/api/sublists/x'],
  ['DELETE', '/api/sublists/x'],
  ['POST', '/api/logout'],
];

describe('auth', () => {
  it('runs on the fake test secrets, never the real ones', () => {
    // vitest.worker.config.ts overrides every secret; if this fails, real secrets may be leaking in.
    expect(env.APP_PASSPHRASE === 'test-passphrase').toBe(true);
    expect(env.STEAM_API_KEY.startsWith('TEST')).toBe(true);
    expect(env.STEAM_ID64 === '76561190000000000').toBe(true);
    expect(env.TWITCH_CLIENT_SECRET === 'test-twitch-secret').toBe(true);
  });

  it.each(PROTECTED)('%s %s needs the session cookie', async (method, path) => {
    const res = await call(path, { method, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
    expect(res.status).toBe(401);
  });

  it('logs in with the passphrase and sets a hardened 90-day cookie', async () => {
    const res = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: env.APP_PASSPHRASE }) });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^versus_session=\d+\.[\w-]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=7776000');
  });

  it('accepts the cookie on protected routes', async () => {
    const cookie = await loginCookie();
    expect((await call('/api/status', { cookie })).status).toBe(200);
  });

  it('rejects a tampered or expired cookie', async () => {
    const cookie = await loginCookie();
    const tampered = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await call('/api/status', { cookie: tampered })).status).toBe(401);
    const later = testDeps({ now: () => new Date(NOW.getTime() + 91 * 24 * 3600 * 1000) });
    expect((await call('/api/status', { cookie }, later)).status).toBe(401);
  });

  it('refuses logins after 5 failures in the same hour, and recovers the next hour', async () => {
    // Use a different hour than the other tests so their logins don't interfere.
    const hour = testDeps({ now: () => new Date('2026-10-07T09:15:00.000Z') });
    for (let i = 0; i < 5; i++) {
      const res = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: 'nope' }) }, hour);
      expect(res.status).toBe(401);
    }
    const blocked = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: env.APP_PASSPHRASE }) }, hour);
    expect(blocked.status).toBe(429);
    const nextHour = testDeps({ now: () => new Date('2026-10-07T10:01:00.000Z') });
    const ok = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: env.APP_PASSPHRASE }) }, nextHour);
    expect(ok.status).toBe(200);
  });

  it('keeps the limit when 10 wrong logins arrive at once', async () => {
    // Its own clock hour, so the other tests' logins don't count here.
    const hour = testDeps({ now: () => new Date('2026-10-07T15:30:00.000Z') });
    const wrong = () => call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: 'nope' }) }, hour);
    const results = await Promise.all(Array.from({ length: 10 }, wrong));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBe(5);
    expect(statuses.filter((s) => s === 429).length).toBe(5);
    // The limit was reached, so even the right passphrase is refused for the rest of this hour.
    const blocked = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: env.APP_PASSPHRASE }) }, hour);
    expect(blocked.status).toBe(429);
  });

  it('refuses to log anyone in when the passphrase secret is missing', async () => {
    // The helpers always use the test env, so build the request by hand with an empty secret.
    const noSecret = { ...env, APP_PASSPHRASE: '' };
    const hour = testDeps({ now: () => new Date('2026-10-07T17:00:00.000Z') });
    const req = new Request('https://versus.test/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase: '' }), // an empty passphrase must not match the empty secret
    });
    const res = await handle(req, noSecret, hour);
    expect(res.status).toBe(500);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('logout clears the cookie', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/logout', { method: 'POST', cookie });
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
