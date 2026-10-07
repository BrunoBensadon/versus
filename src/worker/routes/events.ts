// GET /api/events?since=<seq> and POST /api/events (spec §4, §5).

import { BUCKETS, EVENT_TYPES, type Bucket, type EventType, type NewEvent } from '../../core/types';
import { insertEvents, listEvents } from '../db/events';
import { HttpError, json, readJson } from '../http';
import type { Route } from '../router';
import { fail, isGameId, isObject, isText, type Json } from '../validate';

function checkData(type: EventType, d: Json, where: string): void {
  const session = () => isText(d.session) || fail(`${where}: data.session must be a string`);
  switch (type) {
    case 'session_started':
      session();
      if (!BUCKETS.includes(d.bucket as Bucket)) fail(`${where}: data.bucket is invalid`);
      break;
    case 'answer':
      session();
      if (!isGameId(d.pivot)) fail(`${where}: data.pivot must be a game id`);
      if (!['better', 'worse', 'tie'].includes(d.result as string)) fail(`${where}: data.result is invalid`);
      break;
    case 'undo':
    case 'session_cancelled':
      session();
      break;
    case 'placed':
      session();
      if (!BUCKETS.includes(d.bucket as Bucket)) fail(`${where}: data.bucket is invalid`);
      if (d.below !== null && !isGameId(d.below)) fail(`${where}: data.below must be a game id or null`);
      break;
    case 'unranked':
      break;
    case 'merged':
    case 'unmerged':
      if (!isGameId(d.into)) fail(`${where}: data.into must be a game id`);
      break;
  }
}

/** Body of POST /api/events: { events: NewEvent[] } with 1–500 events. */
export function parseNewEvents(body: unknown): NewEvent[] {
  if (!isObject(body) || !Array.isArray(body.events)) fail('body must be { events: [...] }');
  const list = body.events as unknown[];
  if (list.length === 0 || list.length > 500) fail('send between 1 and 500 events');
  return list.map((raw, i) => {
    const where = `events[${i}]`;
    if (!isObject(raw)) fail(`${where} must be an object`);
    if (!isText(raw.id)) fail(`${where}.id must be a string of at most 64 characters`);
    if (typeof raw.ts !== 'string' || Number.isNaN(Date.parse(raw.ts))) fail(`${where}.ts must be an ISO date`);
    const listId = raw.listId ?? 'global';
    if (!isText(listId)) fail(`${where}.listId is invalid`);
    if (!EVENT_TYPES.includes(raw.type as EventType)) fail(`${where}.type is invalid`);
    if (!isGameId(raw.gameId)) fail(`${where}.gameId must be a game id`);
    if (!isObject(raw.data)) fail(`${where}.data must be an object`);
    checkData(raw.type as EventType, raw.data, where);
    return { id: raw.id, ts: raw.ts, listId, type: raw.type, gameId: raw.gameId, data: raw.data } as NewEvent;
  });
}

export const eventRoutes: Route[] = [
  {
    method: 'GET',
    path: /^\/api\/events$/,
    run: async ({ url, ctx }) => {
      const since = Number(url.searchParams.get('since') ?? '0');
      if (!Number.isInteger(since) || since < 0) throw new HttpError(400, 'since must be a non-negative integer');
      return json({ events: await listEvents(ctx.env.DB, since) });
    },
  },
  {
    method: 'POST',
    path: /^\/api\/events$/,
    run: async ({ req, ctx, nowIso }) => {
      const events = parseNewEvents(await readJson(req));
      return json({ events: await insertEvents(ctx.env.DB, events, nowIso) });
    },
  },
];
