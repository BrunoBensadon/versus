// GET /api/search, POST /api/games/:id, POST /api/import/steam (spec §4, §8).

import { normalizeIgdb, rerankSearch } from '../../core/catalog';
import { refreshGame } from '../games';
import { HttpError, idParam, json } from '../http';
import { igdbSearch } from '../igdb';
import { importSteam } from '../import';
import type { Route } from '../router';

export const catalogRoutes: Route[] = [
  {
    method: 'GET',
    path: /^\/api\/search$/,
    run: async ({ url, ctx }) => {
      const q = (url.searchParams.get('q') ?? '').trim();
      if (q.length < 2) throw new HttpError(400, 'type at least 2 characters');
      const hits = (await igdbSearch(ctx, q)).map((raw) => normalizeIgdb(raw));
      return json({ results: rerankSearch(hits, q) });
    },
  },
  {
    method: 'POST',
    path: /^\/api\/games\/([^/]+)$/,
    run: async ({ ctx, params }) => json(await refreshGame(ctx, idParam(params[0]))),
  },
  {
    method: 'POST',
    path: /^\/api\/import\/steam$/,
    run: async ({ ctx }) => json(await importSteam(ctx)),
  },
];
