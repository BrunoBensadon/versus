// The ONLY place that reads raw IGDB and Steam JSON (spec §12: if their schemas drift, only this
// file and its fixture tests change). Everything else in the app works with GameMeta.

import type { GameMeta, SteamTag, TimeToBeat } from '../types';

type Json = Record<string, unknown>;

function obj(x: unknown): Json {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : {};
}

function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function str(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null;
}

/** IGDB returns a reference either as a bare id or, when expanded, as an object with an id. */
function idOf(x: unknown): number | null {
  return num(x) ?? num(obj(x).id);
}

/** [{name: 'RPG'}, {name: 'Indie'}] → ['RPG', 'Indie'], without duplicates. */
function names(x: unknown, key = 'name'): string[] {
  const out: string[] = [];
  for (const item of arr(x)) {
    const name = str(obj(item)[key]);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

export function normalizeTimeToBeat(raw: unknown): TimeToBeat | null {
  const t = obj(raw);
  const normally = num(t.normally);
  if (normally === null) return null;
  return { hastily: num(t.hastily) ?? 0, normally, completely: num(t.completely) ?? 0, count: num(t.count) ?? 0 };
}

/** One IGDB `games` record (fetched with GAME_FIELDS or SEARCH_FIELDS) → GameMeta. */
export function normalizeIgdb(raw: unknown, timeToBeat?: unknown): GameMeta {
  const g = obj(raw);
  const id = num(g.id);
  if (id === null) throw new Error('IGDB game without an id');
  const released = num(g.first_release_date);
  const platforms: string[] = [];
  for (const p of arr(g.platforms)) {
    const name = str(obj(p).abbreviation) ?? str(obj(p).name);
    if (name && !platforms.includes(name)) platforms.push(name);
  }
  const developers: string[] = [];
  for (const ic of arr(g.involved_companies)) {
    const c = obj(ic);
    const name = str(obj(c.company).name);
    if (c.developer === true && name && !developers.includes(name)) developers.push(name);
  }
  return {
    id,
    name: str(g.name) ?? `IGDB ${id}`,
    year: released === null ? null : new Date(released * 1000).getUTCFullYear(),
    gameType: idOf(g.game_type) ?? 0,
    coverImageId: str(obj(g.cover).image_id),
    genres: names(g.genres),
    themes: names(g.themes),
    keywords: names(g.keywords),
    modes: names(g.game_modes),
    perspectives: names(g.player_perspectives),
    collections: names(g.collections),
    franchises: names(g.franchises),
    developers,
    platforms,
    totalRating: num(g.total_rating),
    ratingCount: num(g.rating_count) ?? 0,
    steamTags: null,
    ttb: timeToBeat === undefined ? null : normalizeTimeToBeat(timeToBeat),
    versionParent: idOf(g.version_parent),
    parentGame: idOf(g.parent_game),
  };
}

/** IStoreService/GetTagList response → tag id → name. */
export function steamTagNames(raw: unknown): Map<number, string> {
  const out = new Map<number, string>();
  for (const t of arr(obj(obj(raw).response).tags)) {
    const id = num(obj(t).tagid);
    const name = str(obj(t).name);
    if (id !== null && name) out.set(id, name);
  }
  return out;
}

/** IStoreBrowseService/GetItems response → appid → store item. */
export function steamItemsByAppid(raw: unknown): Map<number, unknown> {
  const out = new Map<number, unknown>();
  for (const item of arr(obj(obj(raw).response).store_items)) {
    const appid = num(obj(item).appid) ?? num(obj(item).id);
    if (appid !== null) out.set(appid, item);
  }
  return out;
}

/** Add one Steam store item's user tags to a game. No tags → steamTags stays null. */
export function attachSteam(meta: GameMeta, item: unknown, tagNames: Map<number, string>): GameMeta {
  const tags: SteamTag[] = [];
  for (const t of arr(obj(item).tags)) {
    const tagId = num(obj(t).tagid);
    const weight = num(obj(t).weight);
    if (tagId !== null && weight !== null) tags.push({ tagId, name: tagNames.get(tagId) ?? `Tag ${tagId}`, weight });
  }
  return { ...meta, steamTags: tags.length > 0 ? tags : null };
}
