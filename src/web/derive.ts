// Pure helpers the screens share: queues, filters, CSV, labels. No React, no fetch, so they're unit-tested
// in Node (tests/web/derive.test.ts) like the core.

import { formatScore, globalOrder, positionOf, type RankState } from '../core/ranking';
import type {
  EventBody, GameId, GameMeta, LibraryRow, NewEvent, RankEvent, SublistFilter, TimeToBeat,
} from '../core/types';

/** A new event as the client sends it: a fresh UUID makes retries idempotent. */
export function makeEvent(body: EventBody, now: Date, id: string): NewEvent {
  return { ...body, id, ts: now.toISOString(), listId: 'global' };
}

/** Merge newly stored events into the local log, without duplicates, in seq order. */
export function mergeEvents(current: RankEvent[], incoming: RankEvent[]): RankEvent[] {
  const byId = new Map(current.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Mirror the server's bucket rule locally: a `placed` event sets the library row's bucket. */
export function withPlacedBuckets(rows: LibraryRow[], events: RankEvent[]): LibraryRow[] {
  const latest = new Map<GameId, LibraryRow['bucket']>();
  for (const e of events) if (e.type === 'placed') latest.set(e.gameId, e.data.bucket);
  return rows.map((r) => (latest.has(r.gameId) ? { ...r, bucket: latest.get(r.gameId)! } : r));
}

const byPlaytime = (a: LibraryRow, b: LibraryRow) => (b.steamPlaytimeMin ?? -1) - (a.steamPlaytimeMin ?? -1) || a.gameId - b.gameId;

/** Imported games waiting for triage, highest Steam playtime first (spec §6.4). Merged-away games are hidden. */
export function inboxQueue(rows: LibraryRow[], state: RankState): LibraryRow[] {
  return rows.filter((r) => r.status === 'inbox' && !state.aliases.has(r.gameId)).sort(byPlaytime);
}

/** Played or dropped games with a triage bucket but no place yet: the "Rank 10" queue. */
export function unrankedQueue(rows: LibraryRow[], state: RankState): LibraryRow[] {
  return rows
    .filter((r) => (r.status === 'played' || r.status === 'dropped') && r.bucket !== null)
    .filter((r) => !state.aliases.has(r.gameId) && positionOf(state, r.gameId) === null)
    .sort(byPlaytime);
}

/** Does a game pass a saved filter (platform / genre / year / status)? */
export function matchesFilter(meta: GameMeta | undefined, row: LibraryRow | undefined, f: SublistFilter): boolean {
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
  if (f.platform) {
    const platforms = lower([...(row?.platforms ?? []), ...(meta?.platforms ?? [])]);
    if (!platforms.includes(f.platform.toLowerCase())) return false;
  }
  if (f.genre && !lower(meta?.genres ?? []).includes(f.genre.toLowerCase())) return false;
  if (f.yearFrom !== undefined && (meta?.year ?? -Infinity) < f.yearFrom) return false;
  if (f.yearTo !== undefined && (meta?.year ?? Infinity) > f.yearTo) return false;
  if (f.status && row?.status !== f.status) return false;
  return true;
}

/** "12 h", or "~12 h" when fewer than 5 players reported a time (spec §7.3). */
export function ttbLabel(ttb: TimeToBeat | null): string | null {
  if (!ttb || ttb.normally <= 0) return null;
  const hours = Math.max(1, Math.round(ttb.normally / 3600));
  return `${ttb.count < 5 ? '~' : ''}${hours} h`;
}

/** Metadata older than 30 days is refreshed when a game is opened (spec §8). */
export function isStale(fetchedAt: string | undefined, now: Date): boolean {
  if (!fetchedAt) return true;
  return now.getTime() - Date.parse(fetchedAt) > 30 * 24 * 3600 * 1000;
}

/** Whole days since the last backup, or null if there never was one. */
export function backupAgeDays(lastBackupAt: string | null, now: Date): number | null {
  if (!lastBackupAt) return null;
  return Math.floor((now.getTime() - Date.parse(lastBackupAt)) / (24 * 3600 * 1000));
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The ranked list as CSV (spec §10, Export): rank, name, year, bucket, score, status. */
export function rankedListCsv(
  state: RankState,
  scoreMap: Map<GameId, number>,
  games: Map<GameId, GameMeta>,
  rows: Map<GameId, LibraryRow>,
): string {
  const lines = ['rank,name,year,bucket,score,status'];
  globalOrder(state).forEach((id, i) => {
    const g = games.get(id);
    const pos = positionOf(state, id)!;
    lines.push([i + 1, g?.name ?? `IGDB ${id}`, g?.year ?? '', pos.bucket, formatScore(scoreMap.get(id) ?? 0), rows.get(id)?.status ?? ''].map(csvCell).join(','));
  });
  return `${lines.join('\n')}\n`;
}

/** IGDB cover URL. Sizes: t_cover_small (90×128), t_cover_big (264×374). */
export function coverUrl(imageId: string | null, size: 't_cover_small' | 't_cover_big' = 't_cover_small'): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
}
