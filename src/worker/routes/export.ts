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
      const file = await exportAll(ctx.env.DB, nowIso);
      // Only a backup that was actually built counts (spec §10: Settings turns red after 3 days without one).
      if (viaBackupToken) await kvPut(ctx.env.DB, 'last_backup_at', nowIso);
      return json(file, 200, {
        'content-disposition': `attachment; filename="versus-export-${nowIso.slice(0, 10)}.json"`,
      });
    },
  },
];
