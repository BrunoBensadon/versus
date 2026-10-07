// The Worker: a plain fetch handler with a route table (spec §3, §4). No framework.
// Only /api/* reaches this code; Cloudflare serves the PWA's static files itself (wrangler.jsonc).

import { hasBackupToken, hasValidSession, login } from './auth';
import { realDeps, type Ctx, type Deps, type Env } from './env';
import { errorResponse, HttpError, json, readJson } from './http';
import type { Route } from './router';
import { catalogRoutes } from './routes/catalog';
import { eventRoutes } from './routes/events';
import { exportRoutes } from './routes/export';
import { libraryRoutes } from './routes/library';
import { sessionRoutes } from './routes/session';

export type { Env } from './env';

const ROUTES: Route[] = [...sessionRoutes, ...eventRoutes, ...libraryRoutes, ...catalogRoutes, ...exportRoutes];

export async function handle(req: Request, env: Env, deps: Deps = realDeps): Promise<Response> {
  const ctx: Ctx = { env, deps };
  const url = new URL(req.url);
  try {
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'not found');

    // The only public route.
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = (await readJson(req)) as { passphrase?: unknown };
      return json({ ok: true }, 200, { 'set-cookie': await login(body.passphrase, ctx) });
    }

    // The backup job reads GET /api/export with a bearer token; everything else needs the cookie.
    const isExport = req.method === 'GET' && url.pathname === '/api/export';
    const viaBackupToken = isExport && (await hasBackupToken(req, ctx));
    if (!viaBackupToken && !(await hasValidSession(req, ctx))) throw new HttpError(401, 'log in first');

    for (const route of ROUTES) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.path);
      if (match) {
        return await route.run({ req, url, ctx, params: match.slice(1), nowIso: deps.now().toISOString(), viaBackupToken });
      }
    }
    throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
  } catch (e) {
    return errorResponse(e, env);
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
} satisfies ExportedHandler<Env>;
