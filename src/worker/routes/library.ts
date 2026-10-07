// GET /api/library, PUT /api/library/:id, and the sub-list routes (spec §4, §6.5).

import {
  BUCKETS, STATUSES, type Bucket, type LibraryRow, type Status, type Sublist, type SublistFilter,
} from '../../core/types';
import { getFetchedAt, getGameRow, getGames } from '../db/games';
import { getLibrary, getLibraryRow, upsertLibrary } from '../db/library';
import { deleteSublist, getSublists, putSublist } from '../db/sublists';
import { HttpError, idParam, json, readJson } from '../http';
import type { Route } from '../router';
import { fail, isGameId, isObject, isText } from '../validate';

export interface LibraryPatch {
  status?: Status;
  bucket?: Bucket | null;
  platforms?: string[];
}

/** Body of PUT /api/library/:id: any of status, bucket (or null), platforms. */
export function parseLibraryPatch(body: unknown): LibraryPatch {
  if (!isObject(body)) fail('body must be an object');
  const patch: LibraryPatch = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) fail('status is invalid');
    patch.status = body.status as Status;
  }
  if (body.bucket !== undefined) {
    if (body.bucket !== null && !BUCKETS.includes(body.bucket as Bucket)) fail('bucket is invalid');
    patch.bucket = body.bucket as Bucket | null;
  }
  if (body.platforms !== undefined) {
    if (!Array.isArray(body.platforms) || !body.platforms.every((p) => isText(p))) fail('platforms must be a list of names');
    patch.platforms = body.platforms as string[];
  }
  return patch;
}

/** Body of PUT /api/sublists/:id. */
export function parseSublist(id: string, body: unknown, nowIso: string): Sublist {
  if (!isText(id)) fail('sub-list id is invalid');
  if (!isObject(body)) fail('body must be an object');
  if (!isText(body.name, 100)) fail('name must be 1-100 characters');
  if (body.kind !== 'filter' && body.kind !== 'set') fail('kind must be "filter" or "set"');
  let filter: SublistFilter | null = null;
  if (body.kind === 'filter') {
    if (!isObject(body.filter)) fail('a filter sub-list needs a filter object');
    const f = body.filter;
    filter = {};
    if (f.platform !== undefined) filter.platform = isText(f.platform) ? f.platform : fail('filter.platform is invalid');
    if (f.genre !== undefined) filter.genre = isText(f.genre) ? f.genre : fail('filter.genre is invalid');
    if (f.yearFrom !== undefined) filter.yearFrom = Number.isInteger(f.yearFrom) ? (f.yearFrom as number) : fail('filter.yearFrom is invalid');
    if (f.yearTo !== undefined) filter.yearTo = Number.isInteger(f.yearTo) ? (f.yearTo as number) : fail('filter.yearTo is invalid');
    if (f.status !== undefined) filter.status = STATUSES.includes(f.status as Status) ? (f.status as Status) : fail('filter.status is invalid');
  }
  const items = body.items ?? [];
  if (!Array.isArray(items) || !items.every(isGameId)) fail('items must be a list of game ids');
  const createdAt = typeof body.createdAt === 'string' ? body.createdAt : nowIso;
  return { id, name: body.name, kind: body.kind, filter, items: items as number[], createdAt };
}

export const libraryRoutes: Route[] = [
  {
    method: 'GET',
    path: /^\/api\/library$/,
    run: async ({ ctx }) =>
      json({ rows: await getLibrary(ctx.env.DB), games: await getGames(ctx.env.DB), fetchedAt: await getFetchedAt(ctx.env.DB) }),
  },
  {
    // Upsert: updates an existing row, or adds a searched game (status defaults to wishlist).
    method: 'PUT',
    path: /^\/api\/library\/([^/]+)$/,
    run: async ({ req, ctx, params, nowIso }) => {
      const db = ctx.env.DB;
      const gameId = idParam(params[0]);
      const patch = parseLibraryPatch(await readJson(req));
      const old = await getLibraryRow(db, gameId);
      if (!old && !(await getGameRow(db, gameId))) throw new HttpError(404, `fetch game ${gameId} first (POST /api/games/${gameId})`);
      const row: LibraryRow = old
        ? { ...old, ...patch, updatedAt: nowIso }
        : {
            gameId, status: patch.status ?? 'wishlist', bucket: patch.bucket ?? null, platforms: patch.platforms ?? [],
            source: 'manual', steamPlaytimeMin: null, addedAt: nowIso, updatedAt: nowIso,
          };
      await upsertLibrary(db, row);
      return json({ row });
    },
  },
  {
    method: 'GET',
    path: /^\/api\/sublists$/,
    run: async ({ ctx }) => json({ sublists: await getSublists(ctx.env.DB) }),
  },
  {
    method: 'PUT',
    path: /^\/api\/sublists\/([^/]+)$/,
    run: async ({ req, ctx, params, nowIso }) => {
      const sublist = parseSublist(decodeURIComponent(params[0]), await readJson(req), nowIso);
      await putSublist(ctx.env.DB, sublist);
      return json({ sublist });
    },
  },
  {
    method: 'DELETE',
    path: /^\/api\/sublists\/([^/]+)$/,
    run: async ({ ctx, params }) => {
      await deleteSublist(ctx.env.DB, decodeURIComponent(params[0]));
      return json({ ok: true });
    },
  },
];
