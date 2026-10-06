// Small HTTP helpers shared by the routes.

import type { Env } from './env';
import { redact } from './redact';

/** Throw this from a route to answer with a specific status and message. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'request body must be JSON');
  }
}

/** Turn any thrown error into a JSON response. Secrets are scrubbed from the message (spec §10). */
export function errorResponse(e: unknown, env: Env): Response {
  if (e instanceof HttpError) return json({ error: redact(e.message, env) }, e.status);
  const message = e instanceof Error ? e.message : String(e);
  console.error('unhandled error:', redact(message, env));
  return json({ error: redact(message, env) }, 500);
}

/** Parse a positive integer path segment such as the :id in /api/games/:id. */
export function idParam(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id must be a positive integer');
  return id;
}
