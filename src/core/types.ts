// Shared domain types for versus.
// Everything under src/core is pure: no fetch, no DOM, no database. The Worker (src/worker)
// and the PWA (src/web) import these types; core never imports from them.

/** IGDB id of the canonical (root) work, e.g. BioShock Remastered collapses into BioShock. */
export type GameId = number;

export type Bucket = 'loved' | 'liked' | 'disliked';
/** Best bucket first. A game in an earlier bucket always outranks one in a later bucket. */
export const BUCKETS: readonly Bucket[] = ['loved', 'liked', 'disliked'];

export type Status = 'inbox' | 'wishlist' | 'backlog' | 'playing' | 'played' | 'dropped' | 'ignored';
export const STATUSES: readonly Status[] = [
  'inbox', 'wishlist', 'backlog', 'playing', 'played', 'dropped', 'ignored',
];

/** An answer from the point of view of the NEW game: 'better' = the new game beats the pivot. */
export type AnswerResult = 'better' | 'worse' | 'tie';

export interface SteamTag {
  tagId: number;
  name: string;
  weight: number; // Steam's vote weight; only the ratio to the game's top tag matters
}

/** IGDB time-to-beat, in seconds. `count` = number of player submissions. */
export interface TimeToBeat {
  hastily: number;
  normally: number;
  completely: number;
  count: number;
}

/** Everything the app knows about one game. Built only by src/core/catalog/normalize.ts. */
export interface GameMeta {
  id: GameId;
  name: string;
  year: number | null;
  gameType: number; // IGDB game_type id: 0 main, 3 bundle, 4 standalone expansion, 8 remake, 9 remaster, 10 expanded, 11 port
  coverImageId: string | null;
  genres: string[];
  themes: string[];
  keywords: string[];
  modes: string[];
  perspectives: string[];
  collections: string[];
  franchises: string[]; // not in the spec's list; needed by duplicate hints (see roadmap, deviation 1)
  developers: string[];
  platforms: string[];
  totalRating: number | null; // IGDB total_rating, 0-100
  ratingCount: number; // IGDB rating_count (popularity), 0 when missing
  steamTags: SteamTag[] | null; // null = no Steam page / no tags
  ttb: TimeToBeat | null;
  versionParent: GameId | null;
  parentGame: GameId | null;
}

// ---- The event log (spec §5). One union member per event type. ----

export type EventBody =
  | { type: 'session_started'; gameId: GameId; data: { session: string; bucket: Bucket } }
  | { type: 'answer'; gameId: GameId; data: { session: string; pivot: GameId; result: AnswerResult } }
  | { type: 'undo'; gameId: GameId; data: { session: string } }
  | { type: 'session_cancelled'; gameId: GameId; data: { session: string } }
  | { type: 'placed'; gameId: GameId; data: { session: string; bucket: Bucket; below: GameId | null } }
  | { type: 'unranked'; gameId: GameId; data: Record<string, never> }
  | { type: 'merged'; gameId: GameId; data: { into: GameId } }
  | { type: 'unmerged'; gameId: GameId; data: { into: GameId } };

export type EventType = EventBody['type'];
export const EVENT_TYPES: readonly EventType[] = [
  'session_started', 'answer', 'undo', 'session_cancelled', 'placed', 'unranked', 'merged', 'unmerged',
];

/** An event as the client creates it: `id` is a client UUID, so retries are idempotent. */
export type NewEvent = EventBody & { id: string; ts: string; listId: string };
/** An event as stored: `seq` is the server's total order. */
export type RankEvent = NewEvent & { seq: number };

// ---- Library, sub-lists and the export file ----

export interface LibraryRow {
  gameId: GameId;
  status: Status;
  bucket: Bucket | null; // triage bucket while unranked; kept equal to the latest `placed` bucket
  platforms: string[];
  source: 'steam' | 'manual';
  steamPlaytimeMin: number | null;
  addedAt: string;
  updatedAt: string;
}

export interface SublistFilter {
  platform?: string;
  genre?: string;
  yearFrom?: number;
  yearTo?: number;
  status?: Status;
}

export interface Sublist {
  id: string;
  name: string;
  kind: 'filter' | 'set';
  filter: SublistFilter | null; // used when kind = 'filter'
  items: GameId[]; // used when kind = 'set'
  createdAt: string;
}

export interface ExternalId {
  source: string; // 'steam'
  uid: string; // e.g. Steam appid '1145360'
  gameId: GameId;
}

/** GET /api/export, the nightly backup, the Export button and `npm run eval` all use this shape. */
export interface ExportFile {
  version: 1;
  exportedAt: string;
  events: RankEvent[];
  library: LibraryRow[];
  games: GameMeta[];
  externalIds: ExternalId[];
  sublists: Sublist[];
}
