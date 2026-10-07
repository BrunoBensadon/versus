// Single-user auth (spec §10, NF-4): a passphrase → an HMAC-signed session cookie valid 90 days.
// After 5 failed logins in the same clock hour, logins are refused until the next hour.

import { kvDecrement, kvIncrement } from './db/kv';
import type { Ctx } from './env';
import { HttpError } from './http';

export const COOKIE_NAME = 'versus_session';
const SESSION_SECONDS = 90 * 24 * 3600;
const MAX_FAILURES_PER_HOUR = 5;

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: string, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, encoder.encode(message));
}

/**
 * Compare two strings without leaking, through timing, how much of them matched.
 * Both are hashed first so the compared byte arrays always have the same length.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function makeSessionCookie(ctx: Ctx): Promise<string> {
  const expires = Math.floor(ctx.deps.now().getTime() / 1000) + SESSION_SECONDS;
  const signature = base64url(await hmac(ctx.env.SESSION_KEY, `v1:${expires}`));
  return `${COOKIE_NAME}=${expires}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export const CLEAR_COOKIE = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function hasValidSession(req: Request, ctx: Ctx): Promise<boolean> {
  const value = readCookie(req, COOKIE_NAME);
  if (!value) return false;
  const [expiresText, signature] = value.split('.');
  const expires = Number(expiresText);
  if (!Number.isInteger(expires) || !signature) return false;
  if (expires <= ctx.deps.now().getTime() / 1000) return false;
  const expected = base64url(await hmac(ctx.env.SESSION_KEY, `v1:${expires}`));
  return constantTimeEqual(signature, expected);
}

export async function hasBackupToken(req: Request, ctx: Ctx): Promise<boolean> {
  // Never authenticate against a missing secret: an unset token would let "Bearer " through.
  if (!ctx.env.BACKUP_TOKEN || ctx.env.BACKUP_TOKEN.length < 8) return false;
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  return constantTimeEqual(header.slice('Bearer '.length), ctx.env.BACKUP_TOKEN);
}

/** POST /api/login. Returns the Set-Cookie value; throws 401, 429, or 500 if the secret is missing. */
export async function login(passphrase: unknown, ctx: Ctx): Promise<string> {
  // Never authenticate against a missing secret: an unset passphrase would let an empty one log in.
  if (!ctx.env.APP_PASSPHRASE || ctx.env.APP_PASSPHRASE.length < 8) {
    throw new HttpError(500, 'server not configured');
  }
  const now = ctx.deps.now();
  const hourKey = `login_failures:${now.toISOString().slice(0, 13)}`; // e.g. login_failures:2026-10-06T14
  const expiresAt = new Date(now.getTime() + 2 * 3600 * 1000).toISOString();
  // Count this attempt as a failure BEFORE checking it, in one atomic statement. Reading the
  // counter and writing it back later would let a burst of parallel logins all see the same count.
  const attempts = await kvIncrement(ctx.env.DB, hourKey, expiresAt);
  if (attempts > MAX_FAILURES_PER_HOUR) throw new HttpError(429, 'too many failed logins; try again next hour');
  if (typeof passphrase === 'string' && (await constantTimeEqual(passphrase, ctx.env.APP_PASSPHRASE))) {
    await kvDecrement(ctx.env.DB, hourKey); // a success isn't a failure: give the reserved attempt back
    return makeSessionCookie(ctx);
  }
  throw new HttpError(401, 'wrong passphrase'); // the reserved attempt stays counted
}
