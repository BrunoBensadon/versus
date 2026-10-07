// POST /api/logout and GET /api/status. (POST /api/login is in index.ts: it's the only public route.)

import { CLEAR_COOKIE } from '../auth';
import { kvGet } from '../db/kv';
import { json } from '../http';
import type { Route } from '../router';

export const sessionRoutes: Route[] = [
  {
    method: 'POST',
    path: /^\/api\/logout$/,
    run: async () => json({ ok: true }, 200, { 'set-cookie': CLEAR_COOKIE }),
  },
  {
    // Settings shows lastBackupAt, in red when older than 3 days (spec §10).
    method: 'GET',
    path: /^\/api\/status$/,
    run: async ({ ctx, nowIso }) => {
      const count = await ctx.env.DB.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>();
      return json({ lastBackupAt: await kvGet(ctx.env.DB, 'last_backup_at', nowIso), eventCount: count?.n ?? 0 });
    },
  },
];
