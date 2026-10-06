# versus Plan 5 — The PWA (screens, install, end-to-end test)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The installable phone-first web app. It has login, Steam import, triage, the ranking flow (questions, undo, confirm, resume), the ranked list with filters and sub-lists, search, the game page with prediction and reasons, backlog pick, and export. A Playwright test drives the whole journey on a Pixel 7 viewport.

**Architecture:** React 19 + Vite 8 in `src/web/`, built into `dist/web` and served by the Worker as static assets. One `StoreProvider` holds the event log, library, metadata and sub-lists; the ranked order is always `replay(events)` from the core. Every action posts to the API first and then merges what the server stored (online-only, spec D21). Hash routes (`#/game/123`) need no server routing. Logic worth testing lives in `src/web/derive.ts`, which is pure and unit-tested in Node. The screens are covered by the end-to-end journey.

**Tech Stack:** React 19.3.0, Vite 8.3.3, `@vitejs/plugin-react` 6.1.2, Playwright 1.63.0 (Chromium, Pixel 7 profile), plus Plans 1–4.

**Spec:** `docs/specs/2026-10-06-versus-design.md` §6 (ranking flow, triage, sub-lists), §7.3 (prediction UI, backlog pick), §8 (search, refresh), §10 (export, backup age), §11 (e2e row), decisions D1, D8, D21.
**Roadmap:** `docs/superpowers/plans/2026-10-06-versus-v1-roadmap.md`. This is Plan 5 of 6 and needs Plans 1–4 merged.

## Global Constraints

- `src/web/` may import `src/core/`; it never imports `src/worker/`. All server access goes through `src/web/api.ts`.
- Phone first: tap targets ≥ 44 px, works at 360 px wide, bottom navigation. Dark/light mode follows the system.
- Online-required ranking in v1 (spec D21): no offline outbox. The service worker never caches `/api/*`.
- Scores are shown with one decimal; the ranked list carries the one-line "scores shift as you rank more games" note (R-RANK-4).
- Predictions: below 5 ranked games the UI says so instead of showing a score; the confidence label is always shown; in kNN mode (`SCORER = 'knn'`) the reasons list is simply empty.
- Attribution footer on every screen: "Game data: IGDB.com · Steam data via the Steam Web API" plus a Privacy page (spec §8, R-DATA-7).
- End-to-end tests never touch the real APIs: `wrangler dev --env-file tests/e2e/e2e.env` points the Worker at a fake upstream on :8788 and uses fake secrets. ✅ Verified 2026-10-06: `--env-file` (and `--var`) override a local `.dev.vars`, so Bruno's real secrets play no part.
- Commits end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Deviations / additions (recorded in the roadmap)

1. **Duplicate hints have a "Not the same" button.** Dismissals are stored in the browser's `localStorage` only (single user; worst case a hint comes back). Merging also sets the merged-away game's status to `ignored`, so it leaves the queues; **Unmerge** on the survivor's page puts it back into the inbox.
2. **"Rank 10"** is a `#/queue?left=10` run over played/dropped games that have a triage bucket but no place, highest playtime first. Each game shows a "Rank it" button rather than starting automatically.
3. The sub-list UI is deliberately plain: a filter row with "Save as sub-list", plus "+ list" for a hand-picked set (games are added from their page).
4. The app icon is a generated placeholder (two offset bars); replace `scripts/make-icons.ts` output whenever there's a real design.

## File Structure

| File | Responsibility |
|---|---|
| `vite.config.ts` | builds `src/web` → `dist/web`; dev server proxies `/api` to `wrangler dev` |
| `src/web/index.html`, `main.tsx`, `vite-env.d.ts`, `styles.css` | entry point, service-worker registration, styles |
| `src/web/api.ts` | typed `fetch` calls to every Worker route |
| `src/web/router.ts` | hash routes: `parseHash`, `useRoute`, `navigate` |
| `src/web/store.tsx` | `StoreProvider` / `useStore`: data, derived ranking, actions |
| `src/web/derive.ts` | pure helpers: event merge, queues, filters, CSV, labels |
| `src/web/components.tsx` | cover, game row, score badge, prediction card, footer |
| `src/web/App.tsx` | login gate, route switch, bottom nav |
| `src/web/screens/*.tsx` | `Static` (login, privacy), `Home`, `Rank` (bucket choice, questions, confirm, queue), `Triage`, `Ranked`, `Library`, `Search`, `Game`, `Pick`, `Settings` |
| `src/web/public/` | `manifest.webmanifest`, `sw.js`, `icons/*.png` |
| `scripts/make-icons.ts` | generates the PNG icons with no image library |
| `tests/web/derive.test.ts` | unit tests for `derive.ts` |
| `tests/e2e/*` | fake-upstream HTTP server, fake env, the journey spec |
| `playwright.config.ts` | Pixel 7 Chromium against `wrangler dev` + fake upstream |

---

### Task 1: Pure web helpers

**Files:**
- Modify: `tsconfig.json`, `vitest.config.ts`
- Create: `src/web/derive.ts`
- Test: `tests/web/derive.test.ts`

**Interfaces:**
- Consumes: `replay`, `scores`, `globalOrder`, `positionOf`, `formatScore`, `RankState` (Plan 1); core types; test helpers `game` (Plan 2) and `Log` (Plan 1).
- Produces (`src/web/derive.ts`): `makeEvent(body, now, id): NewEvent`, `mergeEvents(current, incoming): RankEvent[]`, `withPlacedBuckets(rows, events): LibraryRow[]`, `inboxQueue(rows, state)`, `unrankedQueue(rows, state)`, `matchesFilter(meta, row, filter): boolean`, `ttbLabel(ttb): string | null`, `isStale(fetchedAt, now): boolean`, `backupAgeDays(lastBackupAt, now): number | null`, `rankedListCsv(state, scoreMap, games, rows): string`, `coverUrl(imageId, size?): string | null`.

- [ ] **Step 1: Create a branch and extend the configs**

```bash
git checkout main && git pull && git checkout -b p5-pwa
```

`tsconfig.json` (adds the DOM and JSX, plus the web, e2e and config files):

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["src/core", "src/web", "tests/core", "tests/web", "tests/e2e", "tests/fixtures", "tests/boundary.test.ts", "scripts", "vite.config.ts", "playwright.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// Unit tests for the pure core (ranking, recommender, catalog) and the web app's pure helpers.
// They run in plain Node.
export default defineConfig({
  test: {
    include: ['tests/core/**/*.test.ts', 'tests/web/**/*.test.ts', 'tests/boundary.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: Write the failing test**

`tests/web/derive.test.ts`:

```ts
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
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/web/derive.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/web/derive"`.

- [ ] **Step 4: Implement**

`src/web/derive.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run tests/web/derive.test.ts`
Expected: PASS (11 tests).

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json vitest.config.ts src/web/derive.ts tests/web/derive.test.ts
git commit -m "feat(web): pure helpers for queues, filters, CSV and labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: App shell, data store, login and home

**Files:**
- Modify: `package.json` (dependencies, scripts)
- Create: `vite.config.ts`, `src/web/index.html`, `src/web/vite-env.d.ts`, `src/web/main.tsx`, `src/web/styles.css`, `src/web/api.ts`, `src/web/router.ts`, `src/web/store.tsx`, `src/web/components.tsx`, `src/web/screens/Static.tsx`, `src/web/screens/Home.tsx`, `src/web/App.tsx`

**Interfaces:**
- Consumes: Task 1; every Worker route from Plan 4; `recommend`, `Prediction` (Plan 2).
- Produces:
  - `api` (methods `login`, `logout`, `events`, `postEvents`, `library`, `putLibrary`, `search`, `fetchGame`, `importSteam`, `status`, `sublists`, `putSublist`, `deleteSublist`), `ApiError`, `LibraryResponse`, `ImportSummary`
  - `parseHash(hash): { parts: string[]; query: URLSearchParams }`, `useRoute()`, `navigate(path, replace?)`
  - `useStore(): Store`, where `Store` = `{ events, rows, games: Map<GameId, GameMeta>, fetchedAt, sublists, state: RankState, scoreMap, rowOf, append(bodies), patchLibrary(id, patch), fetchGame(id): Promise<rootId>, reload(), saveSublist(s), removeSublist(id) }`; `StoreProvider({ children, onUnauthorized })`
  - components: `BUCKET_LABEL`, `Cover`, `gameName`, `GameRow`, `ScoreBadge`, `DroppedMarker`, `PredictionCard`, `TimeToBeat`, `Footer`
  - screens: `LoginScreen`, `PrivacyScreen`, `HomeScreen`; `App`
  - scripts: `npm run build`, `npm run dev:web`, `npm run dev`

- [ ] **Step 1: Install React and Vite**

```bash
npm install --save-exact react@19.3.0 react-dom@19.3.0
npm install --save-exact -D vite@8.3.3 @vitejs/plugin-react@6.1.2 @types/react@19.3.0 @types/react-dom@19.3.0
```

Add to the `scripts` block of `package.json`:

```json
    "build": "vite build",
    "dev:web": "vite",
    "dev": "vite build && wrangler dev --ip 127.0.0.1 --port 8787",
```

- [ ] **Step 2: Build config and entry files**

`vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The PWA (src/web) builds to dist/web, which the Worker serves as static assets (wrangler.jsonc).
// `npm run dev:web` serves it with hot reload and forwards /api to `npm run dev:worker` on :8787.
export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
```

`src/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#16181d" />
    <meta name="description" content="Rank the games you've played; predict the ones you haven't." />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icons/icon-192.png" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <title>versus</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/web/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
// Lets TypeScript understand Vite features: import.meta.env and CSS imports.
```

`src/web/main.tsx`:

```tsx
// Entry point: mount React and register the service worker (it makes the app installable).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch((e: unknown) => console.warn('service worker not registered', e));
}
```

`src/web/styles.css`:

```css
/* versus: one small stylesheet. Phone first; dark and light follow the system setting. */

:root {
  --bg: #f6f6f4;
  --surface: #ffffff;
  --text: #16181d;
  --muted: #5d6270;
  --line: #e1e2e6;
  --accent: #c2410c;
  --loved: #15803d;
  --liked: #a16207;
  --disliked: #b91c1c;
  --radius: 12px;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181d;
    --surface: #1f2229;
    --text: #eceef2;
    --muted: #a0a5b1;
    --line: #2e323b;
    --accent: #fb923c;
    --loved: #4ade80;
    --liked: #facc15;
    --disliked: #f87171;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

a { color: var(--accent); text-decoration: none; }
h1, h2, h3, h4 { line-height: 1.2; margin: 0.6em 0 0.4em; }
h4 { font-size: 0.95rem; color: var(--muted); }

.app { max-width: 640px; margin: 0 auto; padding: 12px 16px 88px; }
.muted { color: var(--muted); }
.small { font-size: 0.85rem; }
.error { color: var(--disliked); }

button, .button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; padding: 8px 14px;
  border: 1px solid var(--line); border-radius: var(--radius);
  background: var(--surface); color: var(--text); font: inherit; cursor: pointer;
}
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.link { border: none; background: none; color: var(--accent); min-height: 0; padding: 4px 0; }
.button.wide { width: 100%; margin: 4px 0; }

input, select {
  min-height: 44px; padding: 8px 10px; font: inherit;
  border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); color: var(--text);
}
input.search { width: 100%; font-size: 1.1rem; margin: 8px 0 12px; }

.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; margin: 12px 0; }
.banner { border-color: var(--accent); }
.row-buttons { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
.choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0; }
button.big { min-height: 64px; font-weight: 600; }
button.loved { border-color: var(--loved); }
button.liked { border-color: var(--liked); }
button.disliked { border-color: var(--disliked); }
button.suggested { box-shadow: 0 0 0 2px var(--accent) inset; }
.check { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.check input { min-height: 0; width: 20px; height: 20px; }

.hero { text-align: center; }
.hero h2 { margin-top: 8px; }

.cover { width: 45px; height: 64px; border-radius: 6px; object-fit: cover; background: var(--line); flex: none; }
.cover.big { width: 132px; height: 187px; }
.cover.blank { display: inline-block; }

.game-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 4px; border-bottom: 1px solid var(--line); color: var(--text);
}
.game-row-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.game-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.game-row-right { display: flex; align-items: center; gap: 8px; }

.score { font-weight: 700; font-variant-numeric: tabular-nums; }
.score.loved { color: var(--loved); }
.score.liked { color: var(--liked); }
.score.disliked { color: var(--disliked); }
h3.loved { color: var(--loved); }
h3.liked { color: var(--liked); }
h3.disliked { color: var(--disliked); }
.tag { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.confidence.low { color: var(--disliked); }
.plus { color: var(--loved); }
.minus { color: var(--disliked); }
.reasons, .similar { margin: 4px 0; padding-left: 18px; }
.pick-why { margin: 0 0 6px 61px; }

.versus { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; }
button.pick { flex-direction: column; padding: 10px; min-height: 240px; }
.vs { color: var(--muted); font-weight: 700; }

.tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin: 8px 0; }
.tab { white-space: nowrap; min-height: 36px; padding: 4px 12px; border-radius: 999px; }
.tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
a.tab { display: inline-flex; align-items: center; border: 1px solid var(--line); }

.filters summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; }
.filter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }

.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 12px 0; }
.tile { display: flex; flex-direction: column; gap: 4px; padding: 14px; min-height: 92px; color: var(--text);
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }

.bottom-nav {
  position: fixed; left: 0; right: 0; bottom: 0;
  display: flex; justify-content: space-around;
  padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
  background: var(--surface); border-top: 1px solid var(--line);
}
.bottom-nav a { padding: 8px 10px; min-height: 44px; display: flex; align-items: center; }

.footer { margin: 24px 0 8px; text-align: center; }
.login { display: flex; flex-direction: column; gap: 12px; max-width: 320px; margin: 15vh auto 0; }
.prose p { max-width: 60ch; }
```

- [ ] **Step 3: API client, router and store**

`src/web/api.ts`:

```ts
// Typed calls to the Worker API (spec §4). Same origin, so the session cookie goes along automatically.

import type { GameMeta, LibraryRow, NewEvent, RankEvent, Status, Bucket, Sublist } from '../core/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface LibraryResponse {
  rows: LibraryRow[];
  games: GameMeta[];
  fetchedAt: Record<number, string>;
}

export interface ImportSummary {
  owned: number;
  mapped: number;
  added: number;
  updated: number;
  unmapped: { appid: number; name: string }[];
}

export const api = {
  login: (passphrase: string) => request<{ ok: true }>('POST', '/api/login', { passphrase }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  events: (since = 0) => request<{ events: RankEvent[] }>('GET', `/api/events?since=${since}`),
  postEvents: (events: NewEvent[]) => request<{ events: RankEvent[] }>('POST', '/api/events', { events }),
  library: () => request<LibraryResponse>('GET', '/api/library'),
  putLibrary: (id: number, patch: { status?: Status; bucket?: Bucket | null; platforms?: string[] }) =>
    request<{ row: LibraryRow }>('PUT', `/api/library/${id}`, patch),
  search: (q: string) => request<{ results: GameMeta[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  fetchGame: (id: number) => request<{ requestedId: number; rootId: number; meta: GameMeta }>('POST', `/api/games/${id}`),
  importSteam: () => request<ImportSummary>('POST', '/api/import/steam'),
  status: () => request<{ lastBackupAt: string | null; eventCount: number }>('GET', '/api/status'),
  sublists: () => request<{ sublists: Sublist[] }>('GET', '/api/sublists'),
  putSublist: (s: Sublist) => request<{ sublist: Sublist }>('PUT', `/api/sublists/${encodeURIComponent(s.id)}`, s),
  deleteSublist: (id: string) => request<{ ok: true }>('DELETE', `/api/sublists/${encodeURIComponent(id)}`),
};
```

`src/web/router.ts`:

```ts
// Hash routes (#/game/123?x=1): no server routing needed, and every path loads the same index.html.

import { useEffect, useState } from 'react';

export interface Route {
  parts: string[]; // '#/game/123' → ['game', '123']
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const [path, qs = ''] = hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter((p) => p.length > 0), query: new URLSearchParams(qs) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Go to a route, e.g. navigate('/game/123'). `replace` avoids a Back-button entry. */
export function navigate(path: string, replace = false): void {
  const hash = `#${path}`;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}
```

`src/web/store.tsx`:

```tsx
// The app's data in one place: the event log, library, game metadata and sub-lists, plus what's
// derived from them (the ranked order and scores). The order is always replay(events): spec §6.2.
// Ranking is online-only in v1 (spec D21): every action is posted at once, then merged locally.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { replay, scores, type RankState } from '../core/ranking';
import type { Bucket, EventBody, GameId, GameMeta, LibraryRow, RankEvent, Status, Sublist } from '../core/types';
import { api, ApiError } from './api';
import { makeEvent, mergeEvents, withPlacedBuckets } from './derive';

interface Data {
  events: RankEvent[];
  rows: LibraryRow[];
  games: Map<GameId, GameMeta>;
  fetchedAt: Record<number, string>;
  sublists: Sublist[];
}

export interface Store extends Data {
  state: RankState;
  scoreMap: Map<GameId, number>;
  rowOf: Map<GameId, LibraryRow>;
  /** Post events (each gets a fresh UUID) and merge the stored versions into the log. */
  append: (bodies: EventBody[]) => Promise<void>;
  patchLibrary: (id: GameId, patch: { status?: Status; bucket?: Bucket | null; platforms?: string[] }) => Promise<void>;
  /** Fetch or refresh one game's metadata; returns its canonical (root) id. */
  fetchGame: (id: GameId) => Promise<GameId>;
  reload: () => Promise<void>;
  saveSublist: (s: Sublist) => Promise<void>;
  removeSublist: (id: string) => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside <StoreProvider>');
  return store;
}

const EMPTY: Data = { events: [], rows: [], games: new Map(), fetchedAt: {}, sublists: [] };

export function StoreProvider({ children, onUnauthorized }: { children: ReactNode; onUnauthorized: () => void }) {
  const [data, setData] = useState<Data>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onUnauthorized();
        throw e;
      }
    },
    [onUnauthorized],
  );

  const reload = useCallback(async () => {
    await guard(async () => {
      const [ev, lib, sub] = await Promise.all([api.events(0), api.library(), api.sublists()]);
      setData({
        events: ev.events,
        rows: lib.rows,
        games: new Map(lib.games.map((g) => [g.id, g])),
        fetchedAt: lib.fetchedAt,
        sublists: sub.sublists,
      });
      setLoaded(true);
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [guard]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Another device may have ranked something: pick up new events when the app comes back into view.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const last = data.events.at(-1)?.seq ?? 0;
      api.events(last)
        .then(({ events }) => {
          if (events.length > 0) setData((d) => ({ ...d, events: mergeEvents(d.events, events), rows: withPlacedBuckets(d.rows, events) }));
        })
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [data.events]);

  const append = useCallback(
    async (bodies: EventBody[]) => {
      const now = new Date();
      const stored = await guard(() => api.postEvents(bodies.map((b) => makeEvent(b, now, crypto.randomUUID()))));
      setData((d) => ({ ...d, events: mergeEvents(d.events, stored.events), rows: withPlacedBuckets(d.rows, stored.events) }));
    },
    [guard],
  );

  const patchLibrary = useCallback<Store['patchLibrary']>(
    async (id, patch) => {
      const { row } = await guard(() => api.putLibrary(id, patch));
      setData((d) => ({ ...d, rows: [...d.rows.filter((r) => r.gameId !== id), row] }));
    },
    [guard],
  );

  const fetchGame = useCallback(
    async (id: GameId) => {
      const res = await guard(() => api.fetchGame(id));
      setData((d) => {
        const games = new Map(d.games);
        games.set(res.rootId, res.meta);
        return { ...d, games, fetchedAt: { ...d.fetchedAt, [res.rootId]: new Date().toISOString() } };
      });
      return res.rootId;
    },
    [guard],
  );

  const saveSublist = useCallback(
    async (s: Sublist) => {
      const { sublist } = await guard(() => api.putSublist(s));
      setData((d) => ({ ...d, sublists: [...d.sublists.filter((x) => x.id !== s.id), sublist] }));
    },
    [guard],
  );

  const removeSublist = useCallback(
    async (id: string) => {
      await guard(() => api.deleteSublist(id));
      setData((d) => ({ ...d, sublists: d.sublists.filter((x) => x.id !== id) }));
    },
    [guard],
  );

  const state = useMemo(() => replay(data.events), [data.events]);
  const scoreMap = useMemo(() => scores(state), [state]);
  const rowOf = useMemo(() => new Map(data.rows.map((r) => [r.gameId, r])), [data.rows]);

  if (error) return <p className="error">Could not load your data: {error}</p>;
  if (!loaded) return <p className="muted">Loading…</p>;

  const store: Store = { ...data, state, scoreMap, rowOf, append, patchLibrary, fetchGame, reload, saveSublist, removeSublist };
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
```

- [ ] **Step 4: Components, login/privacy, home, and the app shell**

`src/web/components.tsx`:

```tsx
// Small building blocks shared by the screens.

import type { ReactNode } from 'react';
import { formatScore, positionOf, type RankState } from '../core/ranking';
import type { Prediction } from '../core/recommender';
import type { Bucket, GameId, GameMeta, LibraryRow } from '../core/types';
import { coverUrl, ttbLabel } from './derive';

export const BUCKET_LABEL: Record<Bucket, string> = { loved: 'Loved', liked: 'Liked', disliked: "Didn't like" };

export function Cover({ meta, big = false }: { meta: GameMeta | undefined; big?: boolean }) {
  const url = coverUrl(meta?.coverImageId ?? null, big ? 't_cover_big' : 't_cover_small');
  return url ? <img className={big ? 'cover big' : 'cover'} src={url} alt="" loading="lazy" /> : <div className={big ? 'cover big blank' : 'cover blank'} />;
}

export function gameName(games: Map<GameId, GameMeta>, id: GameId): string {
  return games.get(id)?.name ?? `IGDB ${id}`;
}

/** One tappable row: cover, name, year, and whatever the screen puts on the right. */
export function GameRow({ meta, id, right, sub }: { meta: GameMeta | undefined; id: GameId; right?: ReactNode; sub?: ReactNode }) {
  return (
    <a className="game-row" href={`#/game/${id}`}>
      <Cover meta={meta} />
      <span className="game-row-text">
        <span className="game-name">{meta?.name ?? `IGDB ${id}`}</span>
        <span className="muted small">
          {meta?.year ?? ''}
          {sub ? <> · {sub}</> : null}
        </span>
      </span>
      {right ? <span className="game-row-right">{right}</span> : null}
    </a>
  );
}

export function ScoreBadge({ score, bucket }: { score: number; bucket: Bucket }) {
  return <span className={`score ${bucket}`}>{formatScore(score)}</span>;
}

export function DroppedMarker({ row }: { row: LibraryRow | undefined }) {
  return row?.status === 'dropped' ? <span className="tag">dropped</span> : null;
}

const CONFIDENCE_TEXT = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

/** Predicted score + why (spec §7.3). */
export function PredictionCard({
  prediction, games, state,
}: { prediction: Prediction; games: Map<GameId, GameMeta>; state: RankState }) {
  if (prediction.score === null) {
    return <p className="muted">Rank at least 5 games to see predictions.</p>;
  }
  return (
    <div className="card prediction" data-testid="prediction">
      <p>
        Predicted <ScoreBadge score={prediction.score} bucket={prediction.bucket!} /> · {BUCKET_LABEL[prediction.bucket!]} ·{' '}
        <span className={`confidence ${prediction.confidence}`}>{CONFIDENCE_TEXT[prediction.confidence]}</span>
      </p>
      {prediction.above || prediction.below ? (
        <p className="muted small">
          Between {prediction.above ? `${gameName(games, prediction.above.id)} ${formatScore(prediction.above.score)}` : 'the top'} and{' '}
          {prediction.below ? `${gameName(games, prediction.below.id)} ${formatScore(prediction.below.score)}` : 'the bottom'}
        </p>
      ) : null}
      {prediction.reasons.length > 0 ? (
        <>
          <h4>Why</h4>
          <ul className="reasons" data-testid="reasons">
            {prediction.reasons.map((r) => (
              <li key={r.label}>
                {r.label} <span className={r.value >= 0 ? 'plus' : 'minus'}>{r.value >= 0 ? '+' : '−'}{Math.abs(r.value).toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {prediction.similar.length > 0 ? (
        <>
          <h4>Most similar ranked games</h4>
          <ul className="similar">
            {prediction.similar.map((s) => (
              <li key={s.id}>
                <a href={`#/game/${s.id}`}>{gameName(games, s.id)}</a> · #{s.position} · <ScoreBadge score={s.score} bucket={positionOf(state, s.id)?.bucket ?? s.bucket} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function TimeToBeat({ meta }: { meta: GameMeta | undefined }) {
  const label = ttbLabel(meta?.ttb ?? null);
  return label ? <span>{label}</span> : null;
}

export function Footer() {
  return (
    <footer className="footer muted small">
      Game data: <a href="https://www.igdb.com">IGDB.com</a> · Steam data via the Steam Web API ·{' '}
      <a href="#/privacy">Privacy</a>
    </footer>
  );
}
```

`src/web/screens/Static.tsx`:

```tsx
// Screens without data: login and the privacy statement (Steam's terms ask for one, spec §8).

import { useState } from 'react';
import { api, ApiError } from '../api';

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="login"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.login(passphrase);
          onLogin();
        } catch (err) {
          setError(err instanceof ApiError && err.status === 401 ? 'Wrong passphrase.' : err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>versus</h1>
      <input type="password" autoComplete="current-password" placeholder="Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} aria-label="Passphrase" />
      <button className="primary" disabled={busy || passphrase.length === 0}>Log in</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

export function PrivacyScreen() {
  return (
    <section className="prose">
      <h2>Privacy</h2>
      <p>versus is a personal, single-user app. It is not offered to anyone else.</p>
      <p>
        It reads the owner's Steam library (owned games and playtime) through the Steam Web API, and game metadata from
        IGDB. That data, the owner's rankings and library are stored in the owner's Cloudflare D1 database and in a
        private GitHub backup repository. Nothing is shared, sold or sent anywhere else.
      </p>
      <p>Game data: IGDB.com. Steam data via the Steam Web API. Not affiliated with Valve or IGDB.</p>
    </section>
  );
}
```

`src/web/screens/Home.tsx`:

```tsx
// Home: resume open ranking sessions, and the two queues (triage, unranked).

import { gameName } from '../components';
import { inboxQueue, unrankedQueue } from '../derive';
import { useStore } from '../store';

export function HomeScreen() {
  const store = useStore();
  const open = [...store.state.openSessions.values()];
  const inbox = inboxQueue(store.rows, store.state).length;
  const unranked = unrankedQueue(store.rows, store.state).length;
  const ranked = store.scoreMap.size;

  return (
    <section>
      <h1>versus</h1>
      {open.length > 0 ? (
        <div className="card">
          <h3>Pick up where you left off</h3>
          {open.map((s) => (
            <a key={s.id} className="button wide" href={`#/rank/${s.id}`}>
              Continue ranking {gameName(store.games, s.game)}
            </a>
          ))}
        </div>
      ) : null}
      <div className="tiles">
        <a className="tile" href="#/search">
          <strong>Rank a game</strong>
          <span className="muted small">Search, then a few questions</span>
        </a>
        <a className="tile" href="#/triage">
          <strong>Triage</strong>
          <span className="muted small" data-testid="inbox-count">{inbox} imported, not sorted</span>
        </a>
        <a className="tile" href="#/queue?left=10">
          <strong>Rank 10</strong>
          <span className="muted small">{unranked} played, not yet ranked</span>
        </a>
        <a className="tile" href="#/pick">
          <strong>What to play next</strong>
          <span className="muted small">Backlog, by predicted score</span>
        </a>
        <a className="tile" href="#/ranked">
          <strong>My ranking</strong>
          <span className="muted small">{ranked} ranked</span>
        </a>
        <a className="tile" href="#/library">
          <strong>Library</strong>
          <span className="muted small">{store.rows.length} games</span>
        </a>
      </div>
    </section>
  );
}
```

`src/web/App.tsx` (Tasks 3 and 4 add screens; until then, other routes show Home):

```tsx
// The app shell: login gate, bottom navigation, and the hash-route switch.

import { useState } from 'react';
import { Footer } from './components';
import { useRoute } from './router';
import { HomeScreen } from './screens/Home';
import { LoginScreen, PrivacyScreen } from './screens/Static';
import { StoreProvider } from './store';

function Screen({ onLogout }: { onLogout: () => void }) {
  const { parts, query } = useRoute();
  const [first, second, third] = parts;
  const id = (raw: string | undefined) => Number(raw);

  if (first === 'privacy') return <PrivacyScreen />;
  return <HomeScreen />;
}

export function App() {
  const route = useRoute();
  // Assume a session exists; the first API call that answers 401 flips this to false.
  const [loggedIn, setLoggedIn] = useState(true);
  const [generation, setGeneration] = useState(0); // remount the store after logging in again

  if (route.parts[0] === 'privacy' && !loggedIn) return <PrivacyScreen />;
  if (!loggedIn) {
    return (
      <main className="app">
        <LoginScreen
          onLogin={() => {
            setLoggedIn(true);
            setGeneration((g) => g + 1);
          }}
        />
        <Footer />
      </main>
    );
  }

  return (
    <main className="app">
      <StoreProvider key={generation} onUnauthorized={() => setLoggedIn(false)}>
        <div className="content">
          <Screen onLogout={() => setLoggedIn(false)} />
        </div>
        <Footer />
        <nav className="bottom-nav">
          <a href="#/">Home</a>
          <a href="#/ranked">Ranking</a>
          <a href="#/search">Search</a>
          <a href="#/pick">Next</a>
          <a href="#/settings">Settings</a>
        </nav>
      </StoreProvider>
    </main>
  );
}
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: typecheck exits 0. Vite prints `dist/web/index.html`, one CSS and one JS asset, and `✓ built`.

- [ ] **Step 6: Try it**

Run: `npm run dev` (needs `.dev.vars` and `npm run db:migrate:local` from Plan 4), then open http://127.0.0.1:8787 in Chrome with device emulation (Pixel 7).
Expected: the login form. The wrong passphrase shows "Wrong passphrase."; the right one shows Home with six tiles and the bottom navigation. Stop with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/web
git commit -m "feat(web): app shell, API client, data store, login and home

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Ranking flow and triage

**Files:**
- Create: `src/web/screens/Rank.tsx`, `src/web/screens/Triage.tsx`
- Modify: `src/web/App.tsx`

**Interfaces:**
- Consumes: Tasks 1–2; `sessionStep`, `sessionList` (Plan 1); `duplicateHints` (Plan 3).
- Produces: `startSession(store, game, bucket, left?)`, `RankStartScreen({ gameId })` (`#/rank/new/:id`), `RankScreen({ sessionId, left })` (`#/rank/:session?left=N`), `QueueScreen({ left })` (`#/queue?left=N`), `TriageScreen` (`#/triage`). Test ids used by Task 6: `pick-new`, `pick-pivot`, `confirm`, `triage-name`, `duplicate-hint`.

- [ ] **Step 1: Write the screens**

`src/web/screens/Rank.tsx`:

```tsx
// The ranking flow (spec §6.1): pick a bucket → answer head-to-head questions → confirm the place.
// Everything shown is derived from the event log, so closing the app mid-session and coming back
// (on any device) resumes exactly where it stopped.

import { useState } from 'react';
import { sessionList, sessionStep } from '../../core/ranking';
import { BUCKETS, type Bucket, type GameId } from '../../core/types';
import { BUCKET_LABEL, Cover, gameName } from '../components';
import { unrankedQueue } from '../derive';
import { navigate } from '../router';
import { useStore, type Store } from '../store';

/** Open a session for `game` in `bucket` and go to it. `left` = games remaining in a "Rank 10" run. */
export async function startSession(store: Store, game: GameId, bucket: Bucket, left?: number): Promise<void> {
  const session = crypto.randomUUID();
  await store.append([{ type: 'session_started', gameId: game, data: { session, bucket } }]);
  navigate(`/rank/${session}${left ? `?left=${left}` : ''}`, true);
}

/** #/rank/new/:id: choose the bucket. Also used for re-rank and for moving a game to another bucket. */
export function RankStartScreen({ gameId }: { gameId: GameId }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const row = store.rowOf.get(gameId);
  const meta = store.games.get(gameId);

  async function choose(bucket: Bucket) {
    setBusy(true);
    // Ranking a game means you've played it: keep `dropped` if it was, otherwise mark it played.
    const status = row?.status === 'dropped' ? 'dropped' : 'played';
    if (row?.status !== status || row?.bucket !== bucket) await store.patchLibrary(gameId, { status, bucket });
    await startSession(store, gameId, bucket);
  }

  return (
    <section>
      <div className="hero">
        <Cover meta={meta} big />
        <h2>{meta?.name ?? `IGDB ${gameId}`}</h2>
      </div>
      <p>How was it?</p>
      <div className="choices">
        {BUCKETS.map((b) => (
          <button key={b} className={`big ${b}${row?.bucket === b ? ' suggested' : ''}`} disabled={busy} onClick={() => choose(b)}>
            {BUCKET_LABEL[b]}
          </button>
        ))}
      </div>
    </section>
  );
}

/** #/rank/:session: one question at a time, then the confirm screen. */
export function RankScreen({ sessionId, left }: { sessionId: string; left: number }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const session = store.state.openSessions.get(sessionId);

  if (!session) {
    return (
      <section>
        <p>This ranking session is finished.</p>
        <a href="#/">Home</a>
      </section>
    );
  }
  const next = sessionStep(store.state, sessionId)!;
  const name = (id: GameId) => gameName(store.games, id);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const answer = (result: 'better' | 'worse' | 'tie') => () =>
    act(() => store.append([{ type: 'answer', gameId: session.game, data: { session: sessionId, pivot: (next as { pivot: GameId }).pivot, result } }]));
  const undo = () => act(() => store.append([{ type: 'undo', gameId: session.game, data: { session: sessionId } }]));
  const restart = () =>
    act(async () => {
      await store.append([{ type: 'session_cancelled', gameId: session.game, data: { session: sessionId } }]);
      await startSession(store, session.game, session.bucket, left || undefined);
    });
  const backToBuckets = () =>
    act(async () => {
      await store.append([{ type: 'session_cancelled', gameId: session.game, data: { session: sessionId } }]);
      navigate(`/rank/new/${session.game}`, true);
    });

  const header = (
    <p className="muted small">
      Ranking <strong>{name(session.game)}</strong> in {BUCKET_LABEL[session.bucket]} · question {session.answers.length + (next.kind === 'ask' ? 1 : 0)}
    </p>
  );

  if (next.kind === 'stale') {
    return (
      <section>
        {header}
        <p>The {BUCKET_LABEL[session.bucket]} list changed while you were ranking (maybe on another device). Your answers no longer fit.</p>
        <button className="primary" disabled={busy} onClick={restart}>Start this game again</button>
      </section>
    );
  }

  if (next.kind === 'ask') {
    return (
      <section>
        {header}
        <h2>Which did you enjoy more?</h2>
        <div className="versus">
          <button className="big pick" disabled={busy} onClick={answer('better')} data-testid="pick-new">
            <Cover meta={store.games.get(session.game)} big />
            {name(session.game)}
          </button>
          <span className="vs">vs</span>
          <button className="big pick" disabled={busy} onClick={answer('worse')} data-testid="pick-pivot">
            <Cover meta={store.games.get(next.pivot)} big />
            {name(next.pivot)}
          </button>
        </div>
        <div className="row-buttons">
          <button disabled={busy} onClick={answer('tie')}>Too close to call</button>
          {session.answers.length > 0 ? <button disabled={busy} onClick={undo}>Undo</button> : <button disabled={busy} onClick={backToBuckets}>Change bucket</button>}
          <a className="button" href="#/">Stop for now</a>
        </div>
      </section>
    );
  }

  // next.kind === 'place': show where it lands and ask for confirmation.
  const list = sessionList(store.state, session);
  const index = next.below === null ? 0 : list.indexOf(next.below) + 1;
  const above = index > 0 ? list[index - 1] : null;
  const below = index < list.length ? list[index] : null;
  const where =
    above === null && below === null
      ? `the first game in ${BUCKET_LABEL[session.bucket]}`
      : above === null
        ? `at the top, above ${name(below!)}`
        : below === null
          ? `at the bottom, below ${name(above)}`
          : `between ${name(above)} and ${name(below)}`;

  const confirm = () =>
    act(async () => {
      await store.append([{ type: 'placed', gameId: session.game, data: { session: sessionId, bucket: session.bucket, below: next.below } }]);
      navigate(left > 0 ? `/queue?left=${left - 1}` : `/game/${session.game}`, true);
    });

  return (
    <section>
      {header}
      <h2 data-testid="confirm">
        {name(session.game)} goes {where}.
      </h2>
      <div className="row-buttons">
        <button className="primary" disabled={busy} onClick={confirm}>✓ Looks right</button>
        <button disabled={busy} onClick={restart}>Redo</button>
        {session.answers.length > 0 ? <button disabled={busy} onClick={undo}>Undo last answer</button> : null}
      </div>
    </section>
  );
}

/** #/queue?left=N: "Rank 10" works through unranked games, highest playtime first (spec §6.4). */
export function QueueScreen({ left }: { left: number }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const queue = unrankedQueue(store.rows, store.state);
  const nextRow = queue[0];
  if (left <= 0 || !nextRow) {
    return (
      <section>
        <h2>{nextRow ? 'Nice run!' : 'Nothing left to rank'}</h2>
        <p className="muted">{queue.length} unranked game{queue.length === 1 ? '' : 's'} waiting.</p>
        <a href="#/">Home</a>
      </section>
    );
  }
  return (
    <section>
      <p className="muted small">{left} to go in this run · {queue.length} unranked in total</p>
      <div className="hero">
        <Cover meta={store.games.get(nextRow.gameId)} big />
        <h2>{gameName(store.games, nextRow.gameId)}</h2>
        <p className="muted">{BUCKET_LABEL[nextRow.bucket!]}</p>
      </div>
      <div className="row-buttons">
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await startSession(store, nextRow.gameId, nextRow.bucket!, left);
          }}
        >
          Rank it
        </button>
        <a className="button" href={`#/rank/new/${nextRow.gameId}`}>Different bucket</a>
        <a className="button" href="#/">Done for now</a>
      </div>
    </section>
  );
}
```

`src/web/screens/Triage.tsx`:

```tsx
// Triage (spec §6.4, R-RANK-7): one tap per imported game, highest Steam playtime first.
// Duplicate hints (spec §8) show as a banner with a Merge button.

import { useState } from 'react';
import { duplicateHints } from '../../core/catalog';
import type { Bucket, GameId, Status } from '../../core/types';
import { BUCKET_LABEL, Cover, gameName } from '../components';
import { inboxQueue } from '../derive';
import { useStore } from '../store';

const DISMISSED_KEY = 'versus.dismissedHints';

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function TriageScreen() {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);

  const queue = inboxQueue(store.rows, store.state);
  const current = queue[0];

  // Hints among games still visible in the library (not ignored, not already merged away).
  const visible = store.rows
    .filter((r) => r.status !== 'ignored' && !store.state.aliases.has(r.gameId))
    .map((r) => store.games.get(r.gameId))
    .filter((g) => g !== undefined);
  const hint = duplicateHints(visible).find(([a, b]) => !dismissed.includes(`${a}-${b}`));

  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
      setDropped(false);
    }
  }

  const setStatus = (id: GameId, status: Status, bucket: Bucket | null = null) => act(() => store.patchLibrary(id, { status, bucket }));

  async function merge(keep: GameId, drop: GameId) {
    await act(async () => {
      await store.append([{ type: 'merged', gameId: drop, data: { into: keep } }]);
      await store.patchLibrary(drop, { status: 'ignored' });
    });
  }

  function dismiss(a: GameId, b: GameId) {
    const next = [...dismissed, `${a}-${b}`];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private mode: the hint just comes back next time.
    }
  }

  // Keep the one with more playtime; merge the other into it.
  let banner = null;
  if (hint) {
    const [a, b] = hint;
    const playtime = (id: GameId) => store.rowOf.get(id)?.steamPlaytimeMin ?? 0;
    const [keep, drop] = playtime(a) >= playtime(b) ? [a, b] : [b, a];
    banner = (
      <div className="card banner" data-testid="duplicate-hint">
        <p>
          <strong>{gameName(store.games, drop)}</strong> looks like the same game as <strong>{gameName(store.games, keep)}</strong>.
        </p>
        <div className="row-buttons">
          <button disabled={busy} onClick={() => merge(keep, drop)}>Merge</button>
          <button disabled={busy} onClick={() => dismiss(a, b)}>Not the same</button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <section>
        {banner}
        <h2>Triage done</h2>
        <p className="muted">Nothing left in the inbox.</p>
        <a className="button" href="#/queue?left=10">Rank 10</a>
      </section>
    );
  }

  const hours = Math.round((current.steamPlaytimeMin ?? 0) / 60);
  return (
    <section>
      {banner}
      <p className="muted small">{queue.length} left</p>
      <div className="hero">
        <Cover meta={store.games.get(current.gameId)} big />
        <h2 data-testid="triage-name">{gameName(store.games, current.gameId)}</h2>
        <p className="muted">{hours} h on Steam</p>
      </div>
      <p>Played it?</p>
      <div className="choices">
        {(['loved', 'liked', 'disliked'] as const).map((b) => (
          <button key={b} className={`big ${b}`} disabled={busy} onClick={() => setStatus(current.gameId, dropped ? 'dropped' : 'played', b)}>
            {BUCKET_LABEL[b]}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={dropped} onChange={(e) => setDropped(e.target.checked)} /> I dropped it
      </label>
      <p>Not yet:</p>
      <div className="row-buttons">
        <button disabled={busy} onClick={() => setStatus(current.gameId, 'backlog')}>Backlog</button>
        <button disabled={busy} onClick={() => setStatus(current.gameId, 'playing')}>Playing</button>
        <button disabled={busy} onClick={() => setStatus(current.gameId, 'ignored')}>Ignore</button>
      </div>
    </section>
  );
}
```

`src/web/App.tsx`:

```tsx
// The app shell: login gate, bottom navigation, and the hash-route switch.

import { useState } from 'react';
import { Footer } from './components';
import { useRoute } from './router';
import { HomeScreen } from './screens/Home';
import { QueueScreen, RankScreen, RankStartScreen } from './screens/Rank';
import { LoginScreen, PrivacyScreen } from './screens/Static';
import { TriageScreen } from './screens/Triage';
import { StoreProvider } from './store';

function Screen({ onLogout }: { onLogout: () => void }) {
  const { parts, query } = useRoute();
  const [first, second, third] = parts;
  const id = (raw: string | undefined) => Number(raw);

  if (first === 'rank' && second === 'new' && third) return <RankStartScreen key={third} gameId={id(third)} />;
  if (first === 'rank' && second) return <RankScreen key={second} sessionId={second} left={Number(query.get('left') ?? '0')} />;
  if (first === 'queue') return <QueueScreen left={Number(query.get('left') ?? '10')} />;
  if (first === 'triage') return <TriageScreen />;
  if (first === 'privacy') return <PrivacyScreen />;
  return <HomeScreen />;
}

export function App() {
  const route = useRoute();
  // Assume a session exists; the first API call that answers 401 flips this to false.
  const [loggedIn, setLoggedIn] = useState(true);
  const [generation, setGeneration] = useState(0); // remount the store after logging in again

  if (route.parts[0] === 'privacy' && !loggedIn) return <PrivacyScreen />;
  if (!loggedIn) {
    return (
      <main className="app">
        <LoginScreen
          onLogin={() => {
            setLoggedIn(true);
            setGeneration((g) => g + 1);
          }}
        />
        <Footer />
      </main>
    );
  }

  return (
    <main className="app">
      <StoreProvider key={generation} onUnauthorized={() => setLoggedIn(false)}>
        <div className="content">
          <Screen onLogout={() => setLoggedIn(false)} />
        </div>
        <Footer />
        <nav className="bottom-nav">
          <a href="#/">Home</a>
          <a href="#/ranked">Ranking</a>
          <a href="#/search">Search</a>
          <a href="#/pick">Next</a>
          <a href="#/settings">Settings</a>
        </nav>
      </StoreProvider>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Try it (optional)**

The local database is empty until Settings → Import exists (Task 4), so the full flow is exercised by Task 6's journey test. To look now: `npm run dev`, log in, then import with your real credentials from a second terminal (`curl -X POST -H "cookie: $C" http://127.0.0.1:8787/api/import/steam`, getting `$C` as in Plan 4 Task 6). Then open `#/triage` (games appear highest playtime first) and `#/queue?left=10` (Rank it → questions → ✓ Looks right). Reload mid-session: the same question comes back.

- [ ] **Step 4: Commit**

```bash
git add src/web/screens/Rank.tsx src/web/screens/Triage.tsx src/web/App.tsx
git commit -m "feat(web): ranking flow with undo, confirm, resume, Rank 10, and triage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ranked list, library, search, game page, backlog pick, settings

**Files:**
- Create: `src/web/screens/Ranked.tsx`, `src/web/screens/Library.tsx`, `src/web/screens/Search.tsx`, `src/web/screens/Game.tsx`, `src/web/screens/Pick.tsx`, `src/web/screens/Settings.tsx`
- Modify: `src/web/App.tsx`

**Interfaces:**
- Consumes: Tasks 1–3; `recommend` (Plan 2).
- Produces: `RankedScreen({ listId })` (`#/ranked?list=`), `LibraryScreen` (`#/library`), `SearchScreen` (`#/search`), `GameScreen({ gameId })` (`#/game/:id`), `PickScreen` (`#/pick`), `SettingsScreen({ onLogout })` (`#/settings`). Test ids: `game-name`, `ranked-score`, `prediction`, `reasons`, `pick-row`, `import-summary`, `backup-age`.

- [ ] **Step 1: Write the screens**

`src/web/screens/Ranked.tsx`:

```tsx
// The ranked list (R-RANK-4, R-LIB-2, R-RANK-9a): buckets in order, scores, unranked games marked,
// filters, and sub-lists (saved filters or hand-picked sets) shown in the global order.

import { useState } from 'react';
import { globalOrder } from '../../core/ranking';
import { BUCKETS, STATUSES, type Status, type SublistFilter } from '../../core/types';
import { BUCKET_LABEL, DroppedMarker, GameRow, ScoreBadge } from '../components';
import { matchesFilter } from '../derive';
import { navigate } from '../router';
import { useStore } from '../store';

export function RankedScreen({ listId }: { listId: string | null }) {
  const store = useStore();
  const [filter, setFilter] = useState<SublistFilter>({});
  const sublist = listId ? store.sublists.find((s) => s.id === listId) : undefined;
  const order = globalOrder(store.state);
  const rankOf = new Map(order.map((id, i) => [id, i + 1]));

  const passes = (id: number) => {
    const meta = store.games.get(id);
    const row = store.rowOf.get(id);
    if (sublist?.kind === 'set' && !sublist.items.includes(id)) return false;
    if (sublist?.kind === 'filter' && sublist.filter && !matchesFilter(meta, row, sublist.filter)) return false;
    return matchesFilter(meta, row, filter);
  };

  async function saveFilter() {
    const name = window.prompt('Name this sub-list');
    if (!name) return;
    const id = crypto.randomUUID();
    await store.saveSublist({ id, name, kind: 'filter', filter, items: [], createdAt: new Date().toISOString() });
    navigate(`/ranked?list=${id}`);
  }

  async function newSet() {
    const name = window.prompt('Name the new hand-picked list (add games from their page)');
    if (!name) return;
    await store.saveSublist({ id: crypto.randomUUID(), name, kind: 'set', filter: null, items: [], createdAt: new Date().toISOString() });
  }

  const genres = [...new Set([...store.games.values()].flatMap((g) => g.genres))].sort();
  const platforms = [...new Set([...store.games.values()].flatMap((g) => g.platforms).concat(store.rows.flatMap((r) => r.platforms)))].sort();

  return (
    <section>
      <h2>{sublist ? sublist.name : 'My ranking'}</h2>
      <div className="tabs">
        <a className={listId ? 'tab' : 'tab active'} href="#/ranked">All</a>
        {store.sublists.map((s) => (
          <a key={s.id} className={s.id === listId ? 'tab active' : 'tab'} href={`#/ranked?list=${s.id}`}>{s.name}</a>
        ))}
        <button className="tab" onClick={newSet}>+ list</button>
      </div>
      <details className="filters">
        <summary>Filter</summary>
        <div className="filter-grid">
          <select value={filter.platform ?? ''} onChange={(e) => setFilter({ ...filter, platform: e.target.value || undefined })} aria-label="Platform">
            <option value="">Any platform</option>
            {platforms.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select value={filter.genre ?? ''} onChange={(e) => setFilter({ ...filter, genre: e.target.value || undefined })} aria-label="Genre">
            <option value="">Any genre</option>
            {genres.map((g) => <option key={g}>{g}</option>)}
          </select>
          <input type="number" placeholder="From year" value={filter.yearFrom ?? ''} onChange={(e) => setFilter({ ...filter, yearFrom: e.target.value ? Number(e.target.value) : undefined })} />
          <input type="number" placeholder="To year" value={filter.yearTo ?? ''} onChange={(e) => setFilter({ ...filter, yearTo: e.target.value ? Number(e.target.value) : undefined })} />
          <select value={filter.status ?? ''} onChange={(e) => setFilter({ ...filter, status: (e.target.value || undefined) as Status | undefined })} aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button onClick={saveFilter} disabled={Object.keys(filter).every((k) => filter[k as keyof SublistFilter] === undefined)}>Save as sub-list</button>
        </div>
      </details>
      {sublist ? (
        <button className="link" onClick={async () => { await store.removeSublist(sublist.id); navigate('/ranked'); }}>Delete this sub-list</button>
      ) : null}
      <p className="muted small">Scores (0–10) come from positions inside each bucket, so they shift as you rank more games.</p>

      {BUCKETS.map((bucket) => {
        const ranked = store.state.lists[bucket].filter(passes);
        const unranked = store.rows
          .filter((r) => r.bucket === bucket && (r.status === 'played' || r.status === 'dropped'))
          .filter((r) => !rankOf.has(r.gameId) && !store.state.aliases.has(r.gameId) && passes(r.gameId));
        return (
          <div key={bucket} className="bucket">
            <h3 className={bucket}>{BUCKET_LABEL[bucket]}</h3>
            {ranked.length === 0 && unranked.length === 0 ? <p className="muted small">Nothing yet.</p> : null}
            {ranked.map((id) => (
              <GameRow
                key={id}
                id={id}
                meta={store.games.get(id)}
                sub={<DroppedMarker row={store.rowOf.get(id)} />}
                right={<><span className="muted">#{rankOf.get(id)}</span> <ScoreBadge score={store.scoreMap.get(id)!} bucket={bucket} /></>}
              />
            ))}
            {unranked.map((r) => (
              <GameRow key={r.gameId} id={r.gameId} meta={store.games.get(r.gameId)} right={<span className="tag">unranked</span>} />
            ))}
          </div>
        );
      })}
    </section>
  );
}
```

`src/web/screens/Library.tsx`:

```tsx
// Library by status (R-LIB-2).

import { useState } from 'react';
import { STATUSES, type Status } from '../../core/types';
import { GameRow } from '../components';
import { useStore } from '../store';

const LABEL: Record<Status, string> = {
  inbox: 'Inbox', wishlist: 'Wishlist', backlog: 'Backlog', playing: 'Playing', played: 'Played', dropped: 'Dropped', ignored: 'Ignored',
};

export function LibraryScreen() {
  const store = useStore();
  const [status, setStatus] = useState<Status>('backlog');
  const visible = store.rows.filter((r) => !store.state.aliases.has(r.gameId));
  const shown = visible
    .filter((r) => r.status === status)
    .sort((a, b) => (store.games.get(a.gameId)?.name ?? '').localeCompare(store.games.get(b.gameId)?.name ?? ''));

  return (
    <section>
      <h2>Library</h2>
      <div className="tabs">
        {STATUSES.map((s) => (
          <button key={s} className={s === status ? 'tab active' : 'tab'} onClick={() => setStatus(s)}>
            {LABEL[s]} <span className="muted">{visible.filter((r) => r.status === s).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="muted">Nothing here.</p> : null}
      {shown.map((r) => (
        <GameRow key={r.gameId} id={r.gameId} meta={store.games.get(r.gameId)} sub={r.platforms.join(', ')} />
      ))}
    </section>
  );
}
```

`src/web/screens/Search.tsx`:

```tsx
// Typeahead search over IGDB (spec §8, R-DATA-1): 250 ms debounce, at least 2 characters.

import { useEffect, useState } from 'react';
import type { GameMeta } from '../../core/types';
import { api } from '../api';
import { GameRow } from '../components';
import { useStore } from '../store';

export function SearchScreen() {
  const store = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GameMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search(q)
        .then((r) => {
          if (!cancelled) {
            setResults(r.results);
            setError(null);
          }
        })
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <section>
      <input
        className="search"
        type="search"
        autoFocus
        placeholder="Search any game…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search games"
      />
      {error ? <p className="error">{error}</p> : null}
      {results.map((g) => (
        <GameRow
          key={g.id}
          id={g.id}
          meta={g}
          right={store.rowOf.has(g.id) ? <span className="tag">in library</span> : null}
        />
      ))}
    </section>
  );
}
```

`src/web/screens/Game.tsx`:

```tsx
// One game: metadata, library status, its place in the ranking, or a prediction with reasons
// (spec §7.3), "Already played → rank now" (R-REC-5a), Refresh, set-list membership, unmerge.

import { useEffect, useMemo, useState } from 'react';
import { formatScore, globalOrder, positionOf } from '../../core/ranking';
import { recommend } from '../../core/recommender';
import { STATUSES, type GameId, type Status } from '../../core/types';
import { BUCKET_LABEL, Cover, DroppedMarker, gameName, PredictionCard, ScoreBadge, TimeToBeat } from '../components';
import { isStale } from '../derive';
import { navigate } from '../router';
import { useStore } from '../store';

export function GameScreen({ gameId }: { gameId: GameId }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = store.games.get(gameId);
  const row = store.rowOf.get(gameId);
  const stale = isStale(store.fetchedAt[gameId], new Date());

  // Fetch missing or > 30-day-old metadata. A searched edition/remaster redirects to its root work.
  useEffect(() => {
    if (!stale) return;
    let cancelled = false;
    store
      .fetchGame(gameId)
      .then((rootId) => {
        if (!cancelled && rootId !== gameId) navigate(`/game/${rootId}`, true);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the game and its freshness only: `store` changes after every fetch.
  }, [gameId, stale]);

  const position = positionOf(store.state, gameId);
  const prediction = useMemo(
    () => (position || !meta ? null : (recommend(store.state, store.scoreMap, [...store.games.values()], [gameId])[0] ?? null)),
    [position, meta, store.state, store.scoreMap, store.games, gameId],
  );

  if (!meta) return <p className="muted">{error ?? 'Loading game…'}</p>;

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (status: Status) => act(() => store.patchLibrary(gameId, { status }));
  const rankNow = () =>
    act(async () => {
      await store.patchLibrary(gameId, { status: row?.status === 'dropped' ? 'dropped' : 'played' });
      navigate(`/rank/new/${gameId}`);
    });
  const unrank = () => act(() => store.append([{ type: 'unranked', gameId, data: {} }]));
  const mergedHere = [...store.state.aliases].filter(([, into]) => into === gameId).map(([from]) => from);
  const unmerge = (from: GameId) =>
    act(async () => {
      await store.append([{ type: 'unmerged', gameId: from, data: { into: gameId } }]);
      await store.patchLibrary(from, { status: 'inbox' });
    });
  const setLists = store.sublists.filter((s) => s.kind === 'set');
  const toggleSet = (id: string) =>
    act(async () => {
      const s = setLists.find((x) => x.id === id)!;
      const items = s.items.includes(gameId) ? s.items.filter((x) => x !== gameId) : [...s.items, gameId];
      await store.saveSublist({ ...s, items });
    });

  const rank = position ? globalOrder(store.state).indexOf(gameId) + 1 : null;

  return (
    <section>
      <div className="hero">
        <Cover meta={meta} big />
        <h2 data-testid="game-name">{meta.name}</h2>
        <p className="muted">
          {[meta.year, meta.genres.slice(0, 3).join(', '), meta.platforms.slice(0, 4).join(', ')].filter(Boolean).join(' · ')}
          {meta.ttb ? <> · <TimeToBeat meta={meta} /></> : null}
        </p>
      </div>
      {error ? <p className="error">{error}</p> : null}

      {position ? (
        <div className="card">
          <p data-testid="ranked-score">
            #{rank} · <ScoreBadge score={store.scoreMap.get(gameId)!} bucket={position.bucket} /> · {BUCKET_LABEL[position.bucket]} <DroppedMarker row={row} />
          </p>
          <div className="row-buttons">
            <a className="button" href={`#/rank/new/${gameId}`}>Re-rank / change bucket</a>
            <button disabled={busy} onClick={unrank}>Remove from ranking</button>
          </div>
        </div>
      ) : (
        <>
          {prediction ? <PredictionCard prediction={prediction} games={store.games} state={store.state} /> : null}
          <div className="row-buttons">
            <button className="primary" disabled={busy} onClick={rankNow}>Already played → rank now</button>
          </div>
        </>
      )}

      <div className="card">
        {row ? (
          <label>
            Status{' '}
            <select value={row.status} disabled={busy} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="row-buttons">
            <span>Add to library:</span>
            <button disabled={busy} onClick={() => setStatus('wishlist')}>Wishlist</button>
            <button disabled={busy} onClick={() => setStatus('backlog')}>Backlog</button>
          </div>
        )}
        {setLists.length > 0 ? (
          <div className="row-buttons">
            {setLists.map((s) => (
              <button key={s.id} disabled={busy} className={s.items.includes(gameId) ? 'tab active' : 'tab'} onClick={() => toggleSet(s.id)}>
                {s.items.includes(gameId) ? '✓ ' : '+ '}
                {s.name}
              </button>
            ))}
          </div>
        ) : null}
        {mergedHere.map((from) => (
          <p key={from} className="muted small">
            Merged: {gameName(store.games, from)} <button disabled={busy} onClick={() => unmerge(from)}>Unmerge</button>
          </p>
        ))}
        <button disabled={busy} onClick={() => act(async () => void (await store.fetchGame(gameId)))}>Refresh game data</button>
        {position ? <p className="muted small">Score {formatScore(store.scoreMap.get(gameId)!)}: scores shift as you rank more games.</p> : null}
      </div>
    </section>
  );
}
```

`src/web/screens/Pick.tsx`:

```tsx
// Backlog pick (spec §7.3, R-REC-3): backlog (optionally + wishlist) sorted by predicted score,
// filtered by platform, genre and length.

import { useMemo, useState } from 'react';
import { recommend } from '../../core/recommender';
import { BUCKET_LABEL, GameRow, ScoreBadge, TimeToBeat } from '../components';
import { matchesFilter } from '../derive';
import { useStore } from '../store';

export function PickScreen() {
  const store = useStore();
  const [withWishlist, setWithWishlist] = useState(false);
  const [platform, setPlatform] = useState('');
  const [genre, setGenre] = useState('');
  const [maxHours, setMaxHours] = useState('');

  const candidates = useMemo(
    () =>
      store.rows
        .filter((r) => r.status === 'backlog' || (withWishlist && r.status === 'wishlist'))
        .filter((r) => !store.state.aliases.has(r.gameId))
        .map((r) => r.gameId),
    [store.rows, store.state, withWishlist],
  );
  // Fitting the model takes a few milliseconds; only redo it when the data changes.
  const predictions = useMemo(
    () => recommend(store.state, store.scoreMap, [...store.games.values()], candidates),
    [store.state, store.scoreMap, store.games, candidates],
  );

  const shown = predictions
    .filter((p) => {
      const meta = store.games.get(p.gameId);
      if (!matchesFilter(meta, store.rowOf.get(p.gameId), { platform: platform || undefined, genre: genre || undefined })) return false;
      if (maxHours && meta?.ttb && meta.ttb.normally / 3600 > Number(maxHours)) return false;
      return true;
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const genres = [...new Set(candidates.flatMap((id) => store.games.get(id)?.genres ?? []))].sort();
  const platforms = [...new Set(candidates.flatMap((id) => [...(store.games.get(id)?.platforms ?? []), ...(store.rowOf.get(id)?.platforms ?? [])]))].sort();

  return (
    <section>
      <h2>What to play next</h2>
      <div className="filter-grid">
        <label className="check">
          <input type="checkbox" checked={withWishlist} onChange={(e) => setWithWishlist(e.target.checked)} /> include wishlist
        </label>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
          <option value="">Any platform</option>
          {platforms.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre">
          <option value="">Any genre</option>
          {genres.map((g) => <option key={g}>{g}</option>)}
        </select>
        <input type="number" min="1" placeholder="Max hours" value={maxHours} onChange={(e) => setMaxHours(e.target.value)} />
      </div>
      {shown.length === 0 ? <p className="muted">Nothing in your backlog matches.</p> : null}
      {shown.map((p) => (
        <div key={p.gameId} className="pick" data-testid="pick-row">
          <GameRow
            id={p.gameId}
            meta={store.games.get(p.gameId)}
            sub={<TimeToBeat meta={store.games.get(p.gameId)} />}
            right={p.score === null ? <span className="muted small">no prediction yet</span> : <ScoreBadge score={p.score} bucket={p.bucket!} />}
          />
          {p.score !== null ? (
            <p className="muted small pick-why">
              {BUCKET_LABEL[p.bucket!]} · {p.confidence} confidence
              {p.reasons[0] ? <> · {p.reasons[0].label} {p.reasons[0].value >= 0 ? '+' : '−'}{Math.abs(p.reasons[0].value).toFixed(1)}</> : null}
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
```

`src/web/screens/Settings.tsx`:

```tsx
// Settings: Steam import, export (JSON + CSV), backup age, logout (spec §8, §10, R-LIB-3).

import { useEffect, useState } from 'react';
import { api, type ImportSummary } from '../api';
import { backupAgeDays, rankedListCsv } from '../derive';
import { useStore } from '../store';

export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  const store = useStore();
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api.status().then((s) => setLastBackupAt(s.lastBackupAt)).catch(() => setLastBackupAt(null));
  }, []);

  async function importSteam() {
    setBusy(true);
    setError(null);
    try {
      setSummary(await api.importSteam());
      await store.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    const csv = rankedListCsv(store.state, store.scoreMap, store.games, store.rowOf);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `versus-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const age = lastBackupAt === undefined ? undefined : backupAgeDays(lastBackupAt, new Date());
  const backupOld = age === null || (age !== undefined && age > 3);

  return (
    <section>
      <h2>Settings</h2>

      <div className="card">
        <h3>Steam</h3>
        <button className="primary" disabled={busy} onClick={importSteam}>{busy ? 'Importing…' : 'Import / refresh Steam library'}</button>
        {summary ? (
          <p data-testid="import-summary">
            {summary.owned} owned · {summary.mapped} found on IGDB · {summary.added} new · {summary.updated} updated
            {summary.unmapped.length > 0 ? <span className="muted small"> · not found: {summary.unmapped.map((u) => u.name).join(', ')}</span> : null}
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="card">
        <h3>Export</h3>
        <div className="row-buttons">
          <a className="button" href="/api/export" download>Everything (JSON)</a>
          <button onClick={downloadCsv}>Ranked list (CSV)</button>
        </div>
        <p className={backupOld ? 'error small' : 'muted small'} data-testid="backup-age">
          {age === undefined ? 'Checking backups…' : age === null ? 'No nightly backup recorded yet.' : `Last nightly backup: ${age} day${age === 1 ? '' : 's'} ago.`}
        </p>
      </div>

      <div className="card">
        <button
          onClick={async () => {
            await api.logout();
            onLogout();
          }}
        >
          Log out
        </button>
      </div>
    </section>
  );
}
```

Final `src/web/App.tsx`:

```tsx
// The app shell: login gate, bottom navigation, and the hash-route switch.

import { useState } from 'react';
import { Footer } from './components';
import { useRoute } from './router';
import { GameScreen } from './screens/Game';
import { HomeScreen } from './screens/Home';
import { LibraryScreen } from './screens/Library';
import { PickScreen } from './screens/Pick';
import { QueueScreen, RankScreen, RankStartScreen } from './screens/Rank';
import { RankedScreen } from './screens/Ranked';
import { SearchScreen } from './screens/Search';
import { SettingsScreen } from './screens/Settings';
import { LoginScreen, PrivacyScreen } from './screens/Static';
import { TriageScreen } from './screens/Triage';
import { StoreProvider } from './store';

function Screen({ onLogout }: { onLogout: () => void }) {
  const { parts, query } = useRoute();
  const [first, second, third] = parts;
  const id = (raw: string | undefined) => Number(raw);

  if (first === 'game' && second) return <GameScreen key={second} gameId={id(second)} />;
  if (first === 'rank' && second === 'new' && third) return <RankStartScreen key={third} gameId={id(third)} />;
  if (first === 'rank' && second) return <RankScreen key={second} sessionId={second} left={Number(query.get('left') ?? '0')} />;
  if (first === 'queue') return <QueueScreen left={Number(query.get('left') ?? '10')} />;
  if (first === 'triage') return <TriageScreen />;
  if (first === 'ranked') return <RankedScreen listId={query.get('list')} />;
  if (first === 'library') return <LibraryScreen />;
  if (first === 'search') return <SearchScreen />;
  if (first === 'pick') return <PickScreen />;
  if (first === 'settings') return <SettingsScreen onLogout={onLogout} />;
  if (first === 'privacy') return <PrivacyScreen />;
  return <HomeScreen />;
}

export function App() {
  const route = useRoute();
  // Assume a session exists; the first API call that answers 401 flips this to false.
  const [loggedIn, setLoggedIn] = useState(true);
  const [generation, setGeneration] = useState(0); // remount the store after logging in again

  if (route.parts[0] === 'privacy' && !loggedIn) return <PrivacyScreen />;
  if (!loggedIn) {
    return (
      <main className="app">
        <LoginScreen
          onLogin={() => {
            setLoggedIn(true);
            setGeneration((g) => g + 1);
          }}
        />
        <Footer />
      </main>
    );
  }

  return (
    <main className="app">
      <StoreProvider key={generation} onUnauthorized={() => setLoggedIn(false)}>
        <div className="content">
          <Screen onLogout={() => setLoggedIn(false)} />
        </div>
        <Footer />
        <nav className="bottom-nav">
          <a href="#/">Home</a>
          <a href="#/ranked">Ranking</a>
          <a href="#/search">Search</a>
          <a href="#/pick">Next</a>
          <a href="#/settings">Settings</a>
        </nav>
      </StoreProvider>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed (the JS bundle is ~260 kB, ~82 kB gzipped).

- [ ] **Step 3: Commit**

```bash
git add src/web/screens src/web/App.tsx
git commit -m "feat(web): ranked list with sub-lists, library, search, game page, backlog pick, settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Installable PWA

**Files:**
- Create: `src/web/public/manifest.webmanifest`, `src/web/public/sw.js`, `scripts/make-icons.ts`, `src/web/public/icons/icon-192.png`, `src/web/public/icons/icon-512.png`, `src/web/public/icons/icon-maskable-512.png` (generated)
- Modify: `package.json` (script)

**Interfaces:**
- Consumes: `index.html` already links `/manifest.webmanifest` and `/icons/icon-192.png`; `main.tsx` registers `/sw.js` in production builds.
- Produces: script `npm run icons`.

- [ ] **Step 1: Manifest and service worker**

`src/web/public/manifest.webmanifest`:

```json
{
  "name": "versus",
  "short_name": "versus",
  "description": "Rank the games you've played; predict the ones you haven't.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#16181d",
  "theme_color": "#16181d",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`src/web/public/sw.js`:

```js
// Service worker: makes the app installable and loads the app shell fast. Ranking needs the network
// (spec D21), so /api/* is never cached: the app always sees the server's log.
const CACHE = 'versus-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Network first (so a deploy shows up at once), cache as the offline fallback.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match('/'))),
  );
});
```

- [ ] **Step 2: Icons**

`scripts/make-icons.ts`:

```ts
// Generate the PWA icons (plain PNGs, no image library): a dark tile with two facing bars, the
// "head to head" of versus. Run once: `npm run icons`. The output is committed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x16, 0x18, 0x1d];
const LEFT = [0xfb, 0x92, 0x3c]; // orange
const RIGHT = [0xec, 0xee, 0xf2]; // off-white

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** `safe` = share of the size kept clear at each edge (maskable icons need ~20%). */
function icon(size: number, safe: number): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const inset = size * safe;
  const barW = (size - 2 * inset) * 0.22;
  const top = inset + (size - 2 * inset) * 0.18;
  const bottom = size - inset - (size - 2 * inset) * 0.18;
  const leftX = inset + (size - 2 * inset) * 0.2;
  const rightX = size - inset - (size - 2 * inset) * 0.2 - barW;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      let color = BG;
      if (y >= top && y <= bottom) {
        if (x >= leftX && x <= leftX + barW && y <= bottom - (bottom - top) * 0.25) color = LEFT;
        if (x >= rightX && x <= rightX + barW && y >= top + (bottom - top) * 0.25) color = RIGHT;
      }
      raw.set(color, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = 'src/web/public/icons';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/icon-192.png`, icon(192, 0.08));
writeFileSync(`${dir}/icon-512.png`, icon(512, 0.08));
writeFileSync(`${dir}/icon-maskable-512.png`, icon(512, 0.2));
console.log(`wrote 3 icons to ${dir}`);
```

Add `"icons": "tsx scripts/make-icons.ts"` to `scripts`, then run:

Run: `npm run icons`
Expected: `wrote 3 icons to src/web/public/icons`. The 192 px icon is a dark square with an orange bar (upper left) and an off-white bar (lower right).

- [ ] **Step 3: Check the build output and installability**

Run: `npm run build && ls dist/web dist/web/icons`
Expected: `index.html`, `manifest.webmanifest`, `sw.js`, `assets/`, and the three PNGs.

Run `npm run dev`, open http://127.0.0.1:8787 in Chrome → DevTools → Application → Manifest.
Expected: no installability errors; the service worker shows as activated. ✅ Chrome counts `127.0.0.1` as a secure context, so the `Secure` session cookie and the service worker both work locally (the e2e test in Task 6 logs in this way).

- [ ] **Step 4: Commit**

```bash
git add src/web/public scripts/make-icons.ts package.json
git commit -m "feat(web): manifest, service worker and generated icons (installable PWA)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end journey, CI, README

**Files:**
- Create: `tests/e2e/fake-upstream-server.ts`, `tests/e2e/e2e.env`, `playwright.config.ts`, `tests/e2e/journey.spec.ts`
- Modify: `package.json` (dependency, scripts), `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: everything; `fakeUpstream` (Plan 4, `tests/fixtures/fake-upstream.ts`).
- Produces: scripts `npm run e2e`, `npm run e2e:server`.
- Note: this test is written after the screens exist, so it passes on its first green run. It's the acceptance test for spec §11's e2e row and the regression net for every later change. Step 5 makes it fail once on purpose to prove it bites.

- [ ] **Step 1: Install Playwright and its browser**

```bash
npm install --save-exact -D @playwright/test@1.63.0
npx playwright install chromium
```

Add to `scripts`:

```json
    "e2e": "playwright test",
    "e2e:server": "vite build && node -e \"require('node:fs').rmSync('.wrangler/e2e',{recursive:true,force:true})\" && wrangler d1 migrations apply versus --local --persist-to .wrangler/e2e && wrangler dev --ip 127.0.0.1 --port 8787 --persist-to .wrangler/e2e --env-file tests/e2e/e2e.env"
```

(`e2e:server` builds the app, wipes and re-migrates a separate e2e database under `.wrangler/e2e`, then serves with the fake env.)

- [ ] **Step 2: Fake upstream server, fake env, Playwright config**

`tests/e2e/fake-upstream-server.ts`:

```ts
// Serves tests/fixtures/fake-upstream.ts over HTTP on :8788 so `wrangler dev` can call it during the
// end-to-end tests (tests/e2e/e2e.env points IGDB_BASE_URL, TWITCH_TOKEN_URL and STEAM_BASE_URL here).

import { createServer } from 'node:http';
import { fakeUpstream } from '../fixtures/fake-upstream';

const PORT = 8788;

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const response = await fakeUpstream(`http://127.0.0.1:${PORT}${req.url}`, { method: req.method, body });
  res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json' });
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => console.log(`fake upstream on http://127.0.0.1:${PORT}`));
```

`tests/e2e/e2e.env`:

```dotenv
# Fake secrets for the end-to-end tests only (committed on purpose; they protect nothing).
# Passed with `wrangler dev --env-file`, which overrides any local .dev.vars (verified 2026-10-06).
APP_PASSPHRASE=e2e-passphrase
SESSION_KEY=e2e-session-key
BACKUP_TOKEN=e2e-backup-token
TWITCH_CLIENT_ID=e2e-twitch-client
TWITCH_CLIENT_SECRET=e2e-twitch-secret
STEAM_API_KEY=E2ESTEAMKEY0123456789
STEAM_ID64=76561190000000001
IGDB_BASE_URL=http://127.0.0.1:8788/v4
TWITCH_TOKEN_URL=http://127.0.0.1:8788/oauth2/token
STEAM_BASE_URL=http://127.0.0.1:8788
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (spec §11): a phone-sized Chromium (Pixel 7 profile) against `wrangler dev`
// with a fresh local D1 and a fake IGDB/Steam on :8788. Nothing here touches the real APIs.
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:8787', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'npx tsx tests/e2e/fake-upstream-server.ts',
      port: 8788,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run e2e:server',
      url: 'http://127.0.0.1:8787/',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
```

- [ ] **Step 3: The journey**

`tests/e2e/journey.spec.ts`:

```ts
// The v1 journey on a phone (spec §11): login → import → triage → rank → search a game → bucket →
// questions → undo → abort and resume after reload → confirm → score shown → backlog pick shows
// reasons → export downloads. One test, because each step builds on the data the previous one made.
// Fixture library (tests/fixtures/steam/owned.json): Skyrim 5000 min, Hades 3000, GTA V 2000,
// Outer Wilds 1200, BioShock 600 + Remastered 300 (merged into one work), GTA V Enhanced 100.

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/** Answer every question in favour of `choice` until the confirm screen; returns the number asked. */
async function answerUntilConfirm(page: Page, choice: 'pick-new' | 'pick-pivot' = 'pick-new'): Promise<number> {
  let asked = 0;
  for (;;) {
    await expect(page.getByTestId('pick-new').or(page.getByTestId('confirm'))).toBeVisible();
    if (await page.getByTestId('confirm').isVisible()) return asked;
    await page.getByTestId(choice).click();
    asked += 1;
  }
}

test('the v1 journey on a phone', async ({ page }) => {
  await test.step('log in', async () => {
    await page.goto('/');
    await page.getByLabel('Passphrase').fill('e2e-passphrase');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'versus' })).toBeVisible();
  });

  await test.step('import the Steam library', async () => {
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Import / refresh Steam library' }).click();
    await expect(page.getByTestId('import-summary')).toContainText('8 owned · 7 found on IGDB · 6 new');
  });

  await test.step('triage, highest playtime first', async () => {
    await page.goto('/#/triage');
    await expect(page.getByTestId('duplicate-hint')).toContainText('Grand Theft Auto V Enhanced'); // spec §8 hint
    const plan: [string, string][] = [
      ['The Elder Scrolls V: Skyrim', 'Loved'],
      ['Hades', 'Loved'],
      ['Grand Theft Auto V', 'Liked'],
      ['Outer Wilds', 'Backlog'],
      ['BioShock', 'Liked'],
      ['Grand Theft Auto V Enhanced', 'Backlog'],
    ];
    for (const [name, button] of plan) {
      await expect(page.getByTestId('triage-name')).toHaveText(name);
      await page.getByRole('button', { name: button, exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Triage done' })).toBeVisible();
  });

  await test.step('Rank 10 places the four triaged games', async () => {
    await page.goto('/#/queue?left=10');
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Rank it' }).click();
      expect(await answerUntilConfirm(page)).toBeLessThanOrEqual(8);
      await page.getByRole('button', { name: '✓ Looks right' }).click();
    }
    await expect(page.getByRole('heading', { name: 'Nothing left to rank' })).toBeVisible();
  });

  let sessionUrl = '';
  await test.step('search a game and start ranking it', async () => {
    await page.goto('/#/search');
    await page.getByLabel('Search games').fill('outer wild');
    await page.getByRole('link', { name: /Outer Wilds/ }).first().click();
    await expect(page.getByTestId('game-name')).toHaveText('Outer Wilds');
    await page.getByRole('button', { name: 'Already played → rank now' }).click();
    await page.getByRole('button', { name: 'Loved', exact: true }).click();
    await expect(page.getByTestId('pick-pivot')).toBeVisible();
    sessionUrl = page.url();
  });

  await test.step('undo brings the same question back', async () => {
    const firstPivot = await page.getByTestId('pick-pivot').innerText();
    await page.getByTestId('pick-pivot').click();
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.getByTestId('pick-pivot')).toHaveText(firstPivot);
  });

  await test.step('abort and resume after a reload', async () => {
    await page.getByTestId('pick-new').click(); // Outer Wilds beats the first pivot
    await page.reload();
    await page.goto('/');
    await page.getByRole('link', { name: 'Continue ranking Outer Wilds' }).click();
    expect(page.url()).toBe(sessionUrl);
  });

  await test.step('confirm the place and see the score', async () => {
    expect(await answerUntilConfirm(page)).toBeLessThanOrEqual(8);
    await expect(page.getByTestId('confirm')).toContainText('Outer Wilds goes');
    await page.getByRole('button', { name: '✓ Looks right' }).click();
    await expect(page.getByTestId('ranked-score')).toContainText('Loved');
    await expect(page.getByTestId('ranked-score')).toContainText('10.0'); // it beat both other loved games
  });

  await test.step('backlog pick shows a prediction with reasons', async () => {
    await page.goto('/#/pick');
    const row = page.getByTestId('pick-row').filter({ hasText: 'Grand Theft Auto V Enhanced' });
    await expect(row).toContainText('confidence'); // 5 ranked games → predictions exist (low confidence)
    await row.getByRole('link').click();
    await expect(page.getByTestId('prediction')).toBeVisible();
    await expect(page.getByTestId('reasons').locator('li').first()).toBeVisible();
  });

  await test.step('export downloads the whole log', async () => {
    await page.goto('/#/settings');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Everything (JSON)' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^versus-export-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(readFileSync((await file.path())!, 'utf8')) as { events: unknown[]; library: unknown[] };
    expect(data.events.length).toBeGreaterThan(10);
    expect(data.library).toHaveLength(6);
  });
});
```

- [ ] **Step 4: Run it**

Make sure nothing else listens on ports 8787 and 8788 (stop any `npm run dev`).

Run (Git Bash): `CI=1 npm run e2e`. In PowerShell: `$env:CI='1'; npm run e2e; Remove-Item Env:CI`.
Expected: `1 passed` in about 15 s (✅ measured on this machine: 14.4 s), after the servers start. `CI=1` forces fresh servers; without it, Playwright reuses servers you already have running.

- [ ] **Step 5: Prove it bites (then undo)**

In `src/web/screens/Rank.tsx`, temporarily change `answer('better')` on the `pick-new` button to `answer('worse')`.
Run: `CI=1 npm run e2e`
Expected: FAIL in step "confirm the place and see the score" (Outer Wilds no longer lands at 10.0). Revert with `git checkout src/web/screens/Rank.tsx`.

- [ ] **Step 6: CI and README**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: test-results/
          retention-days: 7
```

`README.md`:

```markdown
# versus

Rank the games you've played with head-to-head questions; get a predicted rank, with reasons, for
the ones you haven't. A single-user installable web app (PWA) on Cloudflare's free tier.

- Design: [`docs/specs/2026-10-06-versus-design.md`](docs/specs/2026-10-06-versus-design.md)
- Implementation plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)

## Layout

| Folder | What lives there |
|---|---|
| `src/core/` | pure TypeScript: ranking engine, recommender, catalog normalization (no network, no DOM, no database) |
| `src/worker/` | the Cloudflare Worker: API routes, auth, SQL, IGDB and Steam clients |
| `src/web/` | the PWA: React screens, data store, service worker, manifest, icons |
| `migrations/` | the D1 (SQLite) schema |
| `scripts/` | command-line tools: eval, restore, fixture capture, .dev.vars setup |
| `tests/` | `core/`, `web/` and `worker/` unit tests, `e2e/` (Playwright), `fixtures/` (public game data + synthetic data only) |

## First-time setup (Windows, PowerShell or Git Bash)

```bash
npm ci                     # install the pinned tools
npm run dev-vars           # writes .dev.vars (local Worker secrets) from .env; both are git-ignored
npm run db:migrate:local   # creates the local D1 database under .wrangler/
```

## Everyday commands

```bash
npm run dev                # build the web app, then serve app + API on http://127.0.0.1:8787 (local D1)
npm run dev:web            # hot-reloading web app on http://localhost:5173; run `npm run dev:worker` alongside
npm test                   # core + web unit tests, then Worker tests (in Cloudflare's local runtime)
npm run typecheck          # TypeScript for core, web and scripts, then for the Worker
npm run e2e                # Playwright journey on a phone viewport, against fake IGDB/Steam
npm run eval -- exports/<file>.json    # offline recommender evaluation on an export
```

The first `npm run e2e` needs a browser: `npx playwright install chromium`.

## Never commit

`.env`, `.dev.vars`, exports (`exports/`, `*.export.json`), restore `.sql` files, or any fixture with
playtimes or a Steam id. This repository is public.
```

- [ ] **Step 7: Full check, commit, push**

Run: `npm run typecheck && npm test`
Expected: core + web `Tests 146 passed`, Worker `Tests 55 passed`.

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e .github/workflows/ci.yml README.md
git commit -m "test(e2e): phone-viewport journey against wrangler dev and fake upstreams; CI job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin p5-pwa
gh run watch --exit-status
```

Expected: both CI jobs (`test`, `e2e`) green. Merge per `superpowers:finishing-a-development-branch`.
