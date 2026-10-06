# versus Plan 1 — Foundation + Ranking Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the npm project with its toolchain and CI, and build the pure ranking engine: binary-insertion steps, order derivation from the event log, and 0–10 scores.

**Architecture:** One npm package. Everything here lives in `src/core/`, which is pure TypeScript: no network, no DOM, no database. A test enforces that rule. The ranked order is a pure function of an append-only event log (`replay`). `step` decides the next question from a session's answers. `scores` maps positions to fixed per-bucket bands.

**Tech Stack:** TypeScript 6.0.3 (strict), Vitest 4.1.11, Node ≥ 24 (dev machine: Node 26), GitHub Actions.

**Spec:** `docs/specs/2026-10-06-versus-design.md` §3 (layout, boundary rule), §4 (interfaces), §5 (event payloads), §6 (ranking engine), §11 (ranking tests).
**Roadmap:** `docs/superpowers/plans/2026-10-06-versus-v1-roadmap.md`. This is Plan 1 of 6.

## Global Constraints

- TypeScript strict everywhere. Code stays plain and commented for a learner (spec §3, Bruno's stated level).
- One npm package. Pin exact versions (`npm install --save-exact`).
- **Boundary rule:** nothing under `src/core/` may import from `worker/` or `web/`, import any npm package, or use `fetch`, the DOM or D1. `tests/boundary.test.ts` checks this.
- The app repo `BrunoBensadon/versus` is **public**. Never commit `.env`, `.dev.vars`, exports, or fixtures with personal data (playtimes, Steam id, last-played dates).
- Vitest is pinned to **4.1.11**, not 5.x. Plan 4's Cloudflare test pool (`@cloudflare/vitest-pool-workers@0.22.0`) requires `vitest ^4.1.0` (✅ verified 2026-10-06).
- TypeScript is pinned to **6.0.3**. 7.x (the native port) is the current release, but it was not tried with this toolchain (⚠️ assumption that 7.x would cause friction; revisit later).
- Event types and payloads are exactly spec §5. Buckets: `loved | liked | disliked`. Statuses: `inbox | wishlist | backlog | playing | played | dropped | ignored`.
- Score bands: loved [6.7, 10.0] · liked [3.4, 6.6] · disliked [0.0, 3.3]. Shown with one decimal.
- Commits end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` | one package, scripts, pinned dev dependencies |
| `tsconfig.base.json` | compiler options shared by every tsconfig (Plans 4 and 5 add more tsconfigs) |
| `tsconfig.json` | typecheck for core, scripts and core tests (Node types) |
| `vitest.config.ts` | unit tests for the pure core |
| `.gitignore` | adds build output, local Cloudflare state, `.dev.vars`, exports, Playwright output |
| `.github/workflows/ci.yml` | typecheck + tests on every push |
| `src/core/types.ts` | shared domain types: GameMeta, events, library rows, sub-lists, export file |
| `src/core/random.ts` | seeded random numbers + shuffle (deterministic tests and evaluation) |
| `src/core/ranking/step.ts` | one binary-insertion step: ask / place / stale |
| `src/core/ranking/replay.ts` | event log → lists, open sessions, merge aliases; position helpers |
| `src/core/ranking/scores.ts` | position → 0–10 score, score → bucket |
| `src/core/ranking/index.ts` | public surface of the ranking engine |
| `tests/boundary.test.ts` | enforces the boundary rule |
| `tests/core/helpers/log.ts` | builds event logs and runs whole sessions against an oracle |
| `tests/core/ranking/*.test.ts` | step, replay, scores, and the perfect-oracle property tests |

---

### Task 1: Project scaffold, shared types, boundary rule, CI

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `.github/workflows/ci.yml`
- Modify: `.gitignore` (append a block)
- Create: `src/core/types.ts`, `src/core/random.ts`
- Test: `tests/boundary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type in `src/core/types.ts`: `GameId`, `Bucket`, `BUCKETS`, `Status`, `STATUSES`, `AnswerResult`, `SteamTag`, `TimeToBeat`, `GameMeta`, `EventBody`, `EventType`, `EVENT_TYPES`, `NewEvent`, `RankEvent`, `LibraryRow`, `SublistFilter`, `Sublist`, `ExternalId`, `ExportFile`. From `src/core/random.ts`: `seededRandom(seed: number): () => number` and `shuffled<T>(items: readonly T[], rand: () => number): T[]`. Scripts: `npm run typecheck`, `npm test`.

- [ ] **Step 1: Create a branch**

```bash
git checkout -b p1-foundation-ranking
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "versus",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Rank the games you've played, head to head; predict how you'd rank the ones you haven't.",
  "license": "MIT",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Install the pinned dev dependencies**

Run: `npm install --save-exact -D typescript@6.0.3 vitest@4.1.11 @types/node@26.6.4`
Expected: `package-lock.json` created; `package.json` gains a `devDependencies` block with those three exact versions.

- [ ] **Step 4: Write the TypeScript and Vitest configs**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`tsconfig.json` (Plans 2–3 reuse it unchanged; Plan 5 adds the DOM lib and `src/web`):

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"]
  },
  "include": ["src/core", "tests/core", "tests/fixtures", "tests/boundary.test.ts", "scripts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// Unit tests for the pure core (ranking, recommender, catalog). They run in plain Node.
export default defineConfig({
  test: {
    include: ['tests/core/**/*.test.ts', 'tests/boundary.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Append to `.gitignore`**

Add this block at the end of the existing `.gitignore` (keep everything already there):

```gitignore
# Build output and local tool state
dist/
.wrangler/
coverage/
test-results/
playwright-report/

# Local Worker secrets (copied from .env, never committed)
.dev.vars
.dev.vars.*

# Exports hold personal data (rankings, playtimes): never commit them to this PUBLIC repo
exports/
*.export.json
```

- [ ] **Step 6: Write the failing boundary test**

`tests/boundary.test.ts`:

```ts
// Boundary rule (spec §3): nothing under src/core may import from worker/ or web/, import any
// package, or use fetch, the DOM or D1. This keeps the core testable and portable.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = resolve(__dirname, '../src/core');

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const FORBIDDEN_CODE: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch'],
  [/\bdocument\./, 'the DOM (document)'],
  [/\bwindow\./, 'the DOM (window)'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bD1Database\b/, 'D1'],
];

describe('src/core boundary', () => {
  const files = tsFiles(CORE);

  it('finds the core files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = relative(CORE, file);
    it(`${name} imports only relative files inside src/core`, () => {
      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        expect(spec.startsWith('.'), `${name}: package import "${spec}"`).toBe(true);
        const target = resolve(dirname(file), spec);
        expect(target.startsWith(CORE), `${name}: "${spec}" leaves src/core`).toBe(true);
      }
    });

    it(`${name} uses no fetch, DOM or D1`, () => {
      const source = readFileSync(file, 'utf8');
      for (const [pattern, what] of FORBIDDEN_CODE) {
        expect(pattern.test(source), `${name} uses ${what}`).toBe(false);
      }
    });
  }
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run tests/boundary.test.ts`
Expected: FAIL. `readdirSync` throws `ENOENT` because `src/core` doesn't exist yet.

- [ ] **Step 8: Write the shared types and the seeded random helper**

`src/core/types.ts`:

```ts
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
```

`src/core/random.ts`:

```ts
// Deterministic random numbers, so tests and the evaluation harness give the same result every run.

/** mulberry32: a tiny seeded generator. Returns a function that yields numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle. Returns a new array; the input is not changed. */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

- [ ] **Step 9: Run the boundary test and the typecheck**

Run: `npx vitest run tests/boundary.test.ts`
Expected: PASS (5 tests: "finds the core files" + 2 per file).

Run: `npm run typecheck`
Expected: exits 0 with no output after the script banner.

- [ ] **Step 10: Prove the boundary test bites (then undo)**

Create `src/core/bad.ts` with:

```ts
import { x } from '../../worker/db';
export const y = () => fetch('http://x');
```

Run: `npx vitest run tests/boundary.test.ts`
Expected: FAIL. Two failures: `bad.ts imports only relative files inside src/core` and `bad.ts uses no fetch, DOM or D1`.

Then delete `src/core/bad.ts` and re-run. Expected: PASS.

- [ ] **Step 11: Add CI**

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
```

(Plans 4 and 5 extend the `test` script and add a Playwright job; this file stays the entry point.)

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json tsconfig.json vitest.config.ts .gitignore .github/workflows/ci.yml src/core/types.ts src/core/random.ts tests/boundary.test.ts
git commit -m "chore: scaffold npm project, shared types, boundary rule and CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Insertion step

**Files:**
- Create: `src/core/ranking/step.ts`, `src/core/ranking/index.ts`
- Test: `tests/core/ranking/step.test.ts`

**Interfaces:**
- Consumes: `GameId`, `AnswerResult` from `src/core/types.ts`.
- Produces: `interface Answer { pivot: GameId; result: AnswerResult }`, `type Step = { kind: 'ask'; pivot: GameId } | { kind: 'place'; below: GameId | null } | { kind: 'stale' }`, and `step(list: readonly GameId[], answers: readonly Answer[]): Step`, all re-exported from `src/core/ranking/index.ts`.

- [ ] **Step 1: Write the failing test**

`tests/core/ranking/step.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { step } from '../../../src/core/ranking';

describe('step', () => {
  it('places the first game of an empty bucket at the top without asking', () => {
    expect(step([], [])).toEqual({ kind: 'place', below: null });
  });

  it('asks about the middle game first', () => {
    // 5 games → candidate slots 0..5 → middle index floor(5/2) = 2
    expect(step([10, 20, 30, 40, 50], [])).toEqual({ kind: 'ask', pivot: 30 });
  });

  it('narrows to the top half after "better"', () => {
    expect(step([10, 20, 30, 40, 50], [{ pivot: 30, result: 'better' }])).toEqual({ kind: 'ask', pivot: 20 });
  });

  it('places at the very top after beating everything asked', () => {
    const answers = [
      { pivot: 30, result: 'better' as const },
      { pivot: 20, result: 'better' as const },
      { pivot: 10, result: 'better' as const },
    ];
    expect(step([10, 20, 30, 40, 50], answers)).toEqual({ kind: 'place', below: null });
  });

  it('places at the bottom after losing to everything asked', () => {
    const answers = [
      { pivot: 30, result: 'worse' as const },
      { pivot: 50, result: 'worse' as const },
    ];
    // after 30 worse: slots 3..5, mid 4 → list[4] = 50; after 50 worse: slot 5 → below 50
    expect(step([10, 20, 30, 40, 50], answers)).toEqual({ kind: 'place', below: 50 });
  });

  it('"too close" places the game directly below the pivot', () => {
    expect(step([10, 20, 30, 40, 50], [{ pivot: 30, result: 'tie' }])).toEqual({ kind: 'place', below: 30 });
  });

  it('reports stale when an answer pivot is not where it should be', () => {
    expect(step([10, 20, 99, 40, 50], [{ pivot: 30, result: 'better' }])).toEqual({ kind: 'stale' });
  });

  it('reports stale when there are more answers than the list needs', () => {
    expect(step([10], [{ pivot: 10, result: 'better' }, { pivot: 10, result: 'better' }])).toEqual({ kind: 'stale' });
  });

  it('asks at most ceil(log2(m+1)) questions', () => {
    for (const m of [1, 2, 7, 60, 100, 200]) {
      const list = Array.from({ length: m }, (_, i) => i + 1);
      // Always answer "worse" (the longest path to the bottom).
      const answers: { pivot: number; result: 'worse' }[] = [];
      for (;;) {
        const next = step(list, answers);
        if (next.kind !== 'ask') break;
        answers.push({ pivot: next.pivot, result: 'worse' });
      }
      expect(answers.length).toBeLessThanOrEqual(Math.ceil(Math.log2(m + 1)));
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/ranking/step.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/core/ranking"`.

- [ ] **Step 3: Implement**

`src/core/ranking/step.ts`:

```ts
// One step of binary insertion (spec §6.1).
// Given a bucket's order and the answers so far, decide what happens next: ask another
// question, place the game, or report that the list changed under this session.
// Undo and resume need no special code: the caller just passes fewer or the same answers.

import type { AnswerResult, GameId } from '../types';

export interface Answer {
  pivot: GameId;
  result: AnswerResult;
}

export type Step =
  | { kind: 'ask'; pivot: GameId }
  | { kind: 'place'; below: GameId | null } // null = top of the bucket
  | { kind: 'stale' }; // an answer's pivot is no longer where we expect it → restart the session

/**
 * @param list    the bucket order, best first, WITHOUT the game being ranked
 * @param answers the session's answers, oldest first, undone answers already removed
 */
export function step(list: readonly GameId[], answers: readonly Answer[]): Step {
  // Candidate insertion indexes are lo..hi (inclusive). Index i means "between list[i-1] and list[i]".
  let lo = 0;
  let hi = list.length;
  for (const a of answers) {
    if (lo >= hi) return { kind: 'stale' }; // more answers than this list needs: it must have shrunk
    const mid = Math.floor((lo + hi) / 2);
    if (list[mid] !== a.pivot) return { kind: 'stale' };
    if (a.result === 'tie') return { kind: 'place', below: list[mid] }; // "too close" (spec D7)
    if (a.result === 'better') hi = mid;
    else lo = mid + 1;
  }
  if (lo === hi) return { kind: 'place', below: lo > 0 ? list[lo - 1] : null };
  return { kind: 'ask', pivot: list[Math.floor((lo + hi) / 2)] };
}
```

`src/core/ranking/index.ts` (for now only `step`; Tasks 3 and 4 each add one line):

```ts
// Public surface of the ranking engine. Other modules import from here, not from the files inside.
export * from './step';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/core/ranking/step.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/ranking/step.ts src/core/ranking/index.ts tests/core/ranking/step.test.ts
git commit -m "feat(ranking): binary-insertion step with tie and stale handling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Order derivation (replay)

**Files:**
- Create: `src/core/ranking/replay.ts`, `tests/core/helpers/log.ts`
- Modify: `src/core/ranking/index.ts`
- Test: `tests/core/ranking/replay.test.ts`

**Interfaces:**
- Consumes: `step`, `Answer`, `Step` (Task 2); `Bucket`, `GameId`, `RankEvent`, `EventBody` (Task 1).
- Produces (from `src/core/ranking`):
  - `interface OpenSession { id: string; game: GameId; bucket: Bucket; answers: Answer[] }`
  - `interface RankState { lists: Record<Bucket, GameId[]>; openSessions: Map<string, OpenSession>; aliases: Map<GameId, GameId>; warnings: string[] }`
  - `replay(events: readonly RankEvent[]): RankState`
  - `resolve(aliases: Map<GameId, GameId>, id: GameId): GameId`
  - `positionOf(state: Pick<RankState, 'lists'>, id: GameId): { bucket: Bucket; index: number } | null`
  - `globalOrder(state: Pick<RankState, 'lists'>): GameId[]` (loved, then liked, then disliked)
  - `sessionList(state: RankState, session: OpenSession): GameId[]`
  - `sessionStep(state: RankState, sessionId: string): Step | null`
  - Test helper `tests/core/helpers/log.ts`: `class Log { events: RankEvent[]; add(body: EventBody): RankEvent }` and `rankWithOracle(log, game, bucket, prefers, session?): number`.
- Note: `warnings` is an addition to spec §4's `RankState`. A pure function can't log, so replay records its defensive fixes here and the UI can show them.

- [ ] **Step 1: Write the test helper**

`tests/core/helpers/log.ts`:

```ts
// Test helper: builds an event log the way the server would (ids and seq numbers assigned in order),
// and runs a whole ranking session against an "oracle" that knows the true preference.

import type { Bucket, EventBody, GameId, RankEvent } from '../../../src/core/types';
import { replay, sessionStep } from '../../../src/core/ranking';

export class Log {
  events: RankEvent[] = [];
  private n = 0;

  add(body: EventBody): RankEvent {
    this.n += 1;
    const event = { ...body, id: `e${this.n}`, ts: '2026-10-06T00:00:00.000Z', listId: 'global', seq: this.n } as RankEvent;
    this.events.push(event);
    return event;
  }
}

/**
 * Rank `game` into `bucket`, answering every question with `prefers(game, pivot)`.
 * Returns the number of questions asked.
 */
export function rankWithOracle(
  log: Log,
  game: GameId,
  bucket: Bucket,
  prefers: (a: GameId, b: GameId) => boolean,
  session = `s-${game}-${log.events.length}`,
): number {
  log.add({ type: 'session_started', gameId: game, data: { session, bucket } });
  let questions = 0;
  for (;;) {
    const next = sessionStep(replay(log.events), session);
    if (next === null) throw new Error('session vanished');
    if (next.kind === 'stale') throw new Error('unexpected stale session');
    if (next.kind === 'place') {
      log.add({ type: 'placed', gameId: game, data: { session, bucket, below: next.below } });
      return questions;
    }
    questions += 1;
    const result = prefers(game, next.pivot) ? 'better' : 'worse';
    log.add({ type: 'answer', gameId: game, data: { session, pivot: next.pivot, result } });
  }
}
```

- [ ] **Step 2: Write the failing test**

`tests/core/ranking/replay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { replay, sessionStep } from '../../../src/core/ranking';
import { Log } from '../helpers/log';

describe('replay', () => {
  it('builds lists from placed events, below = null meaning top', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'loved', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'loved', below: 1 } });
    log.add({ type: 'placed', gameId: 3, data: { session: 'c', bucket: 'loved', below: null } });
    expect(replay(log.events).lists).toEqual({ loved: [3, 1, 2], liked: [], disliked: [] });
  });

  it('orders by seq, not by array position', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: 1 } });
    const reversed = [...log.events].reverse();
    expect(replay(reversed).lists.liked).toEqual([1, 2]);
  });

  it('ignores events from other lists (own-criterion lists are Later)', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    const other = { ...log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: null } }), listId: 'coop' };
    expect(replay([log.events[0], other]).lists.liked).toEqual([1]);
  });

  it('re-placing a game moves it (re-rank and bucket change)', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: 1 } });
    log.add({ type: 'placed', gameId: 1, data: { session: 'c', bucket: 'loved', below: null } });
    expect(replay(log.events).lists).toEqual({ loved: [1], liked: [2], disliked: [] });
  });

  it('a game keeps its old place while a re-rank session is open', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: 1 } });
    log.add({ type: 'session_started', gameId: 1, data: { session: 'r', bucket: 'liked' } });
    const state = replay(log.events);
    expect(state.lists.liked).toEqual([1, 2]);
    // The session's list excludes the game itself: only game 2 → the first question is about 2.
    expect(sessionStep(state, 'r')).toEqual({ kind: 'ask', pivot: 2 });
  });

  it('unranked removes the game from the order', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'unranked', gameId: 1, data: {} });
    expect(replay(log.events).lists.liked).toEqual([]);
  });

  it('keeps open sessions with their non-voided answers; placed and cancelled close them', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'session_started', gameId: 2, data: { session: 'open', bucket: 'liked' } });
    log.add({ type: 'answer', gameId: 2, data: { session: 'open', pivot: 1, result: 'worse' } });
    log.add({ type: 'session_started', gameId: 3, data: { session: 'gone', bucket: 'liked' } });
    log.add({ type: 'session_cancelled', gameId: 3, data: { session: 'gone' } });
    const state = replay(log.events);
    expect([...state.openSessions.keys()]).toEqual(['open']);
    expect(state.openSessions.get('open')?.answers).toEqual([{ pivot: 1, result: 'worse' }]);
  });

  it('undo voids the latest non-voided answer, one per undo', () => {
    const log = new Log();
    for (const id of [1, 2, 3]) log.add({ type: 'placed', gameId: id, data: { session: `p${id}`, bucket: 'liked', below: id === 1 ? null : id - 1 } });
    log.add({ type: 'session_started', gameId: 9, data: { session: 's', bucket: 'liked' } });
    log.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 2, result: 'worse' } });
    log.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 3, result: 'better' } });
    log.add({ type: 'undo', gameId: 9, data: { session: 's' } });
    expect(replay(log.events).openSessions.get('s')?.answers).toEqual([{ pivot: 2, result: 'worse' }]);
    log.add({ type: 'undo', gameId: 9, data: { session: 's' } });
    log.add({ type: 'undo', gameId: 9, data: { session: 's' } }); // extra undo with nothing left: no-op
    expect(replay(log.events).openSessions.get('s')?.answers).toEqual([]);
  });

  it('undo then re-answer gives the same step as answering directly', () => {
    const direct = new Log();
    const viaUndo = new Log();
    for (const log of [direct, viaUndo]) {
      for (const id of [1, 2, 3, 4, 5]) log.add({ type: 'placed', gameId: id, data: { session: `p${id}`, bucket: 'loved', below: id === 1 ? null : id - 1 } });
      log.add({ type: 'session_started', gameId: 9, data: { session: 's', bucket: 'loved' } });
    }
    direct.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 3, result: 'better' } });
    viaUndo.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 3, result: 'worse' } });
    viaUndo.add({ type: 'undo', gameId: 9, data: { session: 's' } });
    viaUndo.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 3, result: 'better' } });
    expect(sessionStep(replay(viaUndo.events), 's')).toEqual(sessionStep(replay(direct.events), 's'));
  });

  it('detects a stale session when another placement changed the bucket', () => {
    const log = new Log();
    for (const id of [1, 2, 3]) log.add({ type: 'placed', gameId: id, data: { session: `p${id}`, bucket: 'liked', below: id === 1 ? null : id - 1 } });
    log.add({ type: 'session_started', gameId: 9, data: { session: 's', bucket: 'liked' } });
    log.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 2, result: 'better' } });
    // Meanwhile, on another device, game 8 lands at the bottom: [1, 2, 3, 8].
    // The middle (index 2) is now game 3, not game 2, so the old answer no longer fits.
    log.add({ type: 'placed', gameId: 8, data: { session: 'other', bucket: 'liked', below: 3 } });
    expect(sessionStep(replay(log.events), 's')).toEqual({ kind: 'stale' });
  });

  it('places at the bottom and warns when `below` is missing from the bucket', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: 77 } });
    const state = replay(log.events);
    expect(state.lists.liked).toEqual([1, 2]);
    expect(state.warnings).toHaveLength(1);
  });

  describe('merge', () => {
    it('into takes from\'s slot when into was unranked', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'loved', below: null } });
      log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'loved', below: 1 } });
      log.add({ type: 'placed', gameId: 3, data: { session: 'c', bucket: 'loved', below: 2 } });
      log.add({ type: 'merged', gameId: 2, data: { into: 50 } });
      const state = replay(log.events);
      expect(state.lists.loved).toEqual([1, 50, 3]);
      expect(state.aliases.get(2)).toBe(50);
    });

    it('from disappears when into is already ranked', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'loved', below: null } });
      log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'loved', below: 1 } });
      log.add({ type: 'merged', gameId: 2, data: { into: 1 } });
      expect(replay(log.events).lists.loved).toEqual([1]);
    });

    it('later events about the merged game apply to the survivor', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'loved', below: null } });
      log.add({ type: 'merged', gameId: 2, data: { into: 50 } });
      log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'loved', below: 1 } });
      expect(replay(log.events).lists.loved).toEqual([1, 50]);
    });

    it('unmerge: from comes back unranked, into keeps its slot', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: null } });
      log.add({ type: 'merged', gameId: 2, data: { into: 50 } });
      log.add({ type: 'unmerged', gameId: 2, data: { into: 50 } });
      const state = replay(log.events);
      expect(state.lists.liked).toEqual([50]);
      expect(state.aliases.size).toBe(0);
    });

    it('ignores a merge of a game into itself', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
      log.add({ type: 'merged', gameId: 1, data: { into: 1 } });
      const state = replay(log.events);
      expect(state.lists.liked).toEqual([1]);
      expect(state.warnings).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/core/ranking/replay.test.ts`
Expected: FAIL. `replay` and `sessionStep` are not exported, so the calls throw `TypeError: ... is not a function`.

- [ ] **Step 4: Implement**

`src/core/ranking/replay.ts`:

```ts
// Order derivation (spec §6.2): the ranked order is a pure function of the event log.
// Only `placed`, `unranked`, `merged` and `unmerged` move games. Answers are kept as evidence
// and to resume open sessions, but they never reorder anything by themselves.

import type { Bucket, GameId, RankEvent } from '../types';
import { step, type Answer, type Step } from './step';

export interface OpenSession {
  id: string;
  game: GameId;
  bucket: Bucket;
  answers: Answer[]; // undone answers already removed
}

export interface RankState {
  lists: Record<Bucket, GameId[]>; // best first; the canonical order
  openSessions: Map<string, OpenSession>;
  aliases: Map<GameId, GameId>; // merged-from → into
  warnings: string[]; // defensive fixes made while replaying (a pure function can't log)
}

/** Follow merge aliases to the surviving game. The hop limit protects against a cycle. */
export function resolve(aliases: Map<GameId, GameId>, id: GameId): GameId {
  let current = id;
  for (let hops = 0; hops < 10; hops++) {
    const next = aliases.get(current);
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

/** Where a game sits, or null if it isn't ranked. */
export function positionOf(state: Pick<RankState, 'lists'>, id: GameId): { bucket: Bucket; index: number } | null {
  for (const bucket of ['loved', 'liked', 'disliked'] as const) {
    const index = state.lists[bucket].indexOf(id);
    if (index !== -1) return { bucket, index };
  }
  return null;
}

/** All ranked games, best first: loved, then liked, then disliked. */
export function globalOrder(state: Pick<RankState, 'lists'>): GameId[] {
  return [...state.lists.loved, ...state.lists.liked, ...state.lists.disliked];
}

/** The list a session inserts into: its bucket's order without the game itself (re-rank case). */
export function sessionList(state: RankState, session: OpenSession): GameId[] {
  return state.lists[session.bucket].filter((id) => id !== session.game);
}

/** What the ranking screen should show next for an open session; null if the session isn't open. */
export function sessionStep(state: RankState, sessionId: string): Step | null {
  const session = state.openSessions.get(sessionId);
  if (!session) return null;
  return step(sessionList(state, session), session.answers);
}

interface SessionDraft {
  id: string;
  game: GameId;
  bucket: Bucket;
  answers: { pivot: GameId; result: Answer['result']; voided: boolean }[];
}

function removeEverywhere(lists: Record<Bucket, GameId[]>, id: GameId): void {
  for (const bucket of ['loved', 'liked', 'disliked'] as const) {
    lists[bucket] = lists[bucket].filter((x) => x !== id);
  }
}

export function replay(events: readonly RankEvent[]): RankState {
  const lists: Record<Bucket, GameId[]> = { loved: [], liked: [], disliked: [] };
  const sessions = new Map<string, SessionDraft>();
  const aliases = new Map<GameId, GameId>();
  const warnings: string[] = [];

  // Own-criterion sub-lists (list_id ≠ 'global') are a Later feature; ignore their events.
  const ordered = events.filter((e) => e.listId === 'global').sort((a, b) => a.seq - b.seq);

  for (const e of ordered) {
    switch (e.type) {
      case 'session_started':
        sessions.set(e.data.session, {
          id: e.data.session,
          game: resolve(aliases, e.gameId),
          bucket: e.data.bucket,
          answers: [],
        });
        break;
      case 'answer':
        sessions.get(e.data.session)?.answers.push({ pivot: e.data.pivot, result: e.data.result, voided: false });
        break;
      case 'undo': {
        const answers = sessions.get(e.data.session)?.answers ?? [];
        for (let i = answers.length - 1; i >= 0; i--) {
          if (!answers[i].voided) {
            answers[i].voided = true;
            break;
          }
        }
        break;
      }
      case 'session_cancelled':
        sessions.delete(e.data.session);
        break;
      case 'placed': {
        const game = resolve(aliases, e.gameId);
        removeEverywhere(lists, game);
        const list = lists[e.data.bucket];
        const below = e.data.below === null ? null : resolve(aliases, e.data.below);
        let index = 0;
        if (below !== null) {
          const at = list.indexOf(below);
          if (at === -1) {
            warnings.push(`seq ${e.seq}: game ${below} is not in ${e.data.bucket}; placed ${game} at the bottom`);
            index = list.length;
          } else {
            index = at + 1;
          }
        }
        list.splice(index, 0, game);
        sessions.delete(e.data.session);
        break;
      }
      case 'unranked':
        removeEverywhere(lists, resolve(aliases, e.gameId));
        break;
      case 'merged': {
        // Use the raw id: resolving it would follow an older merge of the same game.
        const from = e.gameId;
        const into = resolve(aliases, e.data.into);
        if (from === into) {
          warnings.push(`seq ${e.seq}: game ${from} merged into itself; ignored`);
          break;
        }
        const fromPos = positionOf({ lists }, from);
        aliases.set(from, into);
        if (fromPos && !positionOf({ lists }, into)) {
          lists[fromPos.bucket][fromPos.index] = into; // into takes from's slot
        } else {
          removeEverywhere(lists, from);
        }
        break;
      }
      case 'unmerged':
        // `from` comes back unranked; `into` keeps its slot.
        aliases.delete(e.gameId);
        break;
    }
  }

  const openSessions = new Map<string, OpenSession>();
  for (const s of sessions.values()) {
    openSessions.set(s.id, {
      id: s.id,
      game: resolve(aliases, s.game),
      bucket: s.bucket,
      answers: s.answers
        .filter((a) => !a.voided)
        .map((a) => ({ pivot: resolve(aliases, a.pivot), result: a.result })),
    });
  }
  return { lists, openSessions, aliases, warnings };
}
```

Add one line to `src/core/ranking/index.ts`:

```ts
// Public surface of the ranking engine. Other modules import from here, not from the files inside.
export * from './step';
export * from './replay';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/core/ranking`
Expected: PASS (replay: 16 tests; step: 9).

- [ ] **Step 6: Commit**

```bash
git add src/core/ranking/replay.ts src/core/ranking/index.ts tests/core/helpers/log.ts tests/core/ranking/replay.test.ts
git commit -m "feat(ranking): derive the order by replaying the event log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scores

**Files:**
- Create: `src/core/ranking/scores.ts`
- Modify: `src/core/ranking/index.ts`
- Test: `tests/core/ranking/scores.test.ts`

**Interfaces:**
- Consumes: `RankState` (Task 3); `BUCKETS`, `Bucket`, `GameId` (Task 1).
- Produces (from `src/core/ranking`): `interface Band { lo: number; hi: number }`, `type Bands = Record<Bucket, Band>`, `DEFAULT_BANDS`, `bucketScore(index: number, count: number, band: Band): number`, `scores(state: Pick<RankState, 'lists'>, bands?: Bands): Map<GameId, number>`, `bandOf(score: number, bands?: Bands): Bucket`, `formatScore(score: number): string`.

- [ ] **Step 1: Write the failing test**

`tests/core/ranking/scores.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bandOf, formatScore, scores } from '../../../src/core/ranking';

const lists = (loved: number[], liked: number[], disliked: number[]) => ({ lists: { loved, liked, disliked } });

describe('scores', () => {
  it('gives no scores for an empty bucket (n = 0)', () => {
    expect(scores(lists([], [], [])).size).toBe(0);
  });

  it('a single game gets the top of its band (n = 1)', () => {
    const s = scores(lists([1], [2], [3]));
    expect(s.get(1)).toBe(10.0);
    expect(s.get(2)).toBe(6.6);
    expect(s.get(3)).toBe(3.3);
  });

  it('two games get the two ends of the band (n = 2)', () => {
    const s = scores(lists([1, 2], [], []));
    expect(s.get(1)).toBe(10.0);
    expect(s.get(2)).toBeCloseTo(6.7, 10);
  });

  it('spreads positions linearly', () => {
    const s = scores(lists([], [1, 2, 3], []));
    expect(s.get(2)).toBeCloseTo(5.0, 10);
  });

  it('bandOf maps a score back to its bucket; gaps go to the lower bucket', () => {
    expect(bandOf(9)).toBe('loved');
    expect(bandOf(6.7)).toBe('loved');
    expect(bandOf(6.65)).toBe('liked');
    expect(bandOf(3.4)).toBe('liked');
    expect(bandOf(3.35)).toBe('disliked');
    expect(bandOf(0)).toBe('disliked');
  });

  it('formats with one decimal', () => {
    expect(formatScore(6.66666)).toBe('6.7');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/ranking/scores.test.ts`
Expected: FAIL. `scores` is not exported.

- [ ] **Step 3: Implement**

`src/core/ranking/scores.ts`:

```ts
// Position → 0-10 score (spec §6.3). Each bucket owns a fixed band; positions spread linearly.

import { BUCKETS, type Bucket, type GameId } from '../types';
import type { RankState } from './replay';

export interface Band {
  lo: number;
  hi: number;
}
export type Bands = Record<Bucket, Band>;

/** Spec D9: "8 means loved" stays true however many games each bucket holds. */
export const DEFAULT_BANDS: Bands = {
  loved: { lo: 6.7, hi: 10.0 },
  liked: { lo: 3.4, hi: 6.6 },
  disliked: { lo: 0.0, hi: 3.3 },
};

/** Score of position `index` (0 = best) in a bucket of `count` ranked games. */
export function bucketScore(index: number, count: number, band: Band): number {
  if (count === 1) return band.hi;
  return band.hi - ((band.hi - band.lo) * index) / (count - 1);
}

/** Scores of every ranked game. Unranked games have no entry. */
export function scores(state: Pick<RankState, 'lists'>, bands: Bands = DEFAULT_BANDS): Map<GameId, number> {
  const out = new Map<GameId, number>();
  for (const bucket of BUCKETS) {
    const list = state.lists[bucket];
    list.forEach((id, index) => out.set(id, bucketScore(index, list.length, bands[bucket])));
  }
  return out;
}

/** The bucket whose band contains a (predicted) score. Scores in the gaps go to the lower bucket. */
export function bandOf(score: number, bands: Bands = DEFAULT_BANDS): Bucket {
  if (score >= bands.loved.lo) return 'loved';
  if (score >= bands.liked.lo) return 'liked';
  return 'disliked';
}

/** Scores are shown with one decimal (spec §6.3). */
export function formatScore(score: number): string {
  return score.toFixed(1);
}
```

Final `src/core/ranking/index.ts`:

```ts
// Public surface of the ranking engine. Other modules import from here, not from the files inside.
export * from './step';
export * from './replay';
export * from './scores';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/core/ranking/scores.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/ranking/scores.ts src/core/ranking/index.ts tests/core/ranking/scores.test.ts
git commit -m "feat(ranking): position to 0-10 score in fixed bucket bands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Perfect-oracle and resume properties

This task adds no production code. It checks the engine's central promises against many random libraries (spec §11): with every answer correct, the buckets come out exactly sorted; replay has no hidden state; and a session resumes from the log alone. If any of these fails, fix `step.ts` or `replay.ts`, not the test.

**Files:**
- Test: `tests/core/ranking/oracle.test.ts`

**Interfaces:**
- Consumes: `replay`, `sessionStep` (Task 3); `seededRandom`, `shuffled` (Task 1); `Log`, `rankWithOracle` (Task 3 helper).
- Produces: nothing new.

- [ ] **Step 1: Write the test**

`tests/core/ranking/oracle.test.ts`:

```ts
// Property test: with a perfect oracle (every answer correct), insertion must produce exactly the
// true order inside each bucket, for many random libraries.

import { describe, expect, it } from 'vitest';
import { replay, sessionStep } from '../../../src/core/ranking';
import { seededRandom, shuffled } from '../../../src/core/random';
import type { Bucket } from '../../../src/core/types';
import { Log, rankWithOracle } from '../helpers/log';

describe('perfect oracle', () => {
  it('produces exactly sorted buckets for random libraries', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rand = seededRandom(seed);
      const n = 5 + Math.floor(rand() * 60);
      const utility = new Map<number, number>();
      for (let id = 1; id <= n; id++) utility.set(id, rand());
      // Bucket by utility: top 30% loved, bottom 25% disliked (the simulation's shares).
      const bucketOf = (id: number): Bucket => {
        const u = utility.get(id)!;
        return u > 0.7 ? 'loved' : u < 0.25 ? 'disliked' : 'liked';
      };
      const log = new Log();
      for (const id of shuffled([...utility.keys()], rand)) {
        rankWithOracle(log, id, bucketOf(id), (a, b) => utility.get(a)! > utility.get(b)!);
      }
      const state = replay(log.events);
      for (const bucket of ['loved', 'liked', 'disliked'] as const) {
        const expected = [...utility.keys()]
          .filter((id) => bucketOf(id) === bucket)
          .sort((a, b) => utility.get(b)! - utility.get(a)!);
        expect(state.lists[bucket]).toEqual(expected);
      }
      expect(state.openSessions.size).toBe(0);
      expect(state.warnings).toEqual([]);
    }
  });

  it('replaying any prefix of the log gives the same state as a fresh replay of that prefix', () => {
    // The app re-replays the whole log after every action; this checks that replay has no hidden
    // dependence on earlier calls (e.g. a mutated shared array).
    const log = new Log();
    const rand = seededRandom(7);
    const utility = new Map<number, number>();
    for (let id = 1; id <= 15; id++) utility.set(id, rand());
    for (const id of utility.keys()) rankWithOracle(log, id, 'liked', (a, b) => utility.get(a)! > utility.get(b)!);
    for (let k = 1; k <= log.events.length; k++) {
      const prefix = log.events.slice(0, k);
      const once = replay(prefix);
      const twice = replay(prefix);
      expect(once.lists).toEqual(twice.lists);
      expect([...once.openSessions.entries()]).toEqual([...twice.openSessions.entries()]);
    }
  });

  it('resume: a session reopened from the log continues where it stopped', () => {
    const log = new Log();
    for (const id of [1, 2, 3, 4, 5, 6, 7]) log.add({ type: 'placed', gameId: id, data: { session: `p${id}`, bucket: 'liked', below: id === 1 ? null : id - 1 } });
    log.add({ type: 'session_started', gameId: 9, data: { session: 's', bucket: 'liked' } });
    const first = sessionStep(replay(log.events), 's');
    expect(first).toEqual({ kind: 'ask', pivot: 4 });
    log.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 4, result: 'better' } });
    // "Close the app": nothing else happens. A new replay (another device, a reload) resumes.
    expect(sessionStep(replay(log.events), 's')).toEqual({ kind: 'ask', pivot: 2 });
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/core/ranking/oracle.test.ts`
Expected: PASS (3 tests). These pass immediately because Tasks 2–3 already implement the behaviour.

- [ ] **Step 3: Run the whole suite and the typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; Vitest reports `Test Files 5 passed`, `Tests 47 passed`. (47 includes the boundary test's per-file cases. The count grows as `src/core` files are added.)

- [ ] **Step 4: Commit**

```bash
git add tests/core/ranking/oracle.test.ts
git commit -m "test(ranking): perfect-oracle, replay purity and resume properties

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push the branch and check CI**

```bash
git push -u origin p1-foundation-ranking
gh run watch --exit-status
```

Expected: the CI run ends green. Merge per `superpowers:finishing-a-development-branch`.
