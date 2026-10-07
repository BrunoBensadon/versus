// GET /api/export: the whole database as one JSON file (spec §10, R-LIB-3). The nightly backup job
// calls it with the bearer token, which also records last_backup_at for the Settings screen.

import { exportAll } from '../db/export';
import { kvPut } from '../db/kv';
import { json } from '../http';
import type { Route } from '../router';

export const exportRoutes: Route[] = [
  {
    method: 'GET',
    path: /^\/api\/export$/,
    run: async ({ ctx, nowIso, viaBackupToken }) => {
      if (viaBackupToken) await kvPut(ctx.env.DB, 'last_backup_at', nowIso);
      return json(await exportAll(ctx.env.DB, nowIso), 200, {
        'content-disposition': `attachment; filename="versus-export-${nowIso.slice(0, 10)}.json"`,
      });
    },
  },
];
