# versus Plan 3 — Catalog (IGDB/Steam normalization, canonical works, duplicates, search)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn raw IGDB and Steam JSON into `GameMeta`, collapse editions, remasters, ports and expanded games into their root work, flag look-alike library games for merging, and rerank typeahead search results. All of it is tested against real captured responses.

**Architecture:** Pure TypeScript in `src/core/catalog/`. `normalize.ts` is the **only** code that reads raw IGDB or Steam JSON, so an upstream schema change touches one file and its fixture tests. The Worker (Plan 4) does the network calls with the query strings defined here and hands the raw JSON to these functions.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.11, tsx 4.23.15 (fixture capture script).

**Spec:** `docs/specs/2026-10-06-versus-design.md` §8 (catalog and sync), §4 (interfaces), §11 (catalog tests), decisions D14–D17.
**Roadmap:** `docs/superpowers/plans/2026-10-06-versus-v1-roadmap.md`. This is Plan 3 of 6 and needs Plan 1 merged. It does not depend on Plan 2.

## Global Constraints

- Everything in `src/core/catalog/` obeys the boundary rule (no npm imports, no `fetch`, no DOM, no D1). The capture script lives in `scripts/` and may use `fetch`.
- Canonical rule exactly spec §8: follow `version_parent` (editions); follow `parent_game` only for game types 9 Remaster, 10 Expanded Game, 11 Port; never for 8 Remake or 4 Standalone Expansion; at most 5 steps.
- Search filter exactly spec §8: `where game_type = (0,4,8,9,10) & version_parent = null; limit 20`.
- Name-normalization suffix words exactly spec §8: legacy, enhanced, remastered, definitive, special, complete, goty, edition.
- **Fixtures hold public game data only.** Never put `GetOwnedGames` output, playtimes, a Steam id or API keys in `tests/fixtures/`, because the repo is public. `scripts/capture-fixtures.ts` redacts secrets from anything it prints.
- Commits end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Deviations from the spec (recorded in the roadmap)

1. **`GameMeta.franchises` added; duplicate hints match on collection *or* franchise.** ✅ Verified on the captured fixture: IGDB gives "Grand Theft Auto V Enhanced" (334647, Bundle) **no collection**, only the franchise "Grand Theft Auto". The spec rule (shared collection) would miss the exact case it was written for. `franchises` was already added to `GameMeta` in Plan 1.
2. **Skyrim's 2-step chain runs through `parent_game`, not `version_parent`.** ✅ Anniversary Edition (165192) is game type 10 "Expanded Game" with `parent_game` = Special Edition (19457), which is type 9 "Remaster" with `parent_game` = Skyrim (472). The spec's `canonicalWork` already handles this, so only the test wording differs from spec §11's "2-step chain".
3. **Search popularity weight = 1.5**, tuned on two captured queries ("hades", "outer wild"). ⚠️ Two queries is a thin basis. Add a fixture whenever real use finds a bad first result.

## Fixtures (already committed)

`tests/fixtures/igdb/*.json` and `tests/fixtures/steam/*.json` were captured on 2026-10-06 with `scripts/capture-fixtures.ts` (Task 1) and committed together with this plan. The tests assert exact values from them (e.g. Outer Wilds' top Steam tag weight 927), so **do not re-capture** unless IGDB or Steam changed shape; after a re-capture, update those assertions. Contents: 11 IGDB game records (BioShock 20, BioShock Remastered 34293, Skyrim 472, Skyrim SE 19457, Skyrim Anniversary 165192, Counter-Strike 241, CS: Source 307, GTA V 1020, GTA V Enhanced 334647, Outer Wilds 11737, Hades 113112), the searches "hades" and "outer wild", time-to-beat for Outer Wilds and Hades, the IGDB Steam mappings and Steam `GetItems` for 7 appids, and Steam's full tag list (446 tags).

## File Structure

| File | Responsibility |
|---|---|
| `src/core/catalog/igdb-query.ts` | APICalypse query strings (fields, filters), shared by the Worker and the capture script |
| `src/core/catalog/normalize.ts` | raw IGDB game / time-to-beat / Steam GetItems / GetTagList → GameMeta pieces |
| `src/core/catalog/canonical.ts` | `canonicalWork`, `parentIds`, `GAME_TYPE` |
| `src/core/catalog/duplicates.ts` | `normalizeName`, `duplicateHints` |
| `src/core/catalog/search.ts` | `rerankSearch` |
| `src/core/catalog/index.ts` | public surface |
| `scripts/capture-fixtures.ts` | `npm run capture-fixtures`: re-capture the real responses |
| `tests/core/catalog/fixtures.ts` | loads the captured JSON |
| `tests/core/catalog/*.test.ts` | one test file per source file |

---

### Task 1: IGDB query strings and the fixture capture script

**Files:**
- Create: `src/core/catalog/igdb-query.ts`, `src/core/catalog/index.ts`, `scripts/capture-fixtures.ts`
- Modify: `package.json` (script; also installs tsx if Plan 2 hasn't)
- Test: `tests/core/catalog/igdb-query.test.ts`

**Interfaces:**
- Consumes: nothing from earlier plans.
- Produces (from `src/core/catalog`): `GAME_FIELDS: string`, `SEARCH_FIELDS: string`, `searchQuery(text: string): string`, `gamesByIdQuery(ids: number[]): string`, `steamExternalQuery(appids: number[]): string`, `steamUidForGameQuery(gameId: number): string`, `timeToBeatQuery(ids: number[]): string`. Script: `npm run capture-fixtures [path-to-env-file]`.

- [ ] **Step 1: Create a branch**

```bash
git checkout main && git pull && git checkout -b p3-catalog
```

- [ ] **Step 2: Write the failing test**

`tests/core/catalog/igdb-query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gamesByIdQuery, searchQuery, steamExternalQuery } from '../../../src/core/catalog';

describe('IGDB query text', () => {
  it('filters to main games, expansions, remakes and remasters, and strips quotes', () => {
    const q = searchQuery('say "hi"\\');
    expect(q).toContain('search "say  hi"');
    expect(q).toContain('where game_type = (0,4,8,9,10) & version_parent = null');
  });

  it('builds id and Steam-mapping queries', () => {
    expect(gamesByIdQuery([20, 34293])).toMatch(/^fields name,.*; where id = \(20,34293\); limit 500;$/);
    expect(steamExternalQuery([7670, 409710])).toBe(
      'fields uid,game; where external_game_source = 1 & uid = ("7670","409710"); limit 500;',
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/core/catalog/igdb-query.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/core/catalog"`.

- [ ] **Step 4: Implement**

`src/core/catalog/igdb-query.ts`:

```ts
// IGDB query text (APICalypse). Pure strings, shared by the Worker (src/worker/igdb.ts) and the
// fixture capture script, so the test fixtures always have exactly the shape production fetches.

/** Fields for a full game record; normalizeIgdb() reads exactly these. */
export const GAME_FIELDS = [
  'name', 'first_release_date', 'game_type', 'cover.image_id',
  'genres.name', 'themes.name', 'keywords.name', 'game_modes.name', 'player_perspectives.name',
  'collections.name', 'franchises.name',
  'involved_companies.developer', 'involved_companies.company.name',
  'platforms.abbreviation', 'platforms.name',
  'total_rating', 'rating_count', 'version_parent', 'parent_game',
].join(',');

/** Fields for typeahead results: enough for a result row (cover, year) and the rerank. */
export const SEARCH_FIELDS = 'name,first_release_date,game_type,cover.image_id,rating_count,total_rating,version_parent,parent_game';

/** Main games, standalone expansions, remakes, remasters and expanded games; never editions (spec §8). */
export function searchQuery(text: string): string {
  const clean = text.replace(/["\\]/g, ' ').trim();
  return `search "${clean}"; fields ${SEARCH_FIELDS}; where game_type = (0,4,8,9,10) & version_parent = null; limit 20;`;
}

export function gamesByIdQuery(ids: number[]): string {
  return `fields ${GAME_FIELDS}; where id = (${ids.join(',')}); limit 500;`;
}

/** external_game_source 1 = Steam. uid is the Steam appid as a string. */
export function steamExternalQuery(appids: number[]): string {
  return `fields uid,game; where external_game_source = 1 & uid = (${appids.map((a) => `"${a}"`).join(',')}); limit 500;`;
}

export function steamUidForGameQuery(gameId: number): string {
  return `fields uid,game; where external_game_source = 1 & game = ${gameId}; limit 10;`;
}

export function timeToBeatQuery(ids: number[]): string {
  return `fields game_id,hastily,normally,completely,count; where game_id = (${ids.join(',')}); limit 500;`;
}
```

`src/core/catalog/index.ts` (Tasks 2–5 each add a line):

```ts
// Public surface of the catalog module. Other modules import from here, not from the files inside.
export * from './igdb-query';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/core/catalog/igdb-query.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the capture script**

If Plan 2 isn't merged yet, first run `npm install --save-exact -D tsx@4.23.15`. Then add `"capture-fixtures": "tsx scripts/capture-fixtures.ts"` to the `scripts` block of `package.json`.

`scripts/capture-fixtures.ts`:

```ts
// Re-capture the real IGDB/Steam responses used by the catalog tests (spec §11: "real fixtures").
//   npm run capture-fixtures            (reads credentials from ./.env)
// Writes tests/fixtures/igdb/*.json and tests/fixtures/steam/*.json. These hold PUBLIC game data
// only: no API keys, no Steam id, no playtimes. Never add GetOwnedGames output here (the repo is public).

import { mkdirSync, writeFileSync } from 'node:fs';
import { gamesByIdQuery, searchQuery, steamExternalQuery, timeToBeatQuery } from '../src/core/catalog/igdb-query';

const envFile = process.argv[2] ?? '.env';
process.loadEnvFile(envFile);
const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing from ${envFile}`);
  return v;
};

/** Hide every secret value in a message before printing it. */
function redact(text: string): string {
  let out = text;
  for (const k of ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'STEAM_API_KEY', 'STEAM_ID64']) {
    const v = process.env[k];
    if (v) out = out.split(v).join('***');
  }
  return out;
}

async function igdbToken(): Promise<string> {
  const q = new URLSearchParams({ client_id: env('TWITCH_CLIENT_ID'), client_secret: env('TWITCH_CLIENT_SECRET'), grant_type: 'client_credentials' });
  const r = await fetch(`https://id.twitch.tv/oauth2/token?${q}`, { method: 'POST' });
  if (!r.ok) throw new Error(`token: HTTP ${r.status}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

async function igdb(token: string, endpoint: string, body: string): Promise<unknown[]> {
  await new Promise((res) => setTimeout(res, 300)); // stay under 4 requests/second
  const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: { 'Client-ID': env('TWITCH_CLIENT_ID'), Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body,
  });
  if (!r.ok) throw new Error(redact(`IGDB ${endpoint}: HTTP ${r.status} ${await r.text()}`));
  return (await r.json()) as unknown[];
}

async function steam(path: string, params: Record<string, string>): Promise<unknown> {
  const q = new URLSearchParams({ ...params, key: env('STEAM_API_KEY') });
  const r = await fetch(`https://api.steampowered.com/${path}?${q}`);
  if (!r.ok) throw new Error(`Steam ${path}: HTTP ${r.status}`); // never print the URL: it has the key
  return r.json();
}

function save(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

// Games the catalog tests need (spec §11), by IGDB id:
//   20 BioShock · 34293 BioShock Remastered · 472 Skyrim · 19457 Skyrim Special Edition
//   241 Counter-Strike · 307 Counter-Strike: Source · 1020 GTA V · 334647 GTA V Enhanced (Bundle)
//   11737 Outer Wilds · 113112 Hades · 165192 Skyrim Anniversary Edition (Expanded Game → Special Edition)
const GAME_IDS = [20, 34293, 472, 19457, 165192, 241, 307, 1020, 334647, 11737, 113112];
const STEAM_APPIDS = [753640, 1145360, 7670, 409710, 489830, 271590, 3240220]; // Outer Wilds, Hades, BioShock, BioShock Remastered, Skyrim SE, GTA V Legacy, GTA V Enhanced

async function main(): Promise<void> {
  mkdirSync('tests/fixtures/igdb', { recursive: true });
  mkdirSync('tests/fixtures/steam', { recursive: true });
  const token = await igdbToken();

  save('tests/fixtures/igdb/games.json', await igdb(token, 'games', gamesByIdQuery(GAME_IDS)));
  save('tests/fixtures/igdb/search-hades.json', await igdb(token, 'games', searchQuery('hades')));
  save('tests/fixtures/igdb/search-outer-wild.json', await igdb(token, 'games', searchQuery('outer wild')));
  save('tests/fixtures/igdb/time-to-beat.json', await igdb(token, 'game_time_to_beats', timeToBeatQuery([11737, 113112])));
  save('tests/fixtures/igdb/external-steam.json', await igdb(token, 'external_games', steamExternalQuery(STEAM_APPIDS)));

  const items = await steam('IStoreBrowseService/GetItems/v1/', {
    input_json: JSON.stringify({
      ids: STEAM_APPIDS.map((appid) => ({ appid })),
      context: { language: 'english', country_code: 'US' },
      data_request: { include_tag_count: 20 },
    }),
  });
  save('tests/fixtures/steam/get-items.json', items);
  save('tests/fixtures/steam/tag-list.json', await steam('IStoreService/GetTagList/v1/', { language: 'english' }));
}

main().catch((e: unknown) => {
  console.error(redact(String(e)));
  process.exit(1);
});
```

- [ ] **Step 7: Typecheck (do NOT run the capture)**

Run: `npm run typecheck`
Expected: exits 0.

The fixtures were already captured with this exact script (see "Fixtures" above). Running it again would overwrite them and could break exact assertions. Only run `npm run capture-fixtures` when IGDB or Steam changes shape, then review `git diff tests/fixtures` and re-run the tests.

- [ ] **Step 8: Commit**

```bash
git add src/core/catalog/igdb-query.ts src/core/catalog/index.ts scripts/capture-fixtures.ts tests/core/catalog/igdb-query.test.ts package.json package-lock.json
git commit -m "feat(catalog): IGDB query strings and fixture capture script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Normalization (IGDB game, time-to-beat, Steam tags)

**Files:**
- Create: `src/core/catalog/normalize.ts`, `tests/core/catalog/fixtures.ts`
- Modify: `src/core/catalog/index.ts`
- Test: `tests/core/catalog/normalize.test.ts`

**Interfaces:**
- Consumes: `GameMeta`, `SteamTag`, `TimeToBeat` (Plan 1).
- Produces: `normalizeIgdb(raw: unknown, timeToBeat?: unknown): GameMeta` (throws `'IGDB game without an id'`), `normalizeTimeToBeat(raw: unknown): TimeToBeat | null`, `steamTagNames(raw: unknown): Map<number, string>` (from GetTagList), `steamItemsByAppid(raw: unknown): Map<number, unknown>` (from GetItems), `attachSteam(meta: GameMeta, item: unknown, tagNames: Map<number, string>): GameMeta`. Test helper: `fixture(path: string): unknown`, `igdbGames(): Map<number, unknown>`.

- [ ] **Step 1: Write the fixture loader**

`tests/core/catalog/fixtures.ts`:

```ts
// Loads the captured real IGDB/Steam responses (scripts/capture-fixtures.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '../../fixtures');

export function fixture(path: string): unknown {
  return JSON.parse(readFileSync(resolve(DIR, path), 'utf8'));
}

/** Raw IGDB game records by id. */
export function igdbGames(): Map<number, unknown> {
  const list = fixture('igdb/games.json') as { id: number }[];
  return new Map(list.map((g) => [g.id, g]));
}
```

- [ ] **Step 2: Write the failing test**

`tests/core/catalog/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { attachSteam, normalizeIgdb, steamItemsByAppid, steamTagNames } from '../../../src/core/catalog';
import { fixture, igdbGames } from './fixtures';

const raw = igdbGames();
const ttb = fixture('igdb/time-to-beat.json') as { game_id: number }[];

describe('normalizeIgdb (real Outer Wilds record)', () => {
  const meta = normalizeIgdb(raw.get(11737), ttb.find((t) => t.game_id === 11737));

  it('reads identity, year, type and cover', () => {
    expect(meta.id).toBe(11737);
    expect(meta.name).toBe('Outer Wilds');
    expect(meta.year).toBe(2019);
    expect(meta.gameType).toBe(0);
    expect(meta.coverImageId).toBe('co65ac');
  });

  it('reads the name lists', () => {
    expect(meta.genres).toEqual(['Puzzle', 'Simulator', 'Adventure', 'Indie']);
    expect(meta.modes).toEqual(['Single player']);
    expect(meta.perspectives).toEqual(['First person']);
    expect(meta.collections).toEqual(['Outer Wilds']);
    expect(meta.keywords.length).toBeGreaterThan(0);
  });

  it('keeps only developers (not publishers) and uses platform abbreviations', () => {
    expect(meta.developers).toEqual(['Mobius Digital']);
    expect(meta.platforms).toContain('PC');
    expect(meta.platforms).toContain('Switch');
  });

  it('reads ratings and time-to-beat', () => {
    expect(meta.totalRating).toBeCloseTo(87, 0);
    expect(meta.ttb).toEqual({ hastily: 43200, normally: 68400, completely: 115200, count: 7 });
    expect(meta.steamTags).toBeNull();
  });

  it('reads edition links (Skyrim Anniversary → Special Edition) and the Bundle type', () => {
    const anniversary = normalizeIgdb(raw.get(165192));
    expect(anniversary.gameType).toBe(10);
    expect(anniversary.parentGame).toBe(19457);
    expect(normalizeIgdb(raw.get(334647)).gameType).toBe(3);
  });
});

describe('normalizeIgdb (defensive)', () => {
  it('fills missing fields with empty values', () => {
    const meta = normalizeIgdb({ id: 5 });
    expect(meta.name).toBe('IGDB 5');
    expect(meta.year).toBeNull();
    expect(meta.genres).toEqual([]);
    expect(meta.ratingCount).toBe(0);
    expect(meta.ttb).toBeNull();
  });

  it('accepts game_type as a bare id', () => {
    expect(normalizeIgdb({ id: 5, game_type: 9 }).gameType).toBe(9);
  });

  it('refuses a record without an id', () => {
    expect(() => normalizeIgdb({ name: 'x' })).toThrow(/without an id/);
  });
});

describe('attachSteam (real GetItems + GetTagList)', () => {
  const names = steamTagNames(fixture('steam/tag-list.json'));
  const items = steamItemsByAppid(fixture('steam/get-items.json'));

  it('maps tag ids to names and keeps weights', () => {
    const meta = attachSteam(normalizeIgdb(raw.get(11737)), items.get(753640), names);
    expect(meta.steamTags).toHaveLength(20);
    expect(meta.steamTags![0]).toEqual({ tagId: 3834, name: 'Exploration', weight: 927 });
  });

  it('leaves steamTags null when the item has no tags', () => {
    expect(attachSteam(normalizeIgdb({ id: 1 }), { appid: 1 }, names).steamTags).toBeNull();
  });

  it('knows Steam\'s full tag list', () => {
    expect(names.size).toBeGreaterThan(400);
    expect(names.get(3959)).toBe('Roguelite');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/core/catalog/normalize.test.ts`
Expected: FAIL. `normalizeIgdb` is not a function.

- [ ] **Step 4: Implement**

`src/core/catalog/normalize.ts`:

```ts
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
```

`src/core/catalog/index.ts`:

```ts
// Public surface of the catalog module. Other modules import from here, not from the files inside.
export * from './igdb-query';
export * from './normalize';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/core/catalog/normalize.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/catalog/normalize.ts src/core/catalog/index.ts tests/core/catalog/fixtures.ts tests/core/catalog/normalize.test.ts
git commit -m "feat(catalog): normalize IGDB games, time-to-beat and Steam tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Canonical work

**Files:**
- Create: `src/core/catalog/canonical.ts`
- Modify: `src/core/catalog/index.ts`
- Test: `tests/core/catalog/canonical.test.ts`

**Interfaces:**
- Consumes: `normalizeIgdb` (Task 2), `igdbGames` (Task 2 helper); `GameId`, `GameMeta` (Plan 1).
- Produces: `GAME_TYPE` (`main: 0, bundle: 3, standaloneExpansion: 4, remake: 8, remaster: 9, expandedGame: 10, port: 11`), `canonicalWork(id: GameId, lookup: (id: GameId) => GameMeta | undefined): GameId`, `parentIds(g: GameMeta): GameId[]` (the Worker uses it to fetch ancestors before calling `canonicalWork`).

- [ ] **Step 1: Write the failing test**

`tests/core/catalog/canonical.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canonicalWork, normalizeIgdb, parentIds } from '../../../src/core/catalog';
import type { GameMeta } from '../../../src/core/types';
import { igdbGames } from './fixtures';

const metas = new Map<number, GameMeta>([...igdbGames().values()].map((r) => {
  const m = normalizeIgdb(r);
  return [m.id, m];
}));
const lookup = (id: number) => metas.get(id);

describe('canonicalWork (real IGDB links)', () => {
  it('BioShock Remastered → BioShock', () => {
    expect(canonicalWork(34293, lookup)).toBe(20);
  });

  it('Skyrim Anniversary → Special Edition → Skyrim (2-step chain)', () => {
    expect(canonicalWork(165192, lookup)).toBe(472);
  });

  it('Counter-Strike: Source is a remake and stays separate', () => {
    expect(canonicalWork(307, lookup)).toBe(307);
  });

  it('a main game is its own root; an unknown id is returned unchanged', () => {
    expect(canonicalWork(11737, lookup)).toBe(11737);
    expect(canonicalWork(999999, lookup)).toBe(999999);
  });

  it('GTA V Enhanced (Bundle, no parent link) stays separate: duplicate hints catch it instead', () => {
    expect(canonicalWork(334647, lookup)).toBe(334647);
  });

  it('stops after 5 steps even on a cycle', () => {
    const a = { ...metas.get(20)!, id: 1, versionParent: 2 };
    const b = { ...metas.get(20)!, id: 2, versionParent: 1 };
    const cyc = new Map([[1, a], [2, b]]);
    expect([1, 2]).toContain(canonicalWork(1, (id) => cyc.get(id)));
  });
});

describe('parentIds', () => {
  it('names the ancestor canonicalWork would visit next', () => {
    expect(parentIds(metas.get(165192)!)).toEqual([19457]);
    expect(parentIds(metas.get(307)!)).toEqual([]); // remake: not followed
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/catalog/canonical.test.ts`
Expected: FAIL. `canonicalWork` is not a function.

- [ ] **Step 3: Implement**

`src/core/catalog/canonical.ts`:

```ts
// Canonical work (spec §8, decision D15): editions, remasters, ports and expanded games collapse
// into the game they come from. Remakes (8) and standalone expansions (4) stay separate games.

import type { GameId, GameMeta } from '../types';

export const GAME_TYPE = {
  main: 0,
  bundle: 3,
  standaloneExpansion: 4,
  remake: 8,
  remaster: 9,
  expandedGame: 10,
  port: 11,
} as const;

const FOLLOW_PARENT: ReadonlySet<number> = new Set([GAME_TYPE.remaster, GAME_TYPE.expandedGame, GAME_TYPE.port]);

/**
 * Walk up the edition/remaster chain, at most 5 steps. `lookup` must already know the ancestors
 * (the Worker fetches them first); a missing ancestor ends the walk where it is.
 */
export function canonicalWork(id: GameId, lookup: (id: GameId) => GameMeta | undefined): GameId {
  let current = id;
  for (let steps = 0; steps < 5; steps++) {
    const g = lookup(current);
    if (!g) return current;
    if (g.versionParent !== null) current = g.versionParent; // editions
    else if (FOLLOW_PARENT.has(g.gameType) && g.parentGame !== null) current = g.parentGame;
    else return current;
  }
  return current;
}

/** Ids of the games canonicalWork() would visit next, so the Worker can fetch them before calling it. */
export function parentIds(g: GameMeta): GameId[] {
  if (g.versionParent !== null) return [g.versionParent];
  if (FOLLOW_PARENT.has(g.gameType) && g.parentGame !== null) return [g.parentGame];
  return [];
}
```

`src/core/catalog/index.ts`:

```ts
// Public surface of the catalog module. Other modules import from here, not from the files inside.
export * from './igdb-query';
export * from './normalize';
export * from './canonical';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/core/catalog/canonical.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/catalog/canonical.ts src/core/catalog/index.ts tests/core/catalog/canonical.test.ts
git commit -m "feat(catalog): collapse editions, remasters, ports and expanded games

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Duplicate hints

**Files:**
- Create: `src/core/catalog/duplicates.ts`
- Modify: `src/core/catalog/index.ts`
- Test: `tests/core/catalog/duplicates.test.ts`

**Interfaces:**
- Consumes: `normalizeIgdb` (Task 2); `GameId`, `GameMeta` (Plan 1).
- Produces: `normalizeName(name: string): string`, `duplicateHints(library: GameMeta[]): [GameId, GameId][]` (each pair is [smaller id, larger id], sorted).

- [ ] **Step 1: Write the failing test**

`tests/core/catalog/duplicates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { duplicateHints, normalizeIgdb, normalizeName } from '../../../src/core/catalog';
import { igdbGames } from './fixtures';

const raw = igdbGames();
const meta = (id: number) => normalizeIgdb(raw.get(id));

describe('normalizeName', () => {
  it('strips punctuation, case, accents and trailing edition words', () => {
    expect(normalizeName('The Elder Scrolls V: Skyrim - Special Edition')).toBe('the elder scrolls v skyrim');
    expect(normalizeName('Grand Theft Auto V Enhanced')).toBe('grand theft auto v');
    expect(normalizeName('Grand Theft Auto V Legacy')).toBe('grand theft auto v');
    expect(normalizeName('Pokémon Legends')).toBe('pokemon legends');
  });

  it('only strips trailing words, and never the whole name', () => {
    expect(normalizeName('Legacy of Kain')).toBe('legacy of kain');
    expect(normalizeName('Definitive')).toBe('definitive');
  });
});

describe('duplicateHints (real records)', () => {
  it('pairs GTA V with GTA V Enhanced (shared franchise, same normalized name)', () => {
    const library = [20, 241, 307, 472, 1020, 11737, 113112, 334647].map(meta);
    expect(duplicateHints(library)).toEqual([[1020, 334647]]);
  });

  it('does not pair Counter-Strike with Counter-Strike: Source', () => {
    expect(duplicateHints([meta(241), meta(307)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/catalog/duplicates.test.ts`
Expected: FAIL. `normalizeName` is not a function.

- [ ] **Step 3: Implement**

`src/core/catalog/duplicates.ts`:

```ts
// Duplicate hints (spec §8, D16): library games that look like the same work but that IGDB doesn't
// link, e.g. Steam's "GTA V Enhanced" maps to an IGDB Bundle with no parent. The UI shows a banner
// with a Merge button; nothing is merged automatically.

import type { GameId, GameMeta } from '../types';

const EDITION_WORDS: ReadonlySet<string> = new Set([
  'legacy', 'enhanced', 'remastered', 'definitive', 'special', 'complete', 'goty', 'edition',
]);

/** "The Elder Scrolls V: Skyrim - Special Edition" → "the elder scrolls v skyrim". */
export function normalizeName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);
  while (words.length > 1 && EDITION_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/**
 * Pairs [smaller id, larger id] that share an IGDB collection or franchise AND whose names match
 * after normalization. (The spec says "collection"; franchise is added because GTA V Enhanced has no
 * collection in IGDB, only the franchise. See the roadmap, deviation 1.)
 */
export function duplicateHints(library: GameMeta[]): [GameId, GameId][] {
  const groupsOf = (g: GameMeta) => new Set([...g.collections, ...g.franchises].map((x) => x.toLowerCase()));
  const out: [GameId, GameId][] = [];
  for (let i = 0; i < library.length; i++) {
    for (let j = i + 1; j < library.length; j++) {
      const a = library[i];
      const b = library[j];
      if (a.id === b.id) continue;
      const shared = [...groupsOf(a)].some((x) => groupsOf(b).has(x));
      const nameA = normalizeName(a.name);
      if (shared && nameA !== '' && nameA === normalizeName(b.name)) {
        out.push(a.id < b.id ? [a.id, b.id] : [b.id, a.id]);
      }
    }
  }
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
```

`src/core/catalog/index.ts`:

```ts
// Public surface of the catalog module. Other modules import from here, not from the files inside.
export * from './igdb-query';
export * from './normalize';
export * from './canonical';
export * from './duplicates';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/core/catalog/duplicates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/catalog/duplicates.ts src/core/catalog/index.ts tests/core/catalog/duplicates.test.ts
git commit -m "feat(catalog): duplicate hints on shared collection or franchise plus name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Search rerank

**Files:**
- Create: `src/core/catalog/search.ts`
- Modify: `src/core/catalog/index.ts`
- Test: `tests/core/catalog/search.test.ts`

**Interfaces:**
- Consumes: `normalizeIgdb` (Task 2), `fixture` (Task 2 helper); `GameMeta` (Plan 1).
- Produces: `POPULARITY_WEIGHT = 1.5`, `rerankSearch(hits: GameMeta[], query: string): GameMeta[]`. The query argument is unused for now; it's kept to match spec §4's signature.

- [ ] **Step 1: Write the failing test**

`tests/core/catalog/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeIgdb, rerankSearch } from '../../../src/core/catalog';
import { fixture } from './fixtures';

const hits = (path: string) => (fixture(path) as unknown[]).map((r) => normalizeIgdb(r));

describe('rerankSearch (real IGDB search results)', () => {
  it('"hades" → Supergiant\'s Hades first, Hades II above the obscure namesakes', () => {
    const results = hits('igdb/search-hades.json');
    expect(results[0].id).not.toBe(113112); // IGDB's own order is wrong here
    const ranked = rerankSearch(results, 'hades');
    expect(ranked[0].id).toBe(113112);
    expect(ranked.findIndex((g) => g.id === 228525)).toBeLessThan(ranked.findIndex((g) => g.id === 80529));
  });

  it('"outer wild" → Outer Wilds stays first', () => {
    expect(rerankSearch(hits('igdb/search-outer-wild.json'), 'outer wild')[0].id).toBe(11737);
  });

  it('keeps IGDB order between equally popular games', () => {
    const a = normalizeIgdb({ id: 1 });
    const b = normalizeIgdb({ id: 2 });
    expect(rerankSearch([a, b], 'x').map((g) => g.id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/catalog/search.test.ts`
Expected: FAIL. `rerankSearch` is not a function.

- [ ] **Step 3: Implement**

`src/core/catalog/search.ts`:

```ts
// Typeahead rerank (spec §8). IGDB's own relevance order is good at matching text but puts obscure
// namesakes first ("hades" → an unrated namesake before Supergiant's Hades). Blend the IGDB position with
// popularity (rating count, log scale).

import type { GameMeta } from '../types';

/**
 * Weight of popularity against IGDB position: one place in IGDB's list is worth a 10^(1/1.5) ≈ 4.6×
 * difference in rating count. Tuned on tests/fixtures/igdb/search-*.json (only 2 queries so far:
 * add a fixture whenever real use finds a bad result, then re-tune).
 */
export const POPULARITY_WEIGHT = 1.5;

export function rerankSearch(hits: GameMeta[], _query: string): GameMeta[] {
  return hits
    .map((g, index) => ({ g, index, score: -index + POPULARITY_WEIGHT * Math.log10(1 + g.ratingCount) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.g);
}
```

Final `src/core/catalog/index.ts`:

```ts
// Public surface of the catalog module. Other modules import from here, not from the files inside.
export * from './igdb-query';
export * from './normalize';
export * from './canonical';
export * from './duplicates';
export * from './search';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/core/catalog/search.test.ts`
Expected: PASS (3 tests). The test also records that IGDB's own order puts a different "Hades" (80529) first.

- [ ] **Step 5: Full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0. If Plan 2 is merged: `Test Files 15 passed`, `Tests 135 passed`. If not: `Test Files 10 passed`, `Tests 86 passed`.

- [ ] **Step 6: Commit and push**

```bash
git add src/core/catalog/search.ts src/core/catalog/index.ts tests/core/catalog/search.test.ts
git commit -m "feat(catalog): rerank typeahead results by IGDB order and popularity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin p3-catalog
gh run watch --exit-status
```

Expected: CI green. Merge per `superpowers:finishing-a-development-branch`.
