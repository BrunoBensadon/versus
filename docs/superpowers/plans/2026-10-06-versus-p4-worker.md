# versus Plan 4 — Worker API + D1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Cloudflare Worker that stores the append-only event log, library and sub-lists in D1 and proxies IGDB and Steam. It covers passphrase auth, Steam import, search, export, and a restore script, all tested in Cloudflare's local runtime against a real local D1.

**Architecture:** A plain `fetch` handler (`src/worker/index.ts`) checks auth once, then tries a route table built from one `routes/*.ts` module per area. SQL lives in `src/worker/db/*.ts`, one file per table group. Upstream calls go through `upstream.ts`, which retries 429s and never puts a URL in an error message, because the Steam key travels in the query string. Network access, the clock and sleeping are injected (`Deps`), so tests run against a fixture-backed fake IGDB and Steam.

**Tech Stack:** Cloudflare Workers + D1, Wrangler 4.147.0, `@cloudflare/vitest-pool-workers` 0.22.0 (runs Vitest 4.1.11 inside the local Workers runtime), `@cloudflare/workers-types` 5.20261006.1, Web Crypto (HMAC session cookie).

**Spec:** `docs/specs/2026-10-06-versus-design.md` §3–§5, §8, §10, §11 (worker tests), decisions D3–D5, D17, D20.
**Roadmap:** `docs/superpowers/plans/2026-10-06-versus-v1-roadmap.md`. This is Plan 4 of 6 and needs Plans 1–3 merged (the restore test uses Plan 2's synthetic library).

## Global Constraints

- `src/worker/` may import from `src/core/`, never the other way round. The boundary test from Plan 1 keeps checking.
- Raw SQL against D1, no ORM. **D1 allows at most 100 bound parameters per statement**, so id lists are chunked (`db/util.ts`).
- `events` is append-only. Database triggers forbid UPDATE and DELETE, and retries are idempotent on the client UUID (`ON CONFLICT(id) DO NOTHING`).
- No secret ever leaves the Worker: errors name the upstream service, never a URL; `redact()` scrubs every secret value from any error text; nothing logs a Steam URL (spec §10, NF-3).
- Auth exactly spec §10: constant-time passphrase check; cookie `HttpOnly; Secure; SameSite=Strict`, 90 days, HMAC with `SESSION_KEY`; logins refused after 5 failures in the same clock hour.
- `compatibility_date` must stay **≤ 2026-08-22**. ✅ Verified 2026-10-06: the Workers runtime bundled with `@cloudflare/vitest-pool-workers@0.22.0` refuses newer dates. Bump the date and the package together.
- Worker test isolation (✅ verified 2026-10-06): **each test file gets a fresh D1; tests inside one file share it.** Write tests that don't depend on running alone within a file (unique ids, different clock hours for rate limits).
- ⚠️ Windows path length: local D1 failed with "internal error" when the project sat in a very deep folder (> 260 characters for `.wrangler/state/...sqlite`). The repo path `C:\Users\bruno\Bensadon\side-projects\versus` is fine. Don't run this from a deeply nested worktree.
- Public repo: test fixtures hold public game data or clearly synthetic values only (`tests/fixtures/steam/owned.json` has made-up playtimes).
- Commits end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Deviations from the spec (recorded in the roadmap)

1. **Extra routes:** `POST /api/logout`, `GET /api/status` (`lastBackupAt`, `eventCount`, so Settings can show backup age without downloading an export), and `GET/PUT/DELETE /api/sublists/:id`. The spec stores sub-lists in D1 (§5) but lists no route for them.
2. **`PUT /api/library/:id` is an upsert.** It adds a searched game (source `manual`, status defaults to `wishlist`) once `POST /api/games/:id` has stored its metadata. Otherwise it returns 404.
3. **Export includes `games` and `externalIds`** as well as events, library and sub-lists, so a restore needs no IGDB calls. `root_id` is recomputed from the exported games by `canonicalWork`.
4. **Imported Steam games get `platforms: ['PC']`.** Playtime of appids that collapse into one root work is summed.

## File Structure

| File | Responsibility |
|---|---|
| `wrangler.jsonc` | Worker name, entry, compatibility date, static assets (`dist/web`), D1 binding |
| `migrations/0001_init.sql` | schema from spec §5, including the append-only triggers |
| `tsconfig.worker.json` | typecheck for Worker code + Worker tests (Workers types, no DOM) |
| `vitest.worker.config.ts` | Worker tests in the local Workers runtime, fake secrets as bindings |
| `src/worker/env.ts` | `Env` (bindings + secrets), `Deps` (fetch, clock, sleep), `Ctx` |
| `src/worker/http.ts` | `HttpError`, `json`, `readJson`, `errorResponse` (redacted), `idParam` |
| `src/worker/redact.ts` | replace every secret value in a string with `***` |
| `src/worker/auth.ts` | login + rate limit, session cookie sign/verify, backup bearer token |
| `src/worker/router.ts` | `Route` and `RouteArgs` types |
| `src/worker/index.ts` | `handle()`: auth gate + route table; the Worker's default export |
| `src/worker/validate.ts` | shared request-body checks |
| `src/worker/db/*.ts` | SQL: `util` (chunks), `kv`, `events`, `library`, `games` (+ external ids), `sublists`, `export` |
| `src/worker/routes/*.ts` | `session` (logout, status), `events`, `library` (+ sub-lists), `catalog` (search, games, import), `export` |
| `src/worker/upstream.ts` | fetch with 429 retry; errors without URLs |
| `src/worker/igdb.ts`, `src/worker/steam.ts` | IGDB (token cached in kv) and Steam clients |
| `src/worker/games.ts` | fetch games + ancestors, collapse to root, build stored rows |
| `src/worker/import.ts` | Steam import pipeline |
| `scripts/restore-sql.ts`, `scripts/restore.ts` | export → SQL for a fresh D1 (`npm run restore`) |
| `scripts/make-dev-vars.ts` | `.env` → `.dev.vars` (`npm run dev-vars`) |
| `tests/fixtures/fake-upstream.ts` | fixture-backed fake IGDB/Twitch/Steam (`fetch` replacement; Plan 5 serves it over HTTP) |
| `tests/fixtures/steam/owned.json` | synthetic GetOwnedGames response |
| `tests/worker/*.ts` | setup, helpers, one test file per task |
| `README.md` | what the repo is, setup and everyday commands |

---

### Task 1: Toolchain, schema, auth and the request pipeline

**Files:**
- Modify: `package.json` (dev dependencies, scripts)
- Create: `wrangler.jsonc`, `migrations/0001_init.sql`, `tsconfig.worker.json`, `vitest.worker.config.ts`
- Create: `src/worker/env.ts`, `src/worker/http.ts`, `src/worker/redact.ts`, `src/worker/auth.ts`, `src/worker/router.ts`, `src/worker/db/kv.ts`, `src/worker/routes/session.ts`, `src/worker/index.ts`
- Create: `tests/fixtures/fake-upstream.ts`, `tests/fixtures/steam/owned.json`, `tests/worker/apply-migrations.ts`, `tests/worker/env.d.ts`, `tests/worker/helpers.ts`
- Test: `tests/worker/schema.test.ts`, `tests/worker/auth.test.ts`

**Interfaces:**
- Consumes: Plan 1 types; Plan 3 fixtures (`tests/fixtures/igdb/*.json`, `tests/fixtures/steam/{get-items,tag-list}.json`).
- Produces:
  - `interface Env { DB: D1Database; APP_PASSPHRASE; SESSION_KEY; BACKUP_TOKEN; TWITCH_CLIENT_ID; TWITCH_CLIENT_SECRET; STEAM_API_KEY; STEAM_ID64; IGDB_BASE_URL?; TWITCH_TOKEN_URL?; STEAM_BASE_URL? }` (all strings except DB)
  - `interface Deps { fetch: typeof fetch; now: () => Date; sleep: (ms: number) => Promise<void> }`, `realDeps`, `interface Ctx { env: Env; deps: Deps }`
  - `class HttpError(status: number, message: string)`, `json(body, status?, headers?)`, `readJson(req)`, `errorResponse(e, env)`, `idParam(raw): number`
  - `redact(text: string, env: Env): string`
  - `COOKIE_NAME = 'versus_session'`, `login(passphrase: unknown, ctx): Promise<string>` (the Set-Cookie value), `hasValidSession(req, ctx)`, `hasBackupToken(req, ctx)`, `constantTimeEqual(a, b)`, `makeSessionCookie(ctx)`, `CLEAR_COOKIE`
  - `interface RouteArgs { req; url; ctx; params: string[]; nowIso: string; viaBackupToken: boolean }`, `interface Route { method; path: RegExp; run(args): Promise<Response> }`
  - `kvGet(db, key, nowIso): Promise<string | null>`, `kvPut(db, key, value, expiresAt?)`, `kvDelete(db, key)`
  - `handle(req: Request, env: Env, deps?: Deps): Promise<Response>`
  - Test helpers: `NOW`, `testDeps(overrides?)`, `call(path, init?, deps?)`, `loginCookie(deps?)`, `newEvent(body)`; `fakeUpstream(input, init?)`
- HTTP: `POST /api/login {passphrase}` → `{ok: true}` + cookie; 401 wrong passphrase; 429 after 5 failures in the hour. `POST /api/logout`. `GET /api/status` → `{lastBackupAt: string | null, eventCount: number}`. Every `/api/*` route except login → 401 without a session. Non-`/api` paths → 404.

- [ ] **Step 1: Create a branch and install the Worker toolchain**

```bash
git checkout main && git pull && git checkout -b p4-worker
npm install --save-exact -D wrangler@4.147.0 @cloudflare/vitest-pool-workers@0.22.0 @cloudflare/workers-types@5.20261006.1
```

Expected: the three packages appear in `devDependencies`. `npm` may print audit warnings about wrangler's transitive dependencies. They are dev-only tools; note them, don't `npm audit fix --force`.

Then set the scripts block of `package.json` to:

```json
  "scripts": {
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.worker.json",
    "test": "vitest run && vitest run -c vitest.worker.config.ts",
    "test:worker": "vitest run -c vitest.worker.config.ts",
    "eval": "tsx scripts/eval.ts",
    "capture-fixtures": "tsx scripts/capture-fixtures.ts"
  }
```

- [ ] **Step 2: Write the Worker config, schema and test setup**

`wrangler.jsonc`:

```jsonc
// Cloudflare Worker config (spec §3, §10). Docs: https://developers.cloudflare.com/workers/wrangler/configuration/
{
  "name": "versus",
  "main": "src/worker/index.ts",
  // Must be ≤ 2026-08-22: the Workers runtime bundled with @cloudflare/vitest-pool-workers@0.22.0
  // refuses newer dates (verified 2026-10-06). Bump it together with that package.
  "compatibility_date": "2026-08-15",
  // The built PWA (npm run build → dist/web). Only /api/* runs the Worker; every other path is a
  // static file, and unknown paths fall back to index.html (the app uses hash routes).
  "assets": {
    "directory": "./dist/web",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "versus",
      // Placeholder for local dev and tests. Plan 6 replaces it with the id from `wrangler d1 create versus`.
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ],
  "observability": { "enabled": true }
}
```

`migrations/0001_init.sql`:

```sql
-- versus schema v1 (spec §5).

-- The crown jewels. Append-only: the triggers below forbid UPDATE and DELETE.
CREATE TABLE events (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,      -- total order of the log
  id       TEXT    NOT NULL UNIQUE,                -- client-generated UUID → idempotent retries
  ts       TEXT    NOT NULL,                       -- ISO-8601 UTC, client clock
  list_id  TEXT    NOT NULL DEFAULT 'global',      -- reserved for own-criterion sub-lists (Later)
  type     TEXT    NOT NULL CHECK (type IN ('session_started','answer','undo','session_cancelled',
                                              'placed','unranked','merged','unmerged')),
  game_id  INTEGER NOT NULL,                       -- the game being ranked / merged-from
  data     TEXT    NOT NULL DEFAULT '{}'           -- JSON payload (spec §5 table)
);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TABLE games (
  id         INTEGER PRIMARY KEY,                  -- IGDB id
  root_id    INTEGER NOT NULL,                     -- canonicalWork(id); equals id for root works
  meta       TEXT    NOT NULL,                     -- JSON GameMeta
  fetched_at TEXT    NOT NULL
);

CREATE TABLE external_ids (
  source  TEXT    NOT NULL,                        -- 'steam'
  uid     TEXT    NOT NULL,                        -- Steam appid
  game_id INTEGER NOT NULL,                        -- canonical id
  PRIMARY KEY (source, uid)
);

CREATE TABLE library (
  game_id            INTEGER PRIMARY KEY,          -- canonical id
  status             TEXT    NOT NULL CHECK (status IN ('inbox','wishlist','backlog','playing','played','dropped','ignored')),
  bucket             TEXT    CHECK (bucket IN ('loved','liked','disliked')),
  platforms          TEXT    NOT NULL DEFAULT '[]', -- JSON string[]
  source             TEXT    NOT NULL CHECK (source IN ('steam','manual')),
  steam_playtime_min INTEGER,
  added_at           TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

CREATE TABLE sublists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('filter','set')),
  filter     TEXT,                                 -- JSON SublistFilter when kind = 'filter'
  created_at TEXT NOT NULL
);

CREATE TABLE sublist_items (
  sublist_id TEXT    NOT NULL,
  game_id    INTEGER NOT NULL,
  PRIMARY KEY (sublist_id, game_id)
);

CREATE TABLE kv (                                  -- IGDB token, last_backup_at, login failure counters
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at TEXT
);
```

`tsconfig.worker.json` (it lists files from later tasks; a listed file that doesn't exist yet is simply skipped):

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers/types"],
    "resolveJsonModule": true
  },
  "include": ["src/worker", "src/core", "tests/worker", "tests/fixtures/fake-upstream.ts", "tests/fixtures/synthetic.ts", "scripts/restore-sql.ts"]
}
```

`vitest.worker.config.ts`:

```ts
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Worker tests run inside Cloudflare's local Workers runtime with a real local D1 (spec §11).
// Each test FILE gets a fresh database; tests inside one file share it.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Fake secrets for tests only. The Steam key looks like a real one so redaction is tested.
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_PASSPHRASE: 'test-passphrase',
            SESSION_KEY: 'test-session-key',
            BACKUP_TOKEN: 'test-backup-token',
            TWITCH_CLIENT_ID: 'test-twitch-client',
            TWITCH_CLIENT_SECRET: 'test-twitch-secret',
            STEAM_API_KEY: 'TESTSTEAMKEY0123456789ABCDEF',
            STEAM_ID64: '76561190000000000',
          },
        },
      }),
    ],
    test: {
      include: ['tests/worker/**/*.test.ts'],
      setupFiles: ['./tests/worker/apply-migrations.ts'],
    },
  };
});
```

`tests/worker/apply-migrations.ts`:

```ts
// Runs before every Worker test file: create the schema in that file's fresh D1 database.
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`tests/worker/env.d.ts`:

```ts
// Tells TypeScript what `env` from "cloudflare:workers" contains inside the Worker tests.
import type { D1Migration } from 'cloudflare:test';
import type { Env as AppEnv } from '../../src/worker/env';

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
```

- [ ] **Step 3: Add the fake upstream and the synthetic owned-games fixture**

`tests/fixtures/steam/owned.json`:

```json
{
  "_comment": "SYNTHETIC GetOwnedGames response for tests. Real appids and names; the playtimes are made up. Never replace with real output: the repo is public.",
  "response": {
    "game_count": 8,
    "games": [
      { "appid": 753640, "name": "Outer Wilds", "playtime_forever": 1200 },
      { "appid": 1145360, "name": "Hades", "playtime_forever": 3000 },
      { "appid": 7670, "name": "BioShock", "playtime_forever": 600 },
      { "appid": 409710, "name": "BioShock Remastered", "playtime_forever": 300 },
      { "appid": 489830, "name": "The Elder Scrolls V: Skyrim Special Edition", "playtime_forever": 5000 },
      { "appid": 271590, "name": "Grand Theft Auto V Legacy", "playtime_forever": 2000 },
      { "appid": 3240220, "name": "Grand Theft Auto V Enhanced", "playtime_forever": 100 },
      { "appid": 431960, "name": "Wallpaper Engine", "playtime_forever": 50 }
    ]
  }
}
```

`tests/fixtures/fake-upstream.ts`:

```ts
// A fake IGDB + Twitch + Steam that answers from the captured fixtures. Used as `deps.fetch` in the
// Worker tests, and served over HTTP for the end-to-end tests (Plan 5, tests/e2e/fake-upstream-server.ts).
// It recognizes requests by path and query text, the same way the real APIs would be called.

import externalSteam from './igdb/external-steam.json';
import games from './igdb/games.json';
import searchHades from './igdb/search-hades.json';
import searchOuterWild from './igdb/search-outer-wild.json';
import timeToBeat from './igdb/time-to-beat.json';
import getItems from './steam/get-items.json';
import owned from './steam/owned.json';
import tagList from './steam/tag-list.json';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Numbers inside the first "(...)" after `field =` in an APICalypse query. */
function listAfter(query: string, field: string): string[] {
  const m = query.match(new RegExp(`${field} = \\(([^)]*)\\)`));
  return m ? m[1].split(',').map((s) => s.replace(/"/g, '').trim()) : [];
}

async function igdb(endpoint: string, query: string): Promise<Response> {
  if (endpoint === 'games') {
    const search = query.match(/^search "([^"]*)"/);
    if (search) {
      const q = search[1].toLowerCase();
      if (q.includes('hades')) return json(searchHades);
      if (q.includes('outer wild')) return json(searchOuterWild);
      return json([]);
    }
    const ids = listAfter(query, 'id').map(Number);
    return json(games.filter((g) => ids.includes(g.id)));
  }
  if (endpoint === 'external_games') {
    const uids = listAfter(query, 'uid');
    if (uids.length > 0) return json(externalSteam.filter((e) => uids.includes(e.uid)));
    const game = Number(query.match(/game = (\d+)/)?.[1]);
    return json(externalSteam.filter((e) => e.game === game));
  }
  if (endpoint === 'game_time_to_beats') {
    const ids = listAfter(query, 'game_id').map(Number);
    return json(timeToBeat.filter((t) => ids.includes(t.game_id)));
  }
  return json({ message: `fake IGDB has no ${endpoint}` }, 404);
}

function steam(url: URL): Response {
  if (url.pathname.includes('GetOwnedGames')) return json(owned);
  if (url.pathname.includes('GetTagList')) return json(tagList);
  if (url.pathname.includes('GetItems')) {
    const input = JSON.parse(url.searchParams.get('input_json') ?? '{}') as { ids?: { appid: number }[] };
    const wanted = new Set((input.ids ?? []).map((i) => i.appid));
    return json({ response: { store_items: getItems.response.store_items.filter((i) => wanted.has(i.appid)) } });
  }
  return json({ message: 'fake Steam: unknown endpoint' }, 404);
}

/** Drop-in replacement for fetch() that never touches the network. */
export async function fakeUpstream(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.pathname.endsWith('/oauth2/token')) {
    return json({ access_token: 'fake-igdb-token', expires_in: 5_184_000, token_type: 'bearer' });
  }
  const igdbEndpoint = url.pathname.match(/\/v4\/([a-z_]+)$/)?.[1];
  if (igdbEndpoint) return igdb(igdbEndpoint, await request.text());
  if (url.pathname.startsWith('/IPlayerService/') || url.pathname.startsWith('/IStore')) return steam(url);
  return json({ message: `fake upstream: no route for ${url.pathname}` }, 404);
}
```

- [ ] **Step 4: Write the test helpers and the failing tests**

`tests/worker/helpers.ts`:

```ts
// Helpers for the Worker tests: call a route, log in, build events.
import { env } from 'cloudflare:workers';
import type { EventBody, NewEvent } from '../../src/core/types';
import type { Deps } from '../../src/worker/env';
import { handle } from '../../src/worker/index';
import { fakeUpstream } from '../fixtures/fake-upstream';

export const NOW = new Date('2026-10-06T12:00:00.000Z');

/** Fake outside world: fixtures instead of the network, a fixed clock, no real waiting. */
export function testDeps(overrides: Partial<Deps> = {}): Deps {
  return { fetch: fakeUpstream as typeof fetch, now: () => NOW, sleep: async () => {}, ...overrides };
}

export async function call(
  path: string,
  init: RequestInit & { cookie?: string } = {},
  deps: Deps = testDeps(),
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return handle(new Request(`https://versus.test${path}`, { ...init, headers }), env, deps);
}

/** Log in and return the `name=value` part of the session cookie. */
export async function loginCookie(deps: Deps = testDeps()): Promise<string> {
  const res = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: env.APP_PASSPHRASE }) }, deps);
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return res.headers.get('set-cookie')!.split(';')[0];
}

let counter = 0;
/** A NewEvent with a unique id. */
export function newEvent(body: EventBody): NewEvent {
  counter += 1;
  return { ...body, id: `test-${counter}-${Math.random().toString(36).slice(2)}`, ts: NOW.toISOString(), listId: 'global' };
}
```

`tests/worker/schema.test.ts`:

```ts
// The database schema and the request pipeline, before any feature route exists.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../../src/worker/http';
import { call, loginCookie } from './helpers';

describe('schema', () => {
  it('creates every table', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(['events', 'external_ids', 'games', 'kv', 'library', 'sublist_items', 'sublists']);
  });

  it('refuses UPDATE and DELETE on events (append-only triggers)', async () => {
    await env.DB.prepare("INSERT INTO events (id, ts, type, game_id) VALUES ('raw-1', 'x', 'unranked', 1)").run();
    await expect(env.DB.prepare("UPDATE events SET game_id = 2 WHERE id = 'raw-1'").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM events WHERE id = 'raw-1'").run()).rejects.toThrow(/append-only/);
  });

  it('rejects an unknown event type at the database level', async () => {
    await expect(env.DB.prepare("INSERT INTO events (id, ts, type, game_id) VALUES ('raw-2', 'x', 'deleted', 1)").run()).rejects.toThrow();
  });
});

describe('request pipeline', () => {
  it('answers 404 outside /api', async () => {
    expect((await call('/index.html')).status).toBe(404);
  });

  it('answers 401 for an unknown /api route without a session, 404 with one', async () => {
    expect((await call('/api/nope')).status).toBe(401);
    const cookie = await loginCookie();
    const res = await call('/api/nope', { cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no route for GET /api/nope' });
  });

  it('redacts secrets from unexpected error messages', async () => {
    const res = errorResponse(new Error(`boom at ?key=${env.STEAM_API_KEY}&steamid=${env.STEAM_ID64}`), env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom at ?key=***&steamid=***' });
  });
});
```

`tests/worker/auth.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, loginCookie, NOW, testDeps } from './helpers';

const PROTECTED: [string, string][] = [
  ['GET', '/api/events'],
  ['POST', '/api/events'],
  ['GET', '/api/library'],
  ['PUT', '/api/library/1'],
  ['GET', '/api/search?q=hades'],
  ['POST', '/api/import/steam'],
  ['POST', '/api/games/1'],
  ['GET', '/api/export'],
  ['GET', '/api/status'],
  ['GET', '/api/sublists'],
  ['PUT', '/api/sublists/x'],
  ['DELETE', '/api/sublists/x'],
  ['POST', '/api/logout'],
];

describe('auth', () => {
  it.each(PROTECTED)('%s %s needs the session cookie', async (method, path) => {
    const res = await call(path, { method, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
    expect(res.status).toBe(401);
  });

  it('logs in with the passphrase and sets a hardened 90-day cookie', async () => {
    const res = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: env.APP_PASSPHRASE }) });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^versus_session=\d+\.[\w-]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=7776000');
  });

  it('accepts the cookie on protected routes', async () => {
    const cookie = await loginCookie();
    expect((await call('/api/status', { cookie })).status).toBe(200);
  });

  it('rejects a tampered or expired cookie', async () => {
    const cookie = await loginCookie();
    const tampered = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await call('/api/status', { cookie: tampered })).status).toBe(401);
    const later = testDeps({ now: () => new Date(NOW.getTime() + 91 * 24 * 3600 * 1000) });
    expect((await call('/api/status', { cookie }, later)).status).toBe(401);
  });

  it('refuses logins after 5 failures in the same hour, and recovers the next hour', async () => {
    // Use a different hour than the other tests so their logins don't interfere.
    const hour = testDeps({ now: () => new Date('2026-10-07T09:15:00.000Z') });
    for (let i = 0; i < 5; i++) {
      const res = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: 'nope' }) }, hour);
      expect(res.status).toBe(401);
    }
    const blocked = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: env.APP_PASSPHRASE }) }, hour);
    expect(blocked.status).toBe(429);
    const nextHour = testDeps({ now: () => new Date('2026-10-07T10:01:00.000Z') });
    const ok = await call('/api/login', { method: 'POST', body: JSON.stringify({ passphrase: env.APP_PASSPHRASE }) }, nextHour);
    expect(ok.status).toBe(200);
  });

  it('logout clears the cookie', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/logout', { method: 'POST', cookie });
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npm run test:worker`
Expected: FAIL. `tests/worker/helpers.ts` can't resolve `../../src/worker/index`, so both files error before any test runs.

- [ ] **Step 6: Implement the pipeline**

`src/worker/env.ts`:

```ts
// What the Worker receives from Cloudflare: the D1 binding and the secrets (spec §10).
// Secrets are set with `wrangler secret put NAME` in production and come from .dev.vars locally.

export interface Env {
  DB: D1Database;
  APP_PASSPHRASE: string;
  SESSION_KEY: string; // HMAC key for the session cookie
  BACKUP_TOKEN: string; // bearer token the nightly backup job uses for GET /api/export
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  STEAM_API_KEY: string;
  STEAM_ID64: string;
  // Optional overrides so end-to-end tests can point the Worker at fake upstreams.
  IGDB_BASE_URL?: string; // default https://api.igdb.com/v4
  TWITCH_TOKEN_URL?: string; // default https://id.twitch.tv/oauth2/token
  STEAM_BASE_URL?: string; // default https://api.steampowered.com
}

/** Things the Worker gets from the outside world, injectable so tests can fake them. */
export interface Deps {
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export const realDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Everything a route handler needs. */
export interface Ctx {
  env: Env;
  deps: Deps;
}
```

`src/worker/redact.ts`:

```ts
// Never let a secret leave the Worker in an error message or a log line (spec §10, NF-3).

import type { Env } from './env';

const SECRET_KEYS = [
  'APP_PASSPHRASE', 'SESSION_KEY', 'BACKUP_TOKEN', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'STEAM_API_KEY', 'STEAM_ID64',
] as const;

export function redact(text: string, env: Env): string {
  let out = text;
  for (const key of SECRET_KEYS) {
    const value = env[key];
    if (value && value.length >= 4) out = out.split(value).join('***');
  }
  return out;
}
```

`src/worker/http.ts`:

```ts
// Small HTTP helpers shared by the routes.

import type { Env } from './env';
import { redact } from './redact';

/** Throw this from a route to answer with a specific status and message. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'request body must be JSON');
  }
}

/** Turn any thrown error into a JSON response. Secrets are scrubbed from the message (spec §10). */
export function errorResponse(e: unknown, env: Env): Response {
  if (e instanceof HttpError) return json({ error: redact(e.message, env) }, e.status);
  const message = e instanceof Error ? e.message : String(e);
  console.error('unhandled error:', redact(message, env));
  return json({ error: redact(message, env) }, 500);
}

/** Parse a positive integer path segment such as the :id in /api/games/:id. */
export function idParam(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id must be a positive integer');
  return id;
}
```

`src/worker/db/kv.ts`:

```ts
// SQL for the small key-value table: IGDB token, last_backup_at, login failure counters.

export async function kvGet(db: D1Database, key: string, nowIso: string): Promise<string | null> {
  const r = await db.prepare('SELECT value, expires_at FROM kv WHERE key = ?').bind(key).first<{ value: string; expires_at: string | null }>();
  if (!r || (r.expires_at !== null && r.expires_at <= nowIso)) return null;
  return r.value;
}

export async function kvPut(db: D1Database, key: string, value: string, expiresAt: string | null = null): Promise<void> {
  await db
    .prepare('INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
    .bind(key, value, expiresAt)
    .run();
}

export async function kvDelete(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM kv WHERE key = ?').bind(key).run();
}
```

`src/worker/auth.ts`:

```ts
// Single-user auth (spec §10, NF-4): a passphrase → an HMAC-signed session cookie valid 90 days.
// After 5 failed logins in the same clock hour, logins are refused until the next hour.

import { kvGet, kvPut } from './db/kv';
import type { Ctx } from './env';
import { HttpError } from './http';

export const COOKIE_NAME = 'versus_session';
const SESSION_SECONDS = 90 * 24 * 3600;
const MAX_FAILURES_PER_HOUR = 5;

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: string, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, encoder.encode(message));
}

/**
 * Compare two strings without leaking, through timing, how much of them matched.
 * Both are hashed first so the compared byte arrays always have the same length.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function makeSessionCookie(ctx: Ctx): Promise<string> {
  const expires = Math.floor(ctx.deps.now().getTime() / 1000) + SESSION_SECONDS;
  const signature = base64url(await hmac(ctx.env.SESSION_KEY, `v1:${expires}`));
  return `${COOKIE_NAME}=${expires}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export const CLEAR_COOKIE = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function hasValidSession(req: Request, ctx: Ctx): Promise<boolean> {
  const value = readCookie(req, COOKIE_NAME);
  if (!value) return false;
  const [expiresText, signature] = value.split('.');
  const expires = Number(expiresText);
  if (!Number.isInteger(expires) || !signature) return false;
  if (expires <= ctx.deps.now().getTime() / 1000) return false;
  const expected = base64url(await hmac(ctx.env.SESSION_KEY, `v1:${expires}`));
  return constantTimeEqual(signature, expected);
}

export async function hasBackupToken(req: Request, ctx: Ctx): Promise<boolean> {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  return constantTimeEqual(header.slice('Bearer '.length), ctx.env.BACKUP_TOKEN);
}

/** POST /api/login. Returns the Set-Cookie value; throws 401 or 429. */
export async function login(passphrase: unknown, ctx: Ctx): Promise<string> {
  const now = ctx.deps.now();
  const hourKey = `login_failures:${now.toISOString().slice(0, 13)}`; // e.g. login_failures:2026-10-06T14
  const failures = Number((await kvGet(ctx.env.DB, hourKey, now.toISOString())) ?? '0');
  if (failures >= MAX_FAILURES_PER_HOUR) throw new HttpError(429, 'too many failed logins; try again next hour');
  if (typeof passphrase === 'string' && (await constantTimeEqual(passphrase, ctx.env.APP_PASSPHRASE))) {
    return makeSessionCookie(ctx);
  }
  const expiresAt = new Date(now.getTime() + 2 * 3600 * 1000).toISOString();
  await kvPut(ctx.env.DB, hourKey, String(failures + 1), expiresAt);
  throw new HttpError(401, 'wrong passphrase');
}
```

`src/worker/router.ts`:

```ts
// The shape of one API route. Each routes/*.ts file exports a list of these; index.ts tries them in order.

import type { Ctx } from './env';

export interface RouteArgs {
  req: Request;
  url: URL;
  ctx: Ctx;
  params: string[]; // the regex capture groups of `path`, e.g. the :id in /api/games/:id
  nowIso: string;
  viaBackupToken: boolean; // true when the caller used the backup bearer token instead of the cookie
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: RegExp;
  run: (args: RouteArgs) => Promise<Response>;
}
```

`src/worker/routes/session.ts`:

```ts
// POST /api/logout and GET /api/status. (POST /api/login is in index.ts: it's the only public route.)

import { CLEAR_COOKIE } from '../auth';
import { kvGet } from '../db/kv';
import { json } from '../http';
import type { Route } from '../router';

export const sessionRoutes: Route[] = [
  {
    method: 'POST',
    path: /^\/api\/logout$/,
    run: async () => json({ ok: true }, 200, { 'set-cookie': CLEAR_COOKIE }),
  },
  {
    // Settings shows lastBackupAt, in red when older than 3 days (spec §10).
    method: 'GET',
    path: /^\/api\/status$/,
    run: async ({ ctx, nowIso }) => {
      const count = await ctx.env.DB.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>();
      return json({ lastBackupAt: await kvGet(ctx.env.DB, 'last_backup_at', nowIso), eventCount: count?.n ?? 0 });
    },
  },
];
```

`src/worker/index.ts` (Tasks 2–5 each add one import and one entry to `ROUTES`):

```ts
// The Worker: a plain fetch handler with a route table (spec §3, §4). No framework.
// Only /api/* reaches this code; Cloudflare serves the PWA's static files itself (wrangler.jsonc).

import { hasBackupToken, hasValidSession, login } from './auth';
import { realDeps, type Ctx, type Deps, type Env } from './env';
import { errorResponse, HttpError, json, readJson } from './http';
import type { Route } from './router';
import { sessionRoutes } from './routes/session';

export type { Env } from './env';

const ROUTES: Route[] = [...sessionRoutes];

export async function handle(req: Request, env: Env, deps: Deps = realDeps): Promise<Response> {
  const ctx: Ctx = { env, deps };
  const url = new URL(req.url);
  try {
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'not found');

    // The only public route.
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = (await readJson(req)) as { passphrase?: unknown };
      return json({ ok: true }, 200, { 'set-cookie': await login(body.passphrase, ctx) });
    }

    // The backup job reads GET /api/export with a bearer token; everything else needs the cookie.
    const isExport = req.method === 'GET' && url.pathname === '/api/export';
    const viaBackupToken = isExport && (await hasBackupToken(req, ctx));
    if (!viaBackupToken && !(await hasValidSession(req, ctx))) throw new HttpError(401, 'log in first');

    for (const route of ROUTES) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.path);
      if (match) {
        return await route.run({ req, url, ctx, params: match.slice(1), nowIso: deps.now().toISOString(), viaBackupToken });
      }
    }
    throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
  } catch (e) {
    return errorResponse(e, env);
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: Run the tests and both typechecks**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm run test:worker`
Expected: PASS: `Test Files 2 passed`, `Tests 24 passed`. The first run takes ~10 s while the local Workers runtime starts.

Run: `npm test`
Expected: the core suite passes (135 tests), then the Worker suite (24).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json wrangler.jsonc migrations tsconfig.worker.json vitest.worker.config.ts src/worker tests/worker tests/fixtures/fake-upstream.ts tests/fixtures/steam/owned.json
git commit -m "feat(worker): D1 schema, passphrase auth and request pipeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Event log routes

**Files:**
- Create: `src/worker/validate.ts`, `src/worker/db/util.ts`, `src/worker/db/events.ts`, `src/worker/routes/events.ts`
- Modify: `src/worker/index.ts`
- Test: `tests/worker/events.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Route`, `json`, `readJson`, `HttpError`, helpers); `NewEvent`, `RankEvent`, `EVENT_TYPES`, `BUCKETS` (Plan 1).
- Produces:
  - `validate.ts`: `type Json`, `fail(message): never`, `isObject(x)`, `isGameId(x)`, `isText(x, max = 64)`
  - `db/util.ts`: `chunks<T>(items: T[], size: number): T[][]`, `marks(n): string`
  - `db/events.ts`: `insertEvents(db, events: NewEvent[], nowIso): Promise<RankEvent[]>` (idempotent; a `placed` event also sets `library.bucket`), `listEvents(db, since = 0): Promise<RankEvent[]>`
  - `routes/events.ts`: `parseNewEvents(body: unknown): NewEvent[]`, `eventRoutes`
- HTTP: `GET /api/events?since=<seq>` → `{events: RankEvent[]}` (seq > since, in order). `POST /api/events {events: NewEvent[]}` with 1–500 events → `{events: RankEvent[]}` (the stored rows, including ones that already existed); 400 on any malformed event. `listId` defaults to `'global'`.

- [ ] **Step 1: Write the failing test**

`tests/worker/events.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { RankEvent } from '../../src/core/types';
import { call, loginCookie, newEvent } from './helpers';

async function post(cookie: string, events: unknown[]): Promise<Response> {
  return call('/api/events', { method: 'POST', cookie, body: JSON.stringify({ events }) });
}

describe('events', () => {
  it('appends a batch and assigns increasing seq numbers', async () => {
    const cookie = await loginCookie();
    const batch = [
      newEvent({ type: 'session_started', gameId: 11737, data: { session: 's1', bucket: 'loved' } }),
      newEvent({ type: 'placed', gameId: 11737, data: { session: 's1', bucket: 'loved', below: null } }),
    ];
    const res = await post(cookie, batch);
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as { events: RankEvent[] };
    expect(events.map((e) => e.id)).toEqual(batch.map((e) => e.id));
    expect(events[1].seq).toBeGreaterThan(events[0].seq);
    expect(events[1].data).toEqual({ session: 's1', bucket: 'loved', below: null });
  });

  it('is idempotent: re-posting the same ids stores nothing new and returns the same seqs', async () => {
    const cookie = await loginCookie();
    const batch = [newEvent({ type: 'unranked', gameId: 5, data: {} })];
    const first = (await (await post(cookie, batch)).json()) as { events: RankEvent[] };
    const again = (await (await post(cookie, batch)).json()) as { events: RankEvent[] };
    expect(again.events).toEqual(first.events);
    const count = await env.DB.prepare('SELECT count(*) AS n FROM events WHERE id = ?').bind(batch[0].id).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('GET ?since returns only newer events, in order', async () => {
    const cookie = await loginCookie();
    const all = (await (await call('/api/events', { cookie })).json()) as { events: RankEvent[] };
    const last = all.events.at(-1)!.seq;
    await post(cookie, [newEvent({ type: 'unranked', gameId: 6, data: {} })]);
    const newer = (await (await call(`/api/events?since=${last}`, { cookie })).json()) as { events: RankEvent[] };
    expect(newer.events).toHaveLength(1);
    expect(newer.events[0].gameId).toBe(6);
  });

  it('a placed event updates the library bucket', async () => {
    const cookie = await loginCookie();
    await env.DB.prepare(
      "INSERT INTO library (game_id, status, bucket, platforms, source, added_at, updated_at) VALUES (77, 'played', 'liked', '[]', 'manual', 'x', 'x')",
    ).run();
    await post(cookie, [newEvent({ type: 'placed', gameId: 77, data: { session: 's77', bucket: 'loved', below: null } })]);
    const row = await env.DB.prepare('SELECT bucket FROM library WHERE game_id = 77').first<{ bucket: string }>();
    expect(row?.bucket).toBe('loved');
  });

  it.each([
    ['no events array', {}],
    ['empty batch', { events: [] }],
    ['unknown type', { events: [{ id: 'a', ts: '2026-10-06T00:00:00Z', type: 'deleted', gameId: 1, data: {} }] }],
    ['bad game id', { events: [{ id: 'a', ts: '2026-10-06T00:00:00Z', type: 'unranked', gameId: -1, data: {} }] }],
    ['bad bucket', { events: [{ id: 'a', ts: '2026-10-06T00:00:00Z', type: 'session_started', gameId: 1, data: { session: 's', bucket: 'meh' } }] }],
    ['bad date', { events: [{ id: 'a', ts: 'yesterday', type: 'unranked', gameId: 1, data: {} }] }],
  ])('rejects a malformed batch (%s) with 400', async (_name, body) => {
    const cookie = await loginCookie();
    const res = await call('/api/events', { method: 'POST', cookie, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run -c vitest.worker.config.ts tests/worker/events.test.ts`
Expected: FAIL. Every request returns 404 (`no route for POST /api/events`) instead of 200/400.

- [ ] **Step 3: Implement**

`src/worker/validate.ts`:

```ts
// Small checks shared by the request-body parsers in routes/*.ts. Anything malformed → 400.

import { HttpError } from './http';

export type Json = Record<string, unknown>;

export function fail(message: string): never {
  throw new HttpError(400, message);
}

export function isObject(x: unknown): x is Json {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isGameId(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x > 0;
}

export function isText(x: unknown, max = 64): x is string {
  return typeof x === 'string' && x.length > 0 && x.length <= max;
}
```

`src/worker/db/util.ts`:

```ts
// Helpers shared by the db/*.ts files.
// D1 allows at most 100 bound parameters per statement, so lists of ids are queried in chunks.

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** "?,?,?" for n parameters. */
export const marks = (n: number): string => Array(n).fill('?').join(',');
```

`src/worker/db/events.ts`:

```ts
// SQL for the append-only event log (spec §5).

import type { NewEvent, RankEvent } from '../../core/types';
import { chunks, marks } from './util';

interface EventRow {
  seq: number;
  id: string;
  ts: string;
  list_id: string;
  type: string;
  game_id: number;
  data: string;
}

function toEvent(r: EventRow): RankEvent {
  return { seq: r.seq, id: r.id, ts: r.ts, listId: r.list_id, type: r.type, gameId: r.game_id, data: JSON.parse(r.data) } as RankEvent;
}

/**
 * Append events. A retry with the same client UUIDs inserts nothing (idempotent).
 * A `placed` event also sets the library row's bucket (spec §5, bucket rule).
 * Returns the stored events (with their seq), in log order.
 */
export async function insertEvents(db: D1Database, events: NewEvent[], nowIso: string): Promise<RankEvent[]> {
  const statements: D1PreparedStatement[] = [];
  for (const e of events) {
    statements.push(
      db.prepare('INSERT INTO events (id, ts, list_id, type, game_id, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(e.id, e.ts, e.listId, e.type, e.gameId, JSON.stringify(e.data)),
    );
    if (e.type === 'placed') {
      statements.push(
        db.prepare('UPDATE library SET bucket = ?, updated_at = ? WHERE game_id = ?').bind(e.data.bucket, nowIso, e.gameId),
      );
    }
  }
  if (statements.length > 0) await db.batch(statements);
  const stored: RankEvent[] = [];
  for (const ids of chunks(events.map((e) => e.id), 90)) {
    const { results } = await db.prepare(`SELECT * FROM events WHERE id IN (${marks(ids.length)})`).bind(...ids).all<EventRow>();
    stored.push(...results.map(toEvent));
  }
  return stored.sort((a, b) => a.seq - b.seq);
}

export async function listEvents(db: D1Database, since = 0): Promise<RankEvent[]> {
  const { results } = await db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq').bind(since).all<EventRow>();
  return results.map(toEvent);
}
```

`src/worker/routes/events.ts`:

```ts
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
```

`src/worker/index.ts`:

```ts
// The Worker: a plain fetch handler with a route table (spec §3, §4). No framework.
// Only /api/* reaches this code; Cloudflare serves the PWA's static files itself (wrangler.jsonc).

import { hasBackupToken, hasValidSession, login } from './auth';
import { realDeps, type Ctx, type Deps, type Env } from './env';
import { errorResponse, HttpError, json, readJson } from './http';
import type { Route } from './router';
import { eventRoutes } from './routes/events';
import { sessionRoutes } from './routes/session';

export type { Env } from './env';

const ROUTES: Route[] = [...sessionRoutes, ...eventRoutes];

export async function handle(req: Request, env: Env, deps: Deps = realDeps): Promise<Response> {
  const ctx: Ctx = { env, deps };
  const url = new URL(req.url);
  try {
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'not found');

    // The only public route.
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = (await readJson(req)) as { passphrase?: unknown };
      return json({ ok: true }, 200, { 'set-cookie': await login(body.passphrase, ctx) });
    }

    // The backup job reads GET /api/export with a bearer token; everything else needs the cookie.
    const isExport = req.method === 'GET' && url.pathname === '/api/export';
    const viaBackupToken = isExport && (await hasBackupToken(req, ctx));
    if (!viaBackupToken && !(await hasValidSession(req, ctx))) throw new HttpError(401, 'log in first');

    for (const route of ROUTES) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.path);
      if (match) {
        return await route.run({ req, url, ctx, params: match.slice(1), nowIso: deps.now().toISOString(), viaBackupToken });
      }
    }
    throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
  } catch (e) {
    return errorResponse(e, env);
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:worker`
Expected: PASS: `Test Files 3 passed`, `Tests 34 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/worker tests/worker/events.test.ts
git commit -m "feat(worker): idempotent append-only event log API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Library and sub-list routes

**Files:**
- Create: `src/worker/db/library.ts`, `src/worker/db/games.ts`, `src/worker/db/sublists.ts`, `src/worker/routes/library.ts`
- Modify: `src/worker/index.ts`
- Test: `tests/worker/library.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `normalizeIgdb` (Plan 3, used by the test); `LibraryRow`, `Sublist`, `SublistFilter`, `ExternalId`, `GameMeta` (Plan 1).
- Produces:
  - `db/library.ts`: `getLibrary(db)`, `getLibraryRow(db, gameId)`, `upsertLibraryStatement(db, row)`, `upsertLibrary(db, row)`
  - `db/games.ts`: `interface GameRow { meta: GameMeta; rootId: GameId; fetchedAt: string }`, `putGameStatement(db, row)`, `getGames(db, ids?)` (root games only when `ids` is omitted), `getFetchedAt(db): Promise<Record<number, string>>`, `getGameRow(db, id)`, `putExternalIdStatement(db, x: ExternalId)`, `getExternalIds(db)`
  - `db/sublists.ts`: `getSublists(db)`, `putSublist(db, s)`, `deleteSublist(db, id)`
  - `routes/library.ts`: `interface LibraryPatch { status?; bucket?; platforms? }`, `parseLibraryPatch(body)`, `parseSublist(id, body, nowIso)`, `libraryRoutes`
- HTTP: `GET /api/library` → `{rows: LibraryRow[], games: GameMeta[], fetchedAt: Record<gameId, isoDate>}` (all stored root games; `fetchedAt` lets the PWA refresh metadata older than 30 days). `PUT /api/library/:id {status?, bucket?, platforms?}` → `{row}`; 404 if neither a row nor stored metadata exists. `GET /api/sublists` → `{sublists}` (ordered by `createdAt`, then id). `PUT /api/sublists/:id {name, kind, filter?, items?}` → `{sublist}`. `DELETE /api/sublists/:id` → `{ok: true}`.

- [ ] **Step 1: Write the failing test**

`tests/worker/library.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { normalizeIgdb } from '../../src/core/catalog';
import type { LibraryRow, Sublist } from '../../src/core/types';
import { putGameStatement } from '../../src/worker/db/games';
import games from '../fixtures/igdb/games.json';
import { call, loginCookie, NOW } from './helpers';

/** Store Outer Wilds' metadata as if POST /api/games/11737 had run (that route comes in a later task). */
async function storeOuterWilds(): Promise<void> {
  const meta = normalizeIgdb(games.find((g) => g.id === 11737));
  await putGameStatement(env.DB, { meta, rootId: meta.id, fetchedAt: NOW.toISOString() }).run();
}

describe('library', () => {
  it('starts empty', async () => {
    const cookie = await loginCookie();
    const body = await (await call('/api/library', { cookie })).json();
    expect(body).toEqual({ rows: [], games: [], fetchedAt: {} });
  });

  it('refuses to add a game whose metadata was never fetched', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify({ status: 'backlog' }) });
    expect(res.status).toBe(404);
  });

  it('adds a fetched game as a manual entry, then patches it', async () => {
    const cookie = await loginCookie();
    await storeOuterWilds();
    const add = await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify({ status: 'backlog', platforms: ['Switch'] }) });
    expect(add.status).toBe(200);
    const patch = await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify({ status: 'played', bucket: 'loved' }) });
    const { row } = (await patch.json()) as { row: LibraryRow };
    expect(row).toMatchObject({ gameId: 11737, status: 'played', bucket: 'loved', platforms: ['Switch'], source: 'manual' });

    const lib = (await (await call('/api/library', { cookie })).json()) as {
      rows: LibraryRow[];
      games: { id: number }[];
      fetchedAt: Record<number, string>;
    };
    expect(lib.rows.map((r) => r.gameId)).toEqual([11737]);
    expect(lib.games.map((g) => g.id)).toContain(11737);
    expect(lib.fetchedAt).toEqual({ 11737: NOW.toISOString() });
  });

  it('validates the patch', async () => {
    const cookie = await loginCookie();
    for (const body of [{ status: 'finished' }, { bucket: 'meh' }, { platforms: 'PC' }]) {
      const res = await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
    expect((await call('/api/library/abc', { method: 'PUT', cookie, body: '{}' })).status).toBe(400);
  });
});

describe('sub-lists', () => {
  it('saves, lists, replaces and deletes filter and set sub-lists', async () => {
    const cookie = await loginCookie();
    const put = (id: string, body: unknown) => call(`/api/sublists/${id}`, { method: 'PUT', cookie, body: JSON.stringify(body) });
    expect((await put('switch', { name: 'On Switch', kind: 'filter', filter: { platform: 'Switch' } })).status).toBe(200);
    expect((await put('coop', { name: 'Co-op nights', kind: 'set', items: [113112, 11737] })).status).toBe(200);
    expect((await put('coop', { name: 'Co-op nights', kind: 'set', items: [11737] })).status).toBe(200);

    const { sublists } = (await (await call('/api/sublists', { cookie })).json()) as { sublists: Sublist[] };
    // Ordered by creation time, then id (both were created at the same test clock time).
    expect(sublists.map((s) => [s.id, s.kind, s.items])).toEqual([
      ['coop', 'set', [11737]],
      ['switch', 'filter', []],
    ]);
    expect(sublists[1].filter).toEqual({ platform: 'Switch' });

    await call('/api/sublists/coop', { method: 'DELETE', cookie });
    const after = (await (await call('/api/sublists', { cookie })).json()) as { sublists: Sublist[] };
    expect(after.sublists.map((s) => s.id)).toEqual(['switch']);
  });

  it('validates sub-lists', async () => {
    const cookie = await loginCookie();
    const bad = [{ name: '', kind: 'set' }, { name: 'x', kind: 'smart' }, { name: 'x', kind: 'filter' }, { name: 'x', kind: 'set', items: ['a'] }];
    for (const body of bad) {
      expect((await call('/api/sublists/x', { method: 'PUT', cookie, body: JSON.stringify(body) })).status).toBe(400);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run -c vitest.worker.config.ts tests/worker/library.test.ts`
Expected: FAIL. The file can't resolve `../../src/worker/db/games`.

- [ ] **Step 3: Implement**

`src/worker/db/library.ts`:

```ts
// SQL for the library table.

import type { GameId, LibraryRow } from '../../core/types';

interface LibraryDbRow {
  game_id: number;
  status: string;
  bucket: string | null;
  platforms: string;
  source: string;
  steam_playtime_min: number | null;
  added_at: string;
  updated_at: string;
}

function toLibraryRow(r: LibraryDbRow): LibraryRow {
  return {
    gameId: r.game_id,
    status: r.status as LibraryRow['status'],
    bucket: r.bucket as LibraryRow['bucket'],
    platforms: JSON.parse(r.platforms),
    source: r.source as LibraryRow['source'],
    steamPlaytimeMin: r.steam_playtime_min,
    addedAt: r.added_at,
    updatedAt: r.updated_at,
  };
}

export async function getLibrary(db: D1Database): Promise<LibraryRow[]> {
  const { results } = await db.prepare('SELECT * FROM library ORDER BY game_id').all<LibraryDbRow>();
  return results.map(toLibraryRow);
}

export async function getLibraryRow(db: D1Database, gameId: GameId): Promise<LibraryRow | null> {
  const r = await db.prepare('SELECT * FROM library WHERE game_id = ?').bind(gameId).first<LibraryDbRow>();
  return r ? toLibraryRow(r) : null;
}

export function upsertLibraryStatement(db: D1Database, row: LibraryRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO library (game_id, status, bucket, platforms, source, steam_playtime_min, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET status = excluded.status, bucket = excluded.bucket,
         platforms = excluded.platforms, source = excluded.source,
         steam_playtime_min = excluded.steam_playtime_min, updated_at = excluded.updated_at`,
    )
    .bind(row.gameId, row.status, row.bucket, JSON.stringify(row.platforms), row.source, row.steamPlaytimeMin, row.addedAt, row.updatedAt);
}

export async function upsertLibrary(db: D1Database, row: LibraryRow): Promise<void> {
  await upsertLibraryStatement(db, row).run();
}
```

`src/worker/db/games.ts`:

```ts
// SQL for game metadata and external ids (Steam appid → canonical game).

import type { ExternalId, GameId, GameMeta } from '../../core/types';
import { chunks, marks } from './util';

export interface GameRow {
  meta: GameMeta;
  rootId: GameId;
  fetchedAt: string;
}

export function putGameStatement(db: D1Database, row: GameRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO games (id, root_id, meta, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET root_id = excluded.root_id, meta = excluded.meta, fetched_at = excluded.fetched_at`,
    )
    .bind(row.meta.id, row.rootId, JSON.stringify(row.meta), row.fetchedAt);
}

/** Root games only (the ones the app ranks and shows). With `ids`, just those. */
export async function getGames(db: D1Database, ids?: GameId[]): Promise<GameMeta[]> {
  if (!ids) {
    const { results } = await db.prepare('SELECT meta FROM games WHERE id = root_id ORDER BY id').all<{ meta: string }>();
    return results.map((r) => JSON.parse(r.meta) as GameMeta);
  }
  const out: GameMeta[] = [];
  for (const part of chunks(ids, 90)) {
    const { results } = await db.prepare(`SELECT meta FROM games WHERE id IN (${marks(part.length)})`).bind(...part).all<{ meta: string }>();
    out.push(...results.map((r) => JSON.parse(r.meta) as GameMeta));
  }
  return out;
}

/** When each root game's metadata was fetched (the PWA refreshes entries older than 30 days, spec §8). */
export async function getFetchedAt(db: D1Database): Promise<Record<number, string>> {
  const { results } = await db.prepare('SELECT id, fetched_at FROM games WHERE id = root_id').all<{ id: number; fetched_at: string }>();
  return Object.fromEntries(results.map((r) => [r.id, r.fetched_at]));
}

export async function getGameRow(db: D1Database, id: GameId): Promise<GameRow | null> {
  const r = await db.prepare('SELECT meta, root_id, fetched_at FROM games WHERE id = ?').bind(id).first<{ meta: string; root_id: number; fetched_at: string }>();
  return r ? { meta: JSON.parse(r.meta), rootId: r.root_id, fetchedAt: r.fetched_at } : null;
}

export function putExternalIdStatement(db: D1Database, x: ExternalId): D1PreparedStatement {
  return db
    .prepare('INSERT INTO external_ids (source, uid, game_id) VALUES (?, ?, ?) ON CONFLICT(source, uid) DO UPDATE SET game_id = excluded.game_id')
    .bind(x.source, x.uid, x.gameId);
}

export async function getExternalIds(db: D1Database): Promise<ExternalId[]> {
  const { results } = await db.prepare('SELECT source, uid, game_id FROM external_ids ORDER BY source, uid').all<{ source: string; uid: string; game_id: number }>();
  return results.map((r) => ({ source: r.source, uid: r.uid, gameId: r.game_id }));
}
```

`src/worker/db/sublists.ts`:

```ts
// SQL for sub-lists (spec §6.5): saved filters and hand-picked sets.

import type { Sublist, SublistFilter } from '../../core/types';

export async function getSublists(db: D1Database): Promise<Sublist[]> {
  const lists = await db.prepare('SELECT * FROM sublists ORDER BY created_at, id').all<{ id: string; name: string; kind: string; filter: string | null; created_at: string }>();
  const items = await db.prepare('SELECT sublist_id, game_id FROM sublist_items ORDER BY game_id').all<{ sublist_id: string; game_id: number }>();
  return lists.results.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind as Sublist['kind'],
    filter: s.filter === null ? null : (JSON.parse(s.filter) as SublistFilter),
    items: items.results.filter((i) => i.sublist_id === s.id).map((i) => i.game_id),
    createdAt: s.created_at,
  }));
}

export async function putSublist(db: D1Database, s: Sublist): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO sublists (id, name, kind, filter, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, filter = excluded.filter`,
    ).bind(s.id, s.name, s.kind, s.filter === null ? null : JSON.stringify(s.filter), s.createdAt),
    db.prepare('DELETE FROM sublist_items WHERE sublist_id = ?').bind(s.id),
    ...s.items.map((g) => db.prepare('INSERT INTO sublist_items (sublist_id, game_id) VALUES (?, ?)').bind(s.id, g)),
  ]);
}

export async function deleteSublist(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sublist_items WHERE sublist_id = ?').bind(id),
    db.prepare('DELETE FROM sublists WHERE id = ?').bind(id),
  ]);
}
```

`src/worker/routes/library.ts`:

```ts
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
```

`src/worker/index.ts`:

```ts
// The Worker: a plain fetch handler with a route table (spec §3, §4). No framework.
// Only /api/* reaches this code; Cloudflare serves the PWA's static files itself (wrangler.jsonc).

import { hasBackupToken, hasValidSession, login } from './auth';
import { realDeps, type Ctx, type Deps, type Env } from './env';
import { errorResponse, HttpError, json, readJson } from './http';
import type { Route } from './router';
import { eventRoutes } from './routes/events';
import { libraryRoutes } from './routes/library';
import { sessionRoutes } from './routes/session';

export type { Env } from './env';

const ROUTES: Route[] = [...sessionRoutes, ...eventRoutes, ...libraryRoutes];

export async function handle(req: Request, env: Env, deps: Deps = realDeps): Promise<Response> {
  const ctx: Ctx = { env, deps };
  const url = new URL(req.url);
  try {
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'not found');

    // The only public route.
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = (await readJson(req)) as { passphrase?: unknown };
      return json({ ok: true }, 200, { 'set-cookie': await login(body.passphrase, ctx) });
    }

    // The backup job reads GET /api/export with a bearer token; everything else needs the cookie.
    const isExport = req.method === 'GET' && url.pathname === '/api/export';
    const viaBackupToken = isExport && (await hasBackupToken(req, ctx));
    if (!viaBackupToken && !(await hasValidSession(req, ctx))) throw new HttpError(401, 'log in first');

    for (const route of ROUTES) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.path);
      if (match) {
        return await route.run({ req, url, ctx, params: match.slice(1), nowIso: deps.now().toISOString(), viaBackupToken });
      }
    }
    throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
  } catch (e) {
    return errorResponse(e, env);
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:worker`
Expected: PASS: `Test Files 4 passed`, `Tests 40 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/worker tests/worker/library.test.ts
git commit -m "feat(worker): library upsert and sub-list routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: IGDB and Steam proxy: search, fetch-a-game, Steam import

**Files:**
- Create: `src/worker/upstream.ts`, `src/worker/igdb.ts`, `src/worker/steam.ts`, `src/worker/games.ts`, `src/worker/import.ts`, `src/worker/routes/catalog.ts`
- Modify: `src/worker/index.ts`
- Test: `tests/worker/catalog.test.ts`, `tests/worker/errors.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; from Plan 3 (`src/core/catalog`): `searchQuery`, `gamesByIdQuery`, `steamExternalQuery`, `steamUidForGameQuery`, `timeToBeatQuery`, `normalizeIgdb`, `attachSteam`, `steamItemsByAppid`, `steamTagNames`, `canonicalWork`, `parentIds`, `rerankSearch`.
- Produces:
  - `fetchUpstream(ctx, label, url, init?, allow?: number[]): Promise<Response>` (retries 429 twice, sleeping 1000 then 2000 ms; throws `HttpError(502, '<label>: HTTP <status>' | '<label>: network error')`)
  - `igdbQuery(ctx, endpoint, query)`, `igdbSearch(ctx, text)`, `igdbGames(ctx, ids)`, `igdbSteamMappings(ctx, appids)`, `igdbSteamAppids(ctx, gameId)`, `igdbTimeToBeat(ctx, ids): Map<GameId, unknown>`
  - `interface OwnedGame { appid; name; playtimeMin }`, `steamOwnedGames(ctx)`, `steamStoreItems(ctx, appids): Map<number, unknown>`, `steamTagList(ctx): Map<number, string>`
  - `interface Fetched { raw; meta }`, `fetchWithAncestors(ctx, ids)`, `rootOf(fetched, id)`, `gameRows(fetched, ttb, steamItemFor, tagNames, nowIso)`, `refreshGame(ctx, id): Promise<{ requestedId; rootId; meta }>`
  - `interface ImportSummary { owned; mapped; added; updated; unmapped: { appid; name }[] }`, `importSteam(ctx)`
  - `catalogRoutes`
- HTTP: `GET /api/search?q=` (≥ 2 characters) → `{results: GameMeta[]}` reranked. `POST /api/games/:id` → `{requestedId, rootId, meta}` (root meta, with time-to-beat and Steam tags when IGDB knows a Steam appid); 404 for an unknown id. `POST /api/import/steam` → `ImportSummary`.

- [ ] **Step 1: Write the failing tests**

`tests/worker/catalog.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { GameMeta, LibraryRow } from '../../src/core/types';
import { call, loginCookie } from './helpers';

describe('search', () => {
  it('proxies IGDB and reranks: "hades" → Supergiant\'s Hades first', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/search?q=hades', { cookie });
    const { results } = (await res.json()) as { results: GameMeta[] };
    expect(results[0]).toMatchObject({ id: 113112, name: 'Hades' });
  });

  it('needs at least 2 characters', async () => {
    const cookie = await loginCookie();
    expect((await call('/api/search?q=h', { cookie })).status).toBe(400);
  });
});

describe('POST /api/games/:id', () => {
  it('collapses Skyrim Anniversary to Skyrim and stores the chain', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/games/165192', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requestedId: number; rootId: number; meta: GameMeta };
    expect(body.requestedId).toBe(165192);
    expect(body.rootId).toBe(472);
    expect(body.meta.name).toBe('The Elder Scrolls V: Skyrim');
    const rows = await env.DB.prepare('SELECT id, root_id FROM games ORDER BY id').all<{ id: number; root_id: number }>();
    expect(rows.results).toEqual([
      { id: 472, root_id: 472 },
      { id: 19457, root_id: 472 },
      { id: 165192, root_id: 472 },
    ]);
  });

  it('attaches Steam tags and time-to-beat to the root game', async () => {
    const cookie = await loginCookie();
    const { meta } = (await (await call('/api/games/113112', { method: 'POST', cookie })).json()) as { meta: GameMeta };
    expect(meta.steamTags?.[0]).toMatchObject({ tagId: 42804, name: 'Action Roguelike' });
    expect(meta.ttb?.count).toBe(13);
  });

  it('answers 404 for an id IGDB does not know', async () => {
    const cookie = await loginCookie();
    expect((await call('/api/games/999999999', { method: 'POST', cookie })).status).toBe(404);
  });
});

describe('POST /api/import/steam', () => {
  it('imports owned games as inbox rows of their root works', async () => {
    const cookie = await loginCookie();
    const res = await call('/api/import/steam', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    const summary = await res.json();
    expect(summary).toEqual({
      owned: 8,
      mapped: 7,
      added: 6,
      updated: 0,
      unmapped: [{ appid: 431960, name: 'Wallpaper Engine' }],
    });

    const { rows, games } = (await (await call('/api/library', { cookie })).json()) as { rows: LibraryRow[]; games: GameMeta[] };
    // BioShock + BioShock Remastered → 20; Skyrim SE → 472; GTA V and GTA V Enhanced stay separate.
    expect(rows.map((r) => r.gameId)).toEqual([20, 472, 1020, 11737, 113112, 334647]);
    expect(rows.every((r) => r.status === 'inbox' && r.source === 'steam')).toBe(true);
    expect(rows.find((r) => r.gameId === 20)?.steamPlaytimeMin).toBe(900); // 600 + 300
    expect(games.find((g) => g.id === 11737)?.steamTags?.length).toBe(20);
  });

  it('maps every Steam appid to its root work', async () => {
    const { results } = await env.DB.prepare("SELECT uid, game_id FROM external_ids WHERE source = 'steam' ORDER BY uid").all<{ uid: string; game_id: number }>();
    const gameOf = new Map(results.map((r) => [r.uid, r.game_id]));
    expect(gameOf.size).toBe(7);
    expect(gameOf.get('409710')).toBe(20); // BioShock Remastered → BioShock
    expect(gameOf.get('489830')).toBe(472); // Skyrim Special Edition → Skyrim
  });

  it('re-import only refreshes playtime and keeps what Bruno changed', async () => {
    const cookie = await loginCookie();
    await call('/api/library/11737', { method: 'PUT', cookie, body: JSON.stringify({ status: 'played', bucket: 'loved' }) });
    const summary = (await (await call('/api/import/steam', { method: 'POST', cookie })).json()) as { added: number; updated: number };
    expect(summary).toMatchObject({ added: 0, updated: 6 });
    const { rows } = (await (await call('/api/library', { cookie })).json()) as { rows: LibraryRow[] };
    expect(rows.find((r) => r.gameId === 11737)).toMatchObject({ status: 'played', bucket: 'loved' });
  });
});
```

`tests/worker/errors.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { fakeUpstream } from '../fixtures/fake-upstream';
import { call, loginCookie, testDeps } from './helpers';

describe('upstream errors', () => {
  it('never puts the Steam key in an error body, even when the fetch error contains the URL', async () => {
    const cookie = await loginCookie();
    const leaky = testDeps({
      fetch: (async (input: RequestInfo | URL) => {
        throw new Error(`connect failed for ${String(input)}`); // the URL includes ?key=...
      }) as typeof fetch,
    });
    const res = await call('/api/import/steam', { method: 'POST', cookie }, leaky);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(env.STEAM_API_KEY);
    expect(text).not.toContain(env.STEAM_ID64);
    expect(JSON.parse(text)).toEqual({ error: 'Steam GetOwnedGames: network error' });
  });

  it('retries a 429 twice, then succeeds', async () => {
    const cookie = await loginCookie();
    let calls = 0;
    const sleeps: number[] = [];
    const flaky = testDeps({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/v4/games') && calls++ < 2) return new Response('slow down', { status: 429 });
        return fakeUpstream(input, init);
      }) as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const res = await call('/api/search?q=hades', { cookie }, flaky);
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after the third 429', async () => {
    const cookie = await loginCookie();
    const always429 = testDeps({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/v4/games') ? new Response('', { status: 429 }) : fakeUpstream(input, init)) as typeof fetch,
    });
    const res = await call('/api/search?q=hades', { cookie }, always429);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'IGDB games: HTTP 429' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run -c vitest.worker.config.ts tests/worker/catalog.test.ts tests/worker/errors.test.ts`
Expected: FAIL. The routes return 404 (`no route for GET /api/search`, …), so status and body assertions fail.

- [ ] **Step 3: Implement the upstream clients**

`src/worker/upstream.ts`:

```ts
// Calls to IGDB, Twitch and Steam. Retries "429 Too Many Requests" twice with backoff (spec §8).
// Error messages name the service, never the URL: Steam puts the API key in the query string.

import type { Ctx } from './env';
import { HttpError } from './http';

/** `allow`: non-2xx statuses returned to the caller instead of thrown (IGDB uses it for 401). */
export async function fetchUpstream(
  ctx: Ctx,
  label: string,
  url: string,
  init: RequestInit = {},
  allow: number[] = [],
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await ctx.deps.fetch(url, init);
    } catch {
      throw new HttpError(502, `${label}: network error`);
    }
    if (res.status === 429 && attempt < 2) {
      await ctx.deps.sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok && !allow.includes(res.status)) throw new HttpError(502, `${label}: HTTP ${res.status}`);
    return res;
  }
}
```

`src/worker/igdb.ts`:

```ts
// IGDB client (spec §8). IGDB has no CORS and needs a Twitch app token, so every call goes through
// the Worker. The token (valid ~60 days) is cached in the kv table.

import {
  gamesByIdQuery, searchQuery, steamExternalQuery, steamUidForGameQuery, timeToBeatQuery,
} from '../core/catalog';
import { kvDelete, kvGet, kvPut } from './db/kv';
import { chunks } from './db/util';
import type { Ctx } from './env';
import { HttpError } from './http';
import { fetchUpstream } from './upstream';

const TOKEN_KEY = 'igdb_token';

async function token(ctx: Ctx): Promise<string> {
  const now = ctx.deps.now();
  const cached = await kvGet(ctx.env.DB, TOKEN_KEY, now.toISOString());
  if (cached) return cached;
  const params = new URLSearchParams({
    client_id: ctx.env.TWITCH_CLIENT_ID,
    client_secret: ctx.env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  const url = `${ctx.env.TWITCH_TOKEN_URL ?? 'https://id.twitch.tv/oauth2/token'}?${params}`;
  const body = (await (await fetchUpstream(ctx, 'Twitch token', url, { method: 'POST' })).json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token || !body.expires_in) throw new HttpError(502, 'Twitch token: unexpected response');
  // Refresh an hour early so a token never expires in the middle of an import.
  const expiresAt = new Date(now.getTime() + (body.expires_in - 3600) * 1000).toISOString();
  await kvPut(ctx.env.DB, TOKEN_KEY, body.access_token, expiresAt);
  return body.access_token;
}

/** POST one APICalypse query. On 401 (token revoked) fetch a new token once and retry. */
export async function igdbQuery(ctx: Ctx, endpoint: string, query: string): Promise<unknown[]> {
  const url = `${ctx.env.IGDB_BASE_URL ?? 'https://api.igdb.com/v4'}/${endpoint}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchUpstream(ctx, `IGDB ${endpoint}`, url, {
      method: 'POST',
      headers: { 'Client-ID': ctx.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${await token(ctx)}`, Accept: 'application/json' },
      body: query,
    }, [401]);
    if (res.status === 401) {
      if (attempt > 0) throw new HttpError(502, `IGDB ${endpoint}: HTTP 401`);
      await kvDelete(ctx.env.DB, TOKEN_KEY);
      continue;
    }
    return (await res.json()) as unknown[];
  }
}

export function igdbSearch(ctx: Ctx, text: string): Promise<unknown[]> {
  return igdbQuery(ctx, 'games', searchQuery(text));
}

export async function igdbGames(ctx: Ctx, ids: number[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const part of chunks(ids, 500)) out.push(...(await igdbQuery(ctx, 'games', gamesByIdQuery(part))));
  return out;
}

/** Steam appid → IGDB game id, via IGDB external_games (source 1 = Steam). */
export async function igdbSteamMappings(ctx: Ctx, appids: number[]): Promise<{ uid: string; game: number }[]> {
  const out: { uid: string; game: number }[] = [];
  for (const part of chunks(appids, 200)) {
    out.push(...((await igdbQuery(ctx, 'external_games', steamExternalQuery(part))) as { uid: string; game: number }[]));
  }
  return out;
}

export async function igdbSteamAppids(ctx: Ctx, gameId: number): Promise<number[]> {
  const rows = (await igdbQuery(ctx, 'external_games', steamUidForGameQuery(gameId))) as { uid: string }[];
  return rows.map((r) => Number(r.uid)).filter((n) => Number.isInteger(n) && n > 0);
}

/** game id → raw time-to-beat record. */
export async function igdbTimeToBeat(ctx: Ctx, ids: number[]): Promise<Map<number, unknown>> {
  const out = new Map<number, unknown>();
  for (const part of chunks(ids, 500)) {
    for (const t of (await igdbQuery(ctx, 'game_time_to_beats', timeToBeatQuery(part))) as { game_id: number }[]) {
      out.set(t.game_id, t);
    }
  }
  return out;
}
```

`src/worker/steam.ts`:

```ts
// Steam Web API client (spec §8). The key goes in the query string, so URLs are never logged and
// errors only name the endpoint (see upstream.ts).
//
// Tags come from IStoreBrowseService/GetItems, an undocumented endpoint (⚠️ spec §9). If it breaks,
// SteamSpy is the documented fallback; it is not built in v1.

import { steamItemsByAppid, steamTagNames } from '../core/catalog';
import { chunks } from './db/util';
import type { Ctx } from './env';
import { fetchUpstream } from './upstream';

function steamUrl(ctx: Ctx, path: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, key: ctx.env.STEAM_API_KEY });
  return `${ctx.env.STEAM_BASE_URL ?? 'https://api.steampowered.com'}/${path}?${q}`;
}

export interface OwnedGame {
  appid: number;
  name: string;
  playtimeMin: number;
}

export async function steamOwnedGames(ctx: Ctx): Promise<OwnedGame[]> {
  const url = steamUrl(ctx, 'IPlayerService/GetOwnedGames/v1/', {
    steamid: ctx.env.STEAM_ID64,
    include_appinfo: '1',
    include_played_free_games: '1',
  });
  const body = (await (await fetchUpstream(ctx, 'Steam GetOwnedGames', url)).json()) as {
    response?: { games?: { appid: number; name?: string; playtime_forever?: number }[] };
  };
  return (body.response?.games ?? []).map((g) => ({ appid: g.appid, name: g.name ?? `App ${g.appid}`, playtimeMin: g.playtime_forever ?? 0 }));
}

/** appid → raw store item (with up to 20 weighted user tags), 50 apps per call. */
export async function steamStoreItems(ctx: Ctx, appids: number[]): Promise<Map<number, unknown>> {
  const out = new Map<number, unknown>();
  for (const part of chunks(appids, 50)) {
    const url = steamUrl(ctx, 'IStoreBrowseService/GetItems/v1/', {
      input_json: JSON.stringify({
        ids: part.map((appid) => ({ appid })),
        context: { language: 'english', country_code: 'US' },
        data_request: { include_tag_count: 20 },
      }),
    });
    const raw = await (await fetchUpstream(ctx, 'Steam GetItems', url)).json();
    for (const [appid, item] of steamItemsByAppid(raw)) out.set(appid, item);
  }
  return out;
}

export async function steamTagList(ctx: Ctx): Promise<Map<number, string>> {
  const url = steamUrl(ctx, 'IStoreService/GetTagList/v1/', { language: 'english' });
  return steamTagNames(await (await fetchUpstream(ctx, 'Steam GetTagList', url)).json());
}
```

- [ ] **Step 4: Implement game fetching, import and the routes**

`src/worker/games.ts`:

```ts
// Fetch games from IGDB together with their edition/remaster ancestors, collapse each to its root
// work, and store them (spec §8). Used by POST /api/games/:id and by the Steam import.

import { attachSteam, canonicalWork, normalizeIgdb, parentIds } from '../core/catalog';
import type { GameId, GameMeta } from '../core/types';
import { putGameStatement, type GameRow } from './db/games';
import type { Ctx } from './env';
import { HttpError } from './http';
import { igdbGames, igdbSteamAppids, igdbTimeToBeat } from './igdb';
import { steamStoreItems, steamTagList } from './steam';

export interface Fetched {
  raw: Map<GameId, unknown>;
  meta: Map<GameId, GameMeta>;
}

/** Fetch `ids` and, up to 3 rounds deep, the ancestors canonicalWork() will want to visit. */
export async function fetchWithAncestors(ctx: Ctx, ids: GameId[]): Promise<Fetched> {
  const fetched: Fetched = { raw: new Map(), meta: new Map() };
  let wanted = [...new Set(ids)];
  for (let round = 0; round < 3 && wanted.length > 0; round++) {
    for (const raw of await igdbGames(ctx, wanted)) {
      const meta = normalizeIgdb(raw);
      fetched.raw.set(meta.id, raw);
      fetched.meta.set(meta.id, meta);
    }
    wanted = [...fetched.meta.values()].flatMap(parentIds).filter((id) => !fetched.meta.has(id));
    wanted = [...new Set(wanted)];
  }
  return fetched;
}

export function rootOf(fetched: Fetched, id: GameId): GameId {
  return canonicalWork(id, (x) => fetched.meta.get(x));
}

/**
 * Build the stored row for every fetched game. Root games get time-to-beat and Steam tags
 * (`steamItemFor` returns the store item to take tags from, or undefined).
 */
export function gameRows(
  fetched: Fetched,
  ttb: Map<GameId, unknown>,
  steamItemFor: (rootId: GameId) => unknown,
  tagNames: Map<number, string>,
  nowIso: string,
): GameRow[] {
  const rows: GameRow[] = [];
  for (const [id, raw] of fetched.raw) {
    const rootId = rootOf(fetched, id);
    let meta = normalizeIgdb(raw, ttb.get(id));
    if (id === rootId) {
      const item = steamItemFor(id);
      if (item !== undefined) meta = attachSteam(meta, item, tagNames);
    }
    rows.push({ meta, rootId, fetchedAt: nowIso });
  }
  return rows;
}

/** POST /api/games/:id: fetch-or-refresh one game (the searched game or the Refresh button). */
export async function refreshGame(ctx: Ctx, id: GameId): Promise<{ requestedId: GameId; rootId: GameId; meta: GameMeta }> {
  const nowIso = ctx.deps.now().toISOString();
  const fetched = await fetchWithAncestors(ctx, [id]);
  if (!fetched.meta.has(id)) throw new HttpError(404, `IGDB has no game ${id}`);
  const rootId = rootOf(fetched, id);
  const ttb = await igdbTimeToBeat(ctx, [rootId]);
  const appids = await igdbSteamAppids(ctx, rootId);
  let items = new Map<number, unknown>();
  let tagNames = new Map<number, string>();
  if (appids.length > 0) {
    items = await steamStoreItems(ctx, appids.slice(0, 1));
    tagNames = await steamTagList(ctx);
  }
  const rows = gameRows(fetched, ttb, () => (appids.length > 0 ? items.get(appids[0]) : undefined), tagNames, nowIso);
  await ctx.env.DB.batch(rows.map((r) => putGameStatement(ctx.env.DB, r)));
  return { requestedId: id, rootId, meta: rows.find((r) => r.meta.id === rootId)!.meta };
}
```

`src/worker/import.ts`:

```ts
// Steam import (spec §8, R-DATA-2): owned games → IGDB ids → root works → tags and time-to-beat →
// games, external_ids and library rows. New games land in `inbox`; existing rows only get their
// playtime updated. About 10 upstream requests for ~120 games (Workers limit: 50 per request).
// ⚠️ CPU: the free plan allows 10 ms CPU per request; Plan 6 measures this import with `wrangler tail`.

import type { GameId, LibraryRow } from '../core/types';
import { putExternalIdStatement, putGameStatement } from './db/games';
import { getLibrary, upsertLibraryStatement } from './db/library';
import type { Ctx } from './env';
import { fetchWithAncestors, gameRows, rootOf } from './games';
import { igdbSteamMappings, igdbTimeToBeat } from './igdb';
import { steamOwnedGames, steamStoreItems, steamTagList } from './steam';

export interface ImportSummary {
  owned: number;
  mapped: number; // owned apps that IGDB knows
  added: number; // new library rows (inbox)
  updated: number; // existing rows whose playtime was refreshed
  unmapped: { appid: number; name: string }[]; // usually software, not games
}

export async function importSteam(ctx: Ctx): Promise<ImportSummary> {
  const nowIso = ctx.deps.now().toISOString();
  const owned = await steamOwnedGames(ctx);

  // 1. appid → IGDB game (one per appid; IGDB maps 98% of Bruno's library 1:1)
  const igdbOf = new Map<number, GameId>();
  for (const m of await igdbSteamMappings(ctx, owned.map((g) => g.appid))) igdbOf.set(Number(m.uid), m.game);
  const mapped = owned.filter((g) => igdbOf.has(g.appid));

  // 2. games + ancestors → root work per appid
  const fetched = await fetchWithAncestors(ctx, [...new Set(igdbOf.values())]);
  const rootOfApp = new Map<number, GameId>();
  for (const g of mapped) {
    const igdbId = igdbOf.get(g.appid)!;
    if (fetched.meta.has(igdbId)) rootOfApp.set(g.appid, rootOf(fetched, igdbId));
  }
  const roots = [...new Set(rootOfApp.values())];

  // 3. Steam tags + time-to-beat. When two appids collapse into one root, the higher-playtime appid's tags win.
  const items = await steamStoreItems(ctx, [...rootOfApp.keys()]);
  const tagNames = await steamTagList(ctx);
  const ttb = await igdbTimeToBeat(ctx, roots);
  const appsByPlaytime = [...mapped].sort((a, b) => b.playtimeMin - a.playtimeMin);
  const itemFor = (rootId: GameId) => {
    const app = appsByPlaytime.find((g) => rootOfApp.get(g.appid) === rootId);
    return app ? items.get(app.appid) : undefined;
  };
  const rows = gameRows(fetched, ttb, itemFor, tagNames, nowIso);

  // 4. Library: playtime summed over the appids of one root.
  const playtime = new Map<GameId, number>();
  for (const g of mapped) {
    const root = rootOfApp.get(g.appid);
    if (root !== undefined) playtime.set(root, (playtime.get(root) ?? 0) + g.playtimeMin);
  }
  const existing = new Map((await getLibrary(ctx.env.DB)).map((r) => [r.gameId, r]));
  const libraryRows: LibraryRow[] = roots.map((root) => {
    const old = existing.get(root);
    if (old) return { ...old, steamPlaytimeMin: playtime.get(root) ?? 0, updatedAt: nowIso };
    return {
      gameId: root, status: 'inbox', bucket: null, platforms: ['PC'], source: 'steam',
      steamPlaytimeMin: playtime.get(root) ?? 0, addedAt: nowIso, updatedAt: nowIso,
    };
  });

  const db = ctx.env.DB;
  await db.batch([
    ...rows.map((r) => putGameStatement(db, r)),
    ...[...rootOfApp].map(([appid, gameId]) => putExternalIdStatement(db, { source: 'steam', uid: String(appid), gameId })),
    ...libraryRows.map((r) => upsertLibraryStatement(db, r)),
  ]);

  return {
    owned: owned.length,
    mapped: mapped.length,
    added: libraryRows.filter((r) => !existing.has(r.gameId)).length,
    updated: libraryRows.filter((r) => existing.has(r.gameId)).length,
    unmapped: owned.filter((g) => !igdbOf.has(g.appid)).map((g) => ({ appid: g.appid, name: g.name })),
  };
}
```

`src/worker/routes/catalog.ts`:

```ts
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
```

`src/worker/index.ts`:

```ts
// The Worker: a plain fetch handler with a route table (spec §3, §4). No framework.
// Only /api/* reaches this code; Cloudflare serves the PWA's static files itself (wrangler.jsonc).

import { hasBackupToken, hasValidSession, login } from './auth';
import { realDeps, type Ctx, type Deps, type Env } from './env';
import { errorResponse, HttpError, json, readJson } from './http';
import type { Route } from './router';
import { catalogRoutes } from './routes/catalog';
import { eventRoutes } from './routes/events';
import { libraryRoutes } from './routes/library';
import { sessionRoutes } from './routes/session';

export type { Env } from './env';

const ROUTES: Route[] = [...sessionRoutes, ...eventRoutes, ...libraryRoutes, ...catalogRoutes];

export async function handle(req: Request, env: Env, deps: Deps = realDeps): Promise<Response> {
  const ctx: Ctx = { env, deps };
  const url = new URL(req.url);
  try {
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'not found');

    // The only public route.
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = (await readJson(req)) as { passphrase?: unknown };
      return json({ ok: true }, 200, { 'set-cookie': await login(body.passphrase, ctx) });
    }

    // The backup job reads GET /api/export with a bearer token; everything else needs the cookie.
    const isExport = req.method === 'GET' && url.pathname === '/api/export';
    const viaBackupToken = isExport && (await hasBackupToken(req, ctx));
    if (!viaBackupToken && !(await hasValidSession(req, ctx))) throw new HttpError(401, 'log in first');

    for (const route of ROUTES) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.path);
      if (match) {
        return await route.run({ req, url, ctx, params: match.slice(1), nowIso: deps.now().toISOString(), viaBackupToken });
      }
    }
    throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
  } catch (e) {
    return errorResponse(e, env);
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:worker`
Expected: PASS: `Test Files 6 passed`, `Tests 51 passed`.

- [ ] **Step 6: Prove the redaction test bites (then undo)**

In `src/worker/http.ts`, temporarily change the last line of `errorResponse` to `return json({ error: message }, 500);`.
Run: `npx vitest run -c vitest.worker.config.ts tests/worker/schema.test.ts`
Expected: FAIL on `redacts secrets from unexpected error messages`. Restore the line (`git checkout src/worker/http.ts`), re-run, and expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker tests/worker/catalog.test.ts tests/worker/errors.test.ts
git commit -m "feat(worker): IGDB search, game fetch with canonical collapse, Steam import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Export and restore

**Files:**
- Create: `src/worker/db/export.ts`, `src/worker/routes/export.ts`, `scripts/restore-sql.ts`, `scripts/restore.ts`
- Modify: `src/worker/index.ts`, `package.json` (script), `.gitignore`
- Test: `tests/worker/export-restore.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `ExportFile` (Plan 1); `canonicalWork` (Plan 3); `syntheticGames` (Plan 2 fixture).
- Produces: `exportAll(db, nowIso): Promise<ExportFile>`, `exportRoutes`, `restoreStatements(file: ExportFile, nowIso: string): string[]`; script `npm run restore -- <export.json> <restore.sql>`.
- HTTP: `GET /api/export` → `ExportFile` with `content-disposition: attachment; filename="versus-export-YYYY-MM-DD.json"`. It accepts the session cookie **or** `Authorization: Bearer <BACKUP_TOKEN>`; the token also writes `kv.last_backup_at`.

- [ ] **Step 1: Write the failing test**

`tests/worker/export-restore.test.ts`:

```ts
// Restore drill as a test (spec §10): an export applied to a fresh database exports identically.
// This file's database starts empty (each Worker test file gets its own).

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ExportFile } from '../../src/core/types';
import { restoreStatements } from '../../scripts/restore-sql';
import { syntheticGames } from '../fixtures/synthetic';
import { call, loginCookie, NOW } from './helpers';

function sampleExport(): ExportFile {
  const games = syntheticGames({ games: 4, seed: 3, noise: 0 });
  return {
    version: 1,
    exportedAt: NOW.toISOString(),
    events: [
      { seq: 3, id: 'a', ts: NOW.toISOString(), listId: 'global', type: 'session_started', gameId: 1, data: { session: 's', bucket: 'loved' } },
      { seq: 4, id: 'b', ts: NOW.toISOString(), listId: 'global', type: 'placed', gameId: 1, data: { session: 's', bucket: 'loved', below: null } },
      { seq: 9, id: "it's", ts: NOW.toISOString(), listId: 'global', type: 'unranked', gameId: 2, data: {} },
    ],
    library: [
      { gameId: 1, status: 'played', bucket: 'loved', platforms: ['PC'], source: 'steam', steamPlaytimeMin: 42, addedAt: 'a', updatedAt: 'b' },
      { gameId: 2, status: 'backlog', bucket: null, platforms: [], source: 'manual', steamPlaytimeMin: null, addedAt: 'c', updatedAt: 'd' },
    ],
    games,
    externalIds: [{ source: 'steam', uid: '10', gameId: 1 }],
    sublists: [
      { id: 'f', name: "Bruno's PC", kind: 'filter', filter: { platform: 'PC' }, items: [], createdAt: 'e' },
      { id: 's', name: 'Set', kind: 'set', filter: null, items: [1, 2], createdAt: 'f' },
    ],
  };
}

describe('export and restore', () => {
  it('an export restored into a fresh database exports the same data, seq numbers included', async () => {
    const original = sampleExport();
    const statements = restoreStatements(original, NOW.toISOString());
    await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));

    const cookie = await loginCookie();
    const res = await call('/api/export', { cookie });
    expect(res.headers.get('content-disposition')).toContain('versus-export-2026-10-06.json');
    const restored = (await res.json()) as ExportFile;
    expect(restored).toEqual(original);
  });

  it('the backup token reads /api/export, and only /api/export', async () => {
    const headers = { authorization: `Bearer ${env.BACKUP_TOKEN}` };
    expect((await call('/api/events', { headers })).status).toBe(401);
    expect((await call('/api/export', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  });

  it('the backup token records last_backup_at, shown by /api/status', async () => {
    const res = await call('/api/export', { headers: { authorization: `Bearer ${env.BACKUP_TOKEN}` } });
    expect(res.status).toBe(200);
    const cookie = await loginCookie();
    const status = await (await call('/api/status', { cookie })).json();
    expect(status).toEqual({ lastBackupAt: NOW.toISOString(), eventCount: 3 });
  });

  it('refuses an unknown export version', () => {
    expect(() => restoreStatements({ ...sampleExport(), version: 2 as 1 }, NOW.toISOString())).toThrow(/version/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run -c vitest.worker.config.ts tests/worker/export-restore.test.ts`
Expected: FAIL. The file can't resolve `../../scripts/restore-sql`.

- [ ] **Step 3: Implement**

`src/worker/db/export.ts`:

```ts
// The full export (GET /api/export, nightly backup, Export button).

import type { ExportFile, GameMeta } from '../../core/types';
import { listEvents } from './events';
import { getExternalIds } from './games';
import { getLibrary } from './library';
import { getSublists } from './sublists';

export async function exportAll(db: D1Database, nowIso: string): Promise<ExportFile> {
  const { results } = await db.prepare('SELECT meta FROM games ORDER BY id').all<{ meta: string }>();
  return {
    version: 1,
    exportedAt: nowIso,
    events: await listEvents(db, 0),
    library: await getLibrary(db),
    games: results.map((r) => JSON.parse(r.meta) as GameMeta),
    externalIds: await getExternalIds(db),
    sublists: await getSublists(db),
  };
}
```

`src/worker/routes/export.ts`:

```ts
// GET /api/export: the whole database as one JSON file (spec §10, R-LIB-3). The nightly backup job
// calls it with the bearer token, which also records last_backup_at for the Settings screen.

import { exportAll } from '../db/export';
import { kvPut } from '../db/kv';
import { json } from '../http';
import type { Route } from '../router';

export const exportRoutes: Route[] = [
  {
    method: 'GET',
    path: /^\/api\/export$/,
    run: async ({ ctx, nowIso, viaBackupToken }) => {
      if (viaBackupToken) await kvPut(ctx.env.DB, 'last_backup_at', nowIso);
      return json(await exportAll(ctx.env.DB, nowIso), 200, {
        'content-disposition': `attachment; filename="versus-export-${nowIso.slice(0, 10)}.json"`,
      });
    },
  },
];
```

`scripts/restore-sql.ts`:

```ts
// Turn an export (GET /api/export, the backup repo, or Settings → Export) into SQL statements that
// rebuild a FRESH, migrated D1 database (spec §10: "Restore = replay events into a fresh D1").
// Events keep their original seq numbers, so the order derived from them is identical.
// Pure string building, so it runs in Node (scripts/restore.ts) and in the Worker tests.

import { canonicalWork } from '../src/core/catalog';
import type { ExportFile, GameMeta } from '../src/core/types';

function lit(v: string | number | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

export function restoreStatements(file: ExportFile, nowIso: string): string[] {
  if (file.version !== 1) throw new Error(`unsupported export version ${String(file.version)}`);
  const out: string[] = [];
  for (const e of file.events) {
    out.push(
      `INSERT INTO events (seq, id, ts, list_id, type, game_id, data) VALUES (${lit(e.seq)}, ${lit(e.id)}, ${lit(e.ts)}, ${lit(e.listId)}, ${lit(e.type)}, ${lit(e.gameId)}, ${lit(JSON.stringify(e.data))});`,
    );
  }
  // root_id isn't in the export; recompute it from the exported games (ancestors are exported too).
  const byId = new Map<number, GameMeta>(file.games.map((g) => [g.id, g]));
  for (const g of file.games) {
    const root = canonicalWork(g.id, (id) => byId.get(id));
    out.push(`INSERT INTO games (id, root_id, meta, fetched_at) VALUES (${lit(g.id)}, ${lit(root)}, ${lit(JSON.stringify(g))}, ${lit(nowIso)});`);
  }
  for (const x of file.externalIds) {
    out.push(`INSERT INTO external_ids (source, uid, game_id) VALUES (${lit(x.source)}, ${lit(x.uid)}, ${lit(x.gameId)});`);
  }
  for (const r of file.library) {
    out.push(
      `INSERT INTO library (game_id, status, bucket, platforms, source, steam_playtime_min, added_at, updated_at) VALUES (${lit(r.gameId)}, ${lit(r.status)}, ${lit(r.bucket)}, ${lit(JSON.stringify(r.platforms))}, ${lit(r.source)}, ${lit(r.steamPlaytimeMin)}, ${lit(r.addedAt)}, ${lit(r.updatedAt)});`,
    );
  }
  for (const s of file.sublists) {
    out.push(
      `INSERT INTO sublists (id, name, kind, filter, created_at) VALUES (${lit(s.id)}, ${lit(s.name)}, ${lit(s.kind)}, ${lit(s.filter === null ? null : JSON.stringify(s.filter))}, ${lit(s.createdAt)});`,
    );
    for (const item of s.items) out.push(`INSERT INTO sublist_items (sublist_id, game_id) VALUES (${lit(s.id)}, ${lit(item)});`);
  }
  return out;
}
```

`scripts/restore.ts`:

```ts
// Restore an export into a fresh D1 database (spec §10; runbook in docs/runbook.md).
//   npm run restore -- <export.json> <restore.sql>
//   npx wrangler d1 migrations apply versus --remote     (on the NEW, empty database)
//   npx wrangler d1 execute versus --remote --file <restore.sql>
// The .sql file contains the full log: treat it like the export (never commit it).

import { readFileSync, writeFileSync } from 'node:fs';
import type { ExportFile } from '../src/core/types';
import { restoreStatements } from './restore-sql';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: npm run restore -- <export.json> <restore.sql>');
  process.exit(1);
}
const file = JSON.parse(readFileSync(input, 'utf8')) as ExportFile;
const statements = restoreStatements(file, new Date().toISOString());
writeFileSync(output, `${statements.join('\n')}\n`);
console.log(`Wrote ${statements.length} statements (${file.events.length} events) to ${output}`);
```

Final `src/worker/index.ts`:

```ts
// The Worker: a plain fetch handler with a route table (spec §3, §4). No framework.
// Only /api/* reaches this code; Cloudflare serves the PWA's static files itself (wrangler.jsonc).

import { hasBackupToken, hasValidSession, login } from './auth';
import { realDeps, type Ctx, type Deps, type Env } from './env';
import { errorResponse, HttpError, json, readJson } from './http';
import type { Route } from './router';
import { catalogRoutes } from './routes/catalog';
import { eventRoutes } from './routes/events';
import { exportRoutes } from './routes/export';
import { libraryRoutes } from './routes/library';
import { sessionRoutes } from './routes/session';

export type { Env } from './env';

const ROUTES: Route[] = [...sessionRoutes, ...eventRoutes, ...libraryRoutes, ...catalogRoutes, ...exportRoutes];

export async function handle(req: Request, env: Env, deps: Deps = realDeps): Promise<Response> {
  const ctx: Ctx = { env, deps };
  const url = new URL(req.url);
  try {
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'not found');

    // The only public route.
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = (await readJson(req)) as { passphrase?: unknown };
      return json({ ok: true }, 200, { 'set-cookie': await login(body.passphrase, ctx) });
    }

    // The backup job reads GET /api/export with a bearer token; everything else needs the cookie.
    const isExport = req.method === 'GET' && url.pathname === '/api/export';
    const viaBackupToken = isExport && (await hasBackupToken(req, ctx));
    if (!viaBackupToken && !(await hasValidSession(req, ctx))) throw new HttpError(401, 'log in first');

    for (const route of ROUTES) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.path);
      if (match) {
        return await route.run({ req, url, ctx, params: match.slice(1), nowIso: deps.now().toISOString(), viaBackupToken });
      }
    }
    throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
  } catch (e) {
    return errorResponse(e, env);
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
} satisfies ExportedHandler<Env>;
```

Add `"restore": "tsx scripts/restore.ts"` to the `scripts` block of `package.json`, and append to `.gitignore`:

```gitignore
# Restore SQL contains the whole event log
*.restore.sql
restore.sql
```

- [ ] **Step 4: Run the tests and typechecks**

Run: `npm run typecheck && npm run test:worker`
Expected: typecheck exits 0; `Test Files 7 passed`, `Tests 55 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/worker scripts/restore-sql.ts scripts/restore.ts tests/worker/export-restore.test.ts package.json .gitignore
git commit -m "feat(worker): full JSON export, backup token, restore script with round-trip test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Local development setup, README, CI check

**Files:**
- Create: `scripts/make-dev-vars.ts`, `README.md`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: everything above.
- Produces: scripts `npm run dev-vars`, `npm run db:migrate:local`, `npm run dev:worker`. Plan 5 adds `npm run dev`, which builds the web app first.

- [ ] **Step 1: Write the dev-vars script**

`scripts/make-dev-vars.ts`:

```ts
// Create .dev.vars (the local Worker secrets file) from .env, spec §10: "Local dev: .env → .dev.vars".
//   npm run dev-vars
// SESSION_KEY and BACKUP_TOKEN are generated if .env doesn't have them. Both files are git-ignored.
// Prints only the NAMES of the variables, never their values.

import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const NEEDED = ['APP_PASSPHRASE', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'STEAM_API_KEY', 'STEAM_ID64'] as const;
const GENERATED = ['SESSION_KEY', 'BACKUP_TOKEN'] as const;

const envFile = process.argv[2] ?? '.env';
const outFile = process.argv[3] ?? '.dev.vars';
if (existsSync(outFile)) {
  console.error(`${outFile} already exists; delete it first if you want to regenerate it.`);
  process.exit(1);
}
process.loadEnvFile(envFile);

const missing = NEEDED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing in ${envFile}: ${missing.join(', ')}`);
  process.exit(1);
}
const lines = NEEDED.map((k) => `${k}=${process.env[k]}`);
for (const k of GENERATED) lines.push(`${k}=${process.env[k] ?? randomBytes(32).toString('base64url')}`);
writeFileSync(outFile, `${lines.join('\n')}\n`);
console.log(`Wrote ${outFile} with: ${[...NEEDED, ...GENERATED].join(', ')}`);
```

Final `scripts` block of `package.json`:

```json
  "scripts": {
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.worker.json",
    "test": "vitest run && vitest run -c vitest.worker.config.ts",
    "test:worker": "vitest run -c vitest.worker.config.ts",
    "eval": "tsx scripts/eval.ts",
    "capture-fixtures": "tsx scripts/capture-fixtures.ts",
    "restore": "tsx scripts/restore.ts",
    "dev-vars": "tsx scripts/make-dev-vars.ts",
    "db:migrate:local": "wrangler d1 migrations apply versus --local",
    "dev:worker": "wrangler dev --ip 127.0.0.1 --port 8787"
  }
```

- [ ] **Step 2: Write the README**

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
| `migrations/` | the D1 (SQLite) schema |
| `scripts/` | command-line tools: eval, restore, fixture capture, .dev.vars setup |
| `tests/` | `core/` and `worker/` unit tests, `fixtures/` (public game data + synthetic data only) |

## First-time setup (Windows, PowerShell or Git Bash)

```bash
npm ci                     # install the pinned tools
npm run dev-vars           # writes .dev.vars (local Worker secrets) from .env; both are git-ignored
npm run db:migrate:local   # creates the local D1 database under .wrangler/
```

## Everyday commands

```bash
npm test                   # core tests, then Worker tests (in Cloudflare's local runtime)
npm run typecheck          # TypeScript for core + scripts, then for the Worker
npm run dev:worker         # the API on http://127.0.0.1:8787 (needs a dist/web folder; see below)
npm run eval -- exports/<file>.json    # offline recommender evaluation on an export
```

Until the web app exists (Plan 5), create an empty `dist/web` once so `wrangler dev` starts:
`node -e "require('node:fs').mkdirSync('dist/web',{recursive:true})"`.

## Never commit

`.env`, `.dev.vars`, exports (`exports/`, `*.export.json`), restore `.sql` files, or any fixture with
playtimes or a Steam id. This repository is public.
```

- [ ] **Step 3: Smoke-test the Worker locally (manual)**

Run, in Git Bash from the repo root:

```bash
npm run dev-vars            # prints only variable NAMES; refuses to overwrite an existing .dev.vars
npm run db:migrate:local    # expected: a table showing 0001_init.sql ✅
node -e "require('node:fs').mkdirSync('dist/web',{recursive:true})"
npm run dev:worker          # leave running; wait for "Ready on http://127.0.0.1:8787"
```

In a second terminal (use curl, not PowerShell's `Invoke-WebRequest`: Windows PowerShell 5.1 drops a hand-set `Cookie` header, so authenticated calls wrongly get 401):

```bash
PASS=$(grep '^APP_PASSPHRASE=' .dev.vars | cut -d= -f2-)
C=$(curl -s -D - -o /dev/null -X POST -H 'content-type: application/json' -d "{\"passphrase\":\"$PASS\"}" http://127.0.0.1:8787/api/login | grep -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: //; s/;.*//')
curl -s -H "cookie: $C" http://127.0.0.1:8787/api/status
curl -s http://127.0.0.1:8787/api/status
```

Expected: `{"lastBackupAt":null,"eventCount":0}`, then `{"error":"log in first"}`. ✅ This was verified on this machine with fake secrets on 2026-10-06. `wrangler dev` refuses to start without `dist/web` ("The directory specified by the "assets.directory" field ... does not exist"), which is why the `mkdirSync` line is there.

Optional real-data check (calls the real Steam and IGDB APIs with your `.env` credentials): `curl -s -X POST -H "cookie: $C" http://127.0.0.1:8787/api/import/steam`. Expected: a summary with ~121 owned, ~118 mapped. The data stays in the local `.wrangler/` folder (git-ignored). Stop the server with Ctrl+C.

- [ ] **Step 4: Full suite, then commit and push**

Run: `npm run typecheck && npm test`
Expected: core `Tests 135 passed`, then Worker `Tests 55 passed`.

```bash
git add scripts/make-dev-vars.ts README.md package.json
git commit -m "chore: local dev scripts and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin p4-worker
gh run watch --exit-status
```

Expected: CI green. `npm test` now runs the Worker suite too, in the same `ubuntu-latest` job (the local Workers runtime ships Linux binaries). Merge per `superpowers:finishing-a-development-branch`.
