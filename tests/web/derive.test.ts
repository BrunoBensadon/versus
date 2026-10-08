import { describe, expect, it } from 'vitest';
import { replay, scores } from '../../src/core/ranking';
import type { LibraryRow, RankEvent } from '../../src/core/types';
import {
  backupAgeDays, coverUrl, inboxQueue, isStale, makeEvent, matchesFilter, mergeEvents, rankedListCsv, ttbLabel,
  unrankedQueue, withPlacedBuckets,
} from '../../src/web/derive';
import { game } from '../core/helpers/game';
import { Log } from '../core/helpers/log';

const row = (gameId: number, over: Partial<LibraryRow> = {}): LibraryRow => ({
  gameId, status: 'inbox', bucket: null, platforms: [], source: 'steam', steamPlaytimeMin: null, addedAt: 'x', updatedAt: 'x', ...over,
});

const NOW = new Date('2026-10-06T12:00:00.000Z');

describe('events', () => {
  it('makeEvent stamps id, time and the global list', () => {
    expect(makeEvent({ type: 'unranked', gameId: 1, data: {} }, NOW, 'u1')).toEqual({
      type: 'unranked', gameId: 1, data: {}, id: 'u1', ts: NOW.toISOString(), listId: 'global',
    });
  });

  it('mergeEvents de-duplicates by id and sorts by seq', () => {
    const e = (seq: number, id: string) => ({ seq, id, ts: '', listId: 'global', type: 'unranked', gameId: 1, data: {} }) as RankEvent;
    expect(mergeEvents([e(2, 'b'), e(1, 'a')], [e(2, 'b'), e(3, 'c')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('withPlacedBuckets applies the latest placed bucket to library rows', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 's', bucket: 'liked', below: null } });
    log.add({ type: 'placed', gameId: 1, data: { session: 't', bucket: 'loved', below: null } });
    expect(withPlacedBuckets([row(1), row(2)], log.events).map((r) => r.bucket)).toEqual(['loved', null]);
  });
});

describe('queues', () => {
  const log = new Log();
  log.add({ type: 'placed', gameId: 3, data: { session: 's', bucket: 'liked', below: null } });
  log.add({ type: 'merged', gameId: 5, data: { into: 3 } });
  const state = replay(log.events);
  const rows = [
    row(1, { status: 'inbox', steamPlaytimeMin: 10 }),
    row(2, { status: 'inbox', steamPlaytimeMin: 500 }),
    row(3, { status: 'played', bucket: 'liked' }),
    row(4, { status: 'dropped', bucket: 'disliked', steamPlaytimeMin: 50 }),
    row(5, { status: 'inbox', steamPlaytimeMin: 999 }),
    row(6, { status: 'played', bucket: 'loved', steamPlaytimeMin: 900 }),
    row(7, { status: 'backlog', bucket: 'loved' }),
  ];

  it('inbox: highest playtime first, merged-away games hidden', () => {
    expect(inboxQueue(rows, state).map((r) => r.gameId)).toEqual([2, 1]);
  });

  it('unranked: played/dropped with a bucket, not yet placed, by playtime', () => {
    expect(unrankedQueue(rows, state).map((r) => r.gameId)).toEqual([6, 4]);
  });
});

describe('filters and labels', () => {
  const meta = game(1, { platforms: ['PC', 'Switch'], genres: ['RPG'], year: 2019 });

  it('matchesFilter checks platform (library or IGDB), genre, years and status', () => {
    expect(matchesFilter(meta, row(1, { platforms: ['PS5'] }), { platform: 'ps5' })).toBe(true);
    expect(matchesFilter(meta, row(1), { platform: 'switch', genre: 'rpg', yearFrom: 2010, yearTo: 2019 })).toBe(true);
    expect(matchesFilter(meta, row(1), { genre: 'Puzzle' })).toBe(false);
    expect(matchesFilter(meta, row(1), { yearFrom: 2020 })).toBe(false);
    expect(matchesFilter(meta, row(1, { status: 'played' }), { status: 'backlog' })).toBe(false);
  });

  it('ttbLabel rounds to hours and marks thin data with ~', () => {
    expect(ttbLabel({ hastily: 0, normally: 68400, completely: 0, count: 7 })).toBe('19 h');
    expect(ttbLabel({ hastily: 0, normally: 68400, completely: 0, count: 3 })).toBe('~19 h');
    expect(ttbLabel(null)).toBeNull();
  });

  it('isStale after 30 days or when never fetched', () => {
    expect(isStale('2026-09-10T00:00:00.000Z', NOW)).toBe(false);
    expect(isStale('2026-09-01T00:00:00.000Z', NOW)).toBe(true);
    expect(isStale(undefined, NOW)).toBe(true);
  });

  it('backupAgeDays counts whole days', () => {
    expect(backupAgeDays('2026-10-02T13:00:00.000Z', NOW)).toBe(3);
    expect(backupAgeDays(null, NOW)).toBeNull();
  });

  it('coverUrl builds IGDB image URLs', () => {
    expect(coverUrl('co65ac')).toBe('https://images.igdb.com/igdb/image/upload/t_cover_small/co65ac.jpg');
    expect(coverUrl(null)).toBeNull();
  });
});

describe('rankedListCsv', () => {
  it('lists the global order with scores and quotes awkward names', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'loved', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: null } });
    const state = replay(log.events);
    const games = new Map([[1, game(1, { name: 'Hades, the "good" one', year: 2020 })], [2, game(2, { year: null })]]);
    const csv = rankedListCsv(state, scores(state), games, new Map([[1, row(1, { status: 'played' })]]));
    expect(csv).toBe('rank,name,year,bucket,score,status\n1,"Hades, the ""good"" one",2020,loved,10.0,played\n2,Game 2,,liked,6.6,\n');
    expect(rankedListCsv(state, scores(state), new Map([[1, game(1, { name: 'Line\rbreak' })]]), new Map())).toContain('\n1,"Line\rbreak",');
  });
});
