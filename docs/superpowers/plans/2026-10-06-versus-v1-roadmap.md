# versus v1 — Implementation roadmap

> **For agentic workers:** this file is the index. Execute the six plans **in order**, each on its own
> branch, merging to `main` before the next. Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans per plan.

**Goal:** Build v1 of versus exactly as specified in `docs/specs/2026-10-06-versus-design.md` (approved
2026-10-06): an installable PWA where Bruno ranks games head to head and gets predicted ranks with reasons.

**How these plans were written:** every code block was run in a throwaway prototype before it was
pasted in. The plans contain the exact files that passed. The "Expected" lines are measured results
unless marked ⚠️. At the end of each plan the prototype showed:

| Plan | Branch | Builds | Proof at the end of the plan |
|---|---|---|---|
| 1 | `p1-foundation-ranking` | npm project, CI, shared types, ranking engine | 47 tests |
| 2 | `p2-recommender` | features, ridge, prediction + reasons, `recommend()`, `evaluate()`, `npm run eval` | 96 tests; eval report on a synthetic library |
| 3 | `p3-catalog` | IGDB/Steam normalization, canonical works, duplicate hints, search rerank, fixture capture | 135 tests on real captured fixtures |
| 4 | `p4-worker` | Cloudflare Worker + D1: auth, events, library, sub-lists, IGDB/Steam proxy, import, export, restore | + 55 Worker tests in the local Workers runtime; each task staged and verified on its own |
| 5 | `p5-pwa` | the React PWA (all screens), installability, Playwright journey, CI e2e job | 146 unit + 55 Worker tests; e2e journey passes in ~15 s and fails when broken on purpose |
| 6 | `p6-ops` (+ deploy) | secrets script, backup split/restore round trip, runbook; then deploy, nightly backup, restore drill, phone check | 148 + 55 tests; Tasks 2–4 are checks on Bruno's real accounts |

Plans 2 and 3 are independent of each other (both need Plan 1); Plan 4 needs 1–3; 5 needs 1–4; 6 needs 1–5.

## Files

- `2026-10-06-versus-p1-foundation-ranking.md`
- `2026-10-06-versus-p2-recommender.md`
- `2026-10-06-versus-p3-catalog.md`
- `2026-10-06-versus-p4-worker.md`
- `2026-10-06-versus-p5-pwa.md`
- `2026-10-06-versus-p6-ops.md`
- Committed alongside: `tests/fixtures/igdb/*.json`, `tests/fixtures/steam/{get-items,tag-list}.json`.
  These are real IGDB/Steam responses for 11 games, captured 2026-10-06 by the script Plan 3 adds. They
  hold public game data only (checked: no keys, Steam id or playtimes).

## Toolchain facts verified on this machine (2026-10-06)

| Fact | Consequence |
|---|---|
| `@cloudflare/vitest-pool-workers@0.22.0` needs `vitest ^4.1` (current Vitest is 5.x) | Vitest pinned to **4.1.11** |
| That pool's bundled Workers runtime refuses compatibility dates after **2026-08-22** | `compatibility_date: "2026-08-15"`; bump only together with the pool |
| Worker tests: **fresh D1 per test file**, shared between tests in one file | tests are written to tolerate shared state within a file |
| `cloudflareTest()` plugin + `readD1Migrations` + `applyD1Migrations` setup file; typed `env` via a `Cloudflare.Env` augmentation | as in Plan 4 Task 1 |
| `wrangler dev` refuses to start without the `assets.directory` (`dist/web`) | Plan 4 smoke test creates it; Plan 5's `dev` builds it |
| Local D1 failed with "internal error" in a very deep folder (Windows 260-character path limit) | don't run from deep worktrees; the repo path is fine |
| `wrangler dev --env-file` and `--var` both override a local `.dev.vars` | e2e uses `--env-file tests/e2e/e2e.env` with fake secrets |
| `wrangler d1 migrations apply DB` accepts the binding name | `npm run deploy` survives a restore into a differently named database |
| Vite 8.3.3 + `@vitejs/plugin-react` 6.1.2 + React 19.3.0 build; Playwright 1.63.0 Chromium runs (Pixel 7 profile) | as pinned |
| Windows PowerShell 5.1 `Invoke-WebRequest` drops a hand-set `Cookie` header | manual API checks use curl (Git Bash) |
| TypeScript **6.0.3** used; 7.x (native port) not tried | ⚠️ revisit TS 7 later |

## Deviations from the spec (numbered; code comments refer to these numbers)

1. **`GameMeta.franchises` added; duplicate hints match a shared collection *or* franchise.** ✅ IGDB gives GTA V Enhanced (334647, Bundle) no collection, only the franchise, so the spec rule would miss the case it was written for. (Plans 1, 3)
2. **The Skyrim "2-step chain" runs through `parent_game`.** ✅ Anniversary (165192) is an *Expanded Game* whose parent is Special Edition (19457, *Remaster*), whose parent is Skyrim (472). The spec's `canonicalWork` already handles it; only the test wording changed. (Plan 3)
3. **Search popularity weight 1.5**, tuned on two captured queries only. ⚠️ Add fixtures whenever real use finds a bad first result. (Plan 3)
4. **`RankState.warnings`** added: replay's defensive fixes are recorded because a pure function can't log. (Plan 1)
5. **`recommend()` returns `score: null` below 5 ranked games** (confidence `low`); the UI says "Rank at least 5 games". (Plan 2)
6. **The evaluation's pairwise accuracy is not 0.5 at chance.** Under spec §7.4's definition (pred(h) against training score(t)), predicting the training mean already scores ≈ 0.75 (✅ synthetic: `mean_only` 0.748, `knn5` 0.753, `ridge` 0.807). The report adds a `mean_only` baseline as the real floor; nothing else changes. Worth knowing before reading the first real eval. (Plan 2)
7. **Ship-rule switch** = the constant `SCORER` in `src/core/recommender/config.ts`, which Bruno flips after `npm run eval`. (Plan 2)
8. **Extra routes:** `POST /api/logout`, `GET /api/status` (backup age, event count), `GET/PUT/DELETE /api/sublists/:id`. The spec stores sub-lists in D1 but listed no route for them. (Plan 4)
9. **`PUT /api/library/:id` is an upsert**; a new game needs its metadata fetched first (`POST /api/games/:id`). (Plan 4)
10. **The export includes `games` and `externalIds`**, so restore needs no IGDB calls; `root_id` is recomputed with `canonicalWork`. The backup repo also stores `games.json`, `external_ids.json` and `meta.json` beside the spec's three files. (Plans 4, 6)
11. **Imported Steam games get `platforms: ['PC']`**; playtimes of appids collapsing into one work are summed. (Plan 4)
12. **`GET /api/library` returns `fetchedAt`** so the PWA can refresh metadata older than 30 days (spec §8). (Plan 4)
13. **No `TagSource` interface.** Spec §8 puts `GetItems` "behind a TagSource interface"; with one implementation that would be speculative. `steamStoreItems()` in `src/worker/steam.ts` is the single function to swap for SteamSpy if `GetItems` breaks. (Plan 4)
14. **Duplicate hints:** "Not the same" dismissals live in the browser's `localStorage`; Merge also sets the merged-away game to `ignored`; Unmerge (on the survivor's page) puts it back in the inbox. (Plan 5)
15. **"Rank 10"** is a `#/queue?left=10` run over played/dropped games that have a triage bucket but no place, highest playtime first, with a "Rank it" button per game. (Plan 5)
16. **D1 Time Travel window:** the runbook plans on the spec's 7 days (free plan); `wrangler`'s help mentions 30 days (⚠️ assumed to be the paid plan). (Plan 6)
17. **Undo with no answers left stays on the question.** Spec §6.1 says the UI returns to bucket choice; the ranking screen instead keeps the first question up and swaps Undo for a "Change bucket" button, and the e2e journey asserts that. Approved by Bruno at pre-flight, 2026-10-06. (Plan 5)
18. **λ is fixed at 1 below 10 ranked games.** Spec §7.2 chooses λ by 5-fold CV at every refit; with fewer than 10 games that CV is noise, so `chooseLambda` returns 1. Predictions start at 5 games (deviation 5), so games 5–9 always use λ = 1. Approved by Bruno at pre-flight, 2026-10-06. (Plan 2)

19. **Reasons name only features the game has.** Spec §7.3's contribution w·(x − x̄) is non-zero for a feature the game *lacks* (x = 0 gives −w·x̄), so 27% of reasons on the synthetic library named absent features ("Theme: Comedy −0.56" for a game without it). `recommend()` now picks the top 3 positive / top 1 negative among columns the game has, plus the rating column when the game has a rating. The score is unchanged. Approved by Bruno after the Plan 2 review, 2026-10-06. (Plan 2 follow-up)

## Pre-flight changes to the plans (approved by Bruno, 2026-10-06)

A read-through of all six plans before execution found these; each is applied when its task runs.

- **Stronger tests:** Plan 1 Task 5's prefix test now checks replay against the live state after every action (spec §11), not replay against itself; Plan 2 Task 3's contributions test asserts the sort order.
- **Less duplication:** Plan 2's `syntheticEvents` reuses Plan 1's `rankWithOracle`; the Steam GetItems request body is built in one place for both `capture-fixtures.ts` and `src/worker/steam.ts`.
- **Restore-safe scripts:** `db:migrate:local` (Plan 4) and `e2e:server` (Plan 5) apply migrations to the binding `DB`, like `deploy`, not the database name `versus`.
- **Plan 5 keeps its own rules:** the confidence label is always shown (also below 5 ranked games), and `.tab` / `button.link` tap targets are at least 44 px.
- **Plan 6 Task 3** writes the drill restore to `drill.restore.sql` (git-ignored), not `drill.sql`.
- Noted, no change: replay's `merged` handling uses the raw `from` id and resolves `into` (safer than the §6.2 pseudocode); deviation 8's text lists `GET /api/sublists/:id`, but Plan 4 builds `GET /api/sublists` (the collection).

## Follow-ups after the Plan 1–3 reviews (branch `followups-p1p2`, approved by Bruno, 2026-10-06)

- `bandOf` classifies the score exactly as `formatScore` shows it, so the number on screen and its bucket always agree (it also absorbs float error like 6.699999…).
- The question-bound test runs both answer paths and asserts the bound ⌈log₂(m+1)⌉ is tight for m = 1..200.
- Boundary rule: the test also catches side-effect, dynamic and `require` imports and `src/core-*` siblings; `npm run typecheck` starts with `tsc -p tsconfig.core.json` (no Node, DOM or Workers types). **Plans 4–5 keep that pass first when they rewrite the `typecheck` script.**
- Deviation 19 (reasons). `prepareRecommender()` fits once and returns a predict-many function (`recommend()` is a wrapper); **Plan 5 caches it per event log / game metadata** instead of refitting on every page.
- `chooseLambda` builds each fold's (symmetric) kernel once instead of refitting per λ: identical λ on 500+ test datasets; ~190 → ~73 ms at 115 ranked games, ~980 → ~196 ms at 200 (desktop). ⚠️ Still to measure on the phone (Plan 6 Task 4).
- `MAX_CHAIN_STEPS = 5` is exported from `canonical.ts`; **Plan 4's `fetchWithAncestors` fetches that many ancestor levels** (the plan text had 2, which would stop 3+-hop chains early and give the wrong root).
- `duplicateHints` compares only games with the same normalized name (identical output on 403 test libraries; 396 → 1.8 ms at 500 games); **Plan 5's triage screen memoizes it**.

## Spec coverage

| Spec | Where |
|---|---|
| §3 layout, boundary rule, one package, CI | P1 T1 (boundary test, CI); P4 T1 and P5 T6 extend CI |
| §4 core interfaces | P1 T2–4 (`step`, `replay`, `scores`); P2 T1–5 (`buildFeatures` … `evaluate`); P3 T2–5 (`normalizeIgdb` … `rerankSearch`) |
| §4 Worker API (all routes) | P4 T1–5 |
| §5 schema, triggers, payloads, bucket rule | P4 T1 (schema, triggers), T2 (events, `placed` → bucket) |
| §6.1 step, undo, resume, stale, confirm, re-rank, bucket change | P1 T2–5 (engine); P5 T3 (screens), T4 (re-rank from the game page) |
| §6.2 replay incl. merge/unmerge | P1 T3; P5 T3 (merge banner), T4 (unmerge) |
| §6.3 scores, one decimal, "scores move" note | P1 T4; P5 T4 |
| §6.4 dropped marker, triage by playtime, Rank 10 | P5 T3–4 |
| §6.5 sub-lists (filter, set) in global order | P4 T3; P5 T4 |
| §7.1–7.3 features, ridge, λ CV, prediction, neighbourhood, confidence, reasons, backlog pick, rank now | P2 T1–4; P5 T4 |
| §7.4 eval protocol, baselines, Steam-masked subgroup, ship rule, CI on synthetic data | P2 T5; P6 T4 (real run) |
| §8 canonical ID, canonicalWork, duplicate hints, search, Steam import, cache freshness, 429 retries, token cache, attribution | P3 T1–5; P4 T4; P5 T2 (footer, privacy), T4 (refresh) |
| §10 hosting, auth + rate limit, secrets, redaction, 3 backup layers, backup age in red, restore | P4 T1, T4, T5; P5 T4; P6 T1–3 |
| §11 test matrix (core, worker, e2e, manual) | P1–P3 unit; P4 Worker; P5 T6 e2e; P6 T4 manual |
| §14 setup tasks | all done before planning (spec §14) |

## Open risks and follow-ups (carried from the spec, plus what planning found)

- ⚠️ **Steam import CPU** on Workers Free (10 ms). It is measured in P6 Task 2; if it fails, the follow-up splits the import into two requests.
- ⚠️ **Model fit time on the phone** (spec §7.2 budget < 200 ms) isn't measured by any test. Check it in P6 Task 4 with Chrome's performance panel if the game page feels slow; the fix is a Web Worker.
- ⚠️ **Typeahead quality** (spec §12's main NF-1 risk): the rerank is tuned on 2 queries.
- ⚠️ **`GetItems` is undocumented** (spec §12): see deviation 13 for the swap point.
- `npm install` reports audit warnings in wrangler's dev-only dependency tree. Note them; don't `npm audit fix --force`.
- The app icon is a generated placeholder.
