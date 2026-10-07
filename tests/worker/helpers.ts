// Helpers for the Worker tests: call a route, log in, build events.
import { env } from 'cloudflare:workers';
import type { EventBody, NewEvent } from '../../src/core/types';
import type { Deps } from '../../src/worker/env';
import { handle } from '../../src/worker/index';
import { fakeUpstream } from '../fixtures/fake-upstream';

export const NOW = new Date('2026-10-06T12:00:00.000Z');

/** Fake outside world: fixtures instead of the network, a fixed clock, no real waiting. */
export function testDeps(overrides: Partial<Deps> = {}): Deps {
  return { fetch: fakeUpstream as typeof fetch, now: () => NOW, sleep: async () => {}, ...overrides };
}

export async function call(
  path: string,
  init: RequestInit & { cookie?: string } = {},
  deps: Deps = testDeps(),
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return handle(new Request(`https://versus.test${path}`, { ...init, headers }), env, deps);
}

/** Log in and return the `name=value` part of the session cookie. */
export async function loginCookie(deps: Deps = testDeps()): Promise<string> {
  const res = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: env.APP_PASSPHRASE }) }, deps);
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return res.headers.get('set-cookie')!.split(';')[0];
}

let counter = 0;
/** A NewEvent with a unique id. */
export function newEvent(body: EventBody): NewEvent {
  counter += 1;
  return { ...body, id: `test-${counter}-${Math.random().toString(36).slice(2)}`, ts: NOW.toISOString(), listId: 'global' };
}
