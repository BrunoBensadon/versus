# versus — Requirements map

Source: `docs/PRD.md` v0.1 (2026-10-05). Phase 1 of the design session.
Evidence for data claims: `docs/data-source-verification.md` and `spikes/` (throwaway).

Legend — **MVP** = needed for the first usable version · **Later** = after MVP ·
**Cut?** = I propose deferring it (to confirm in Phase 2).
✅ = verified by spike or docs · ⚠️ = assumption, not yet verified.

---

## 1. Ranking engine

| ID | Requirement | Depends on | Riskiest assumption | Scope |
|---|---|---|---|---|
| R-RANK-1 | Bucket first (loved / liked / didn't like); compare only within the bucket | — | That buckets are a hard partition I'm happy with: a "liked" game can **never** outrank a "loved" one. Fixing a mis-bucketed game means moving it to the other bucket and re-inserting it. | MVP |
| R-RANK-2 | Binary insertion over the bucket, ~⌈log₂(n+1)⌉ questions | R-RANK-1 | That my answers are consistent enough for binary search. One wrong early answer misplaces the game by up to half the bucket. Quantified in the Phase 2 simulation. | MVP |
| R-RANK-3 | "Too close", undo last answer, abort and resume | R-RANK-2, R-RANK-5 | That "too close" can be handled without a tie data type leaking everywhere (see A3) | MVP |
| R-RANK-4 | Position → 0–10 score in per-bucket bands, linear interpolation | R-RANK-1 | That fixed equal bands feel right. With 5 "didn't like" games and 40 "loved", each disliked game still spans 0.0–3.3. ⚠️ | MVP |
| R-RANK-5 | Comparison log is canonical; order reproducible from it | — | That "reproducible" has one meaning. Insertion replay and a fitted model (Bradley-Terry) **can disagree** (see A2) | MVP |
| R-RANK-6 | Dropped games rankable, with a marker; bucket stays my choice | R-RANK-1, R-LIB-1 | — (low risk) | MVP |
| R-RANK-7 | Bulk seeding: triage → unranked-but-usable → short ranking sessions | R-RANK-1, R-DATA-2 | The cost numbers. ✅ My library has **78 played Steam games**, not 100–200, so seeding is smaller than the PRD fears. Manual adds of console games will grow it. | MVP |
| R-RANK-8 | Re-insert a game; occasional sanity-check comparisons on weakly supported pairs | R-RANK-5 | That a sanity-check answer which contradicts the current order has a defined effect (see A4) | Re-insert: MVP · Sanity checks: **Later** |
| R-RANK-9 | Sub-lists: filtered view (default) or own-criterion log | R-RANK-5 | That I'll actually maintain a second comparison log. ⚠️ | Filtered view: MVP · Own-criterion: **Cut?** |

## 2. Catalog & sync

| ID | Requirement | Depends on | Riskiest assumption | Scope |
|---|---|---|---|---|
| R-DATA-1 | Typeahead search over the catalog, any platform | IGDB | ✅ IGDB search works but is **noisy**: editions and fan projects rank high ("hades" → two different "Hades"; "Super Mario Odyssey" hit a fan game). Results need filtering (main games only, no `version_parent`), year and cover shown, and ordering by popularity. Also ✅ IGDB **rejects browser requests (no CORS)**, so search needs a server-side hop. | MVP |
| R-DATA-2 | Steam import (owned + playtime) → map appid to canonical game | Steam Web API, IGDB | ✅ Works: 121 owned, 78 played. ✅ **118/121 map 1:1 to IGDB** via `external_games` (source 1 = Steam). The 3 misses are software (Wallpaper Engine, GameMaker, Soundpad), not games. | MVP |
| R-DATA-3 | Qualitative metadata (genres, themes, keywords, modes, perspective, franchise, companies, year, platforms, ratings, similar, community tags) | IGDB, Steam | ✅ All of it is present, but density varies a lot (see the verification doc). IGDB keywords are skewed and noisy. **Steam tags exist only for games sold on Steam**: 6 of the 8 console titles I sampled have no Steam tags. | MVP |
| R-DATA-4 | Local metadata cache; scheduled refresh + on-demand single refresh; new releases appear without manual work | R-DATA-5, hosting | That something runs on a schedule for free. A sleeping host or a pure static site can't do it, so this needs a scheduled job (e.g. GitHub Actions cron). ⚠️ | On-demand: MVP · Scheduled: Later (with discovery) |
| R-DATA-5 | Bounded candidate pool (similar-games expansion, taste-weighted queries, recent well-rated releases), refreshed periodically | IGDB, R-REC-6 | That IGDB `similar_games` is a good expansion seed. ✅ It always returns exactly 10 entries, and quality is mixed (Outer Wilds → "Escape the Backrooms"). | **Cut?** → v1.1 with discovery |
| R-DATA-6 | One game = one record; editions, remasters and bundles don't split; manual merge | IGDB | ✅ **A real problem in my library: 9 duplicate clusters.** Examples: BioShock + BioShock Remastered, Half-Life + Half-Life: Source, CS + CS: Source. Steam appids also map to edition records (Skyrim **Special Edition**, GTA V **Enhanced** typed as "Bundle"). Needs a canonical "work" rule (see A6). | MVP |
| R-DATA-7 | Legitimate sources only, respect limits and attribution | — | ✅ IGDB: free for non-commercial use, caching encouraged, 4 req/s. ✅ Steam: 100k calls/day. Steam's terms ask for a privacy policy and data-handling statement (aimed at multi-user apps; low risk for a single user). | MVP (constraint) |

## 3. Recommender

| ID | Requirement | Depends on | Riskiest assumption | Scope |
|---|---|---|---|---|
| R-REC-1 | Predict score, neighbourhood and confidence for any unranked game | R-REC-6, R-RANK-4 | That a score is predictable at all. The score depends on bucket sizes, so the model must predict the **bucket too** (see A1) | MVP |
| R-REC-2 | Discover feed with filters (platform, release window, length, genre) | R-DATA-5, R-REC-1 | Length filter: ✅ IGDB `game_time_to_beats` exists for 95/118 of my games, but only **45/118 have ≥5 submissions**, so treat it as rough | **Cut?** → v1.1 |
| R-REC-3 | Backlog pick (backlog, optionally wishlist) | R-REC-1 | — My library has 43 owned-but-unplayed games, so the backlog is real. | MVP |
| R-REC-4 | Explain: top features + 2–3 most similar ranked games | R-REC-6 | That linear contributions over sparse tags read as credible. Noise keywords ("steam", "digital distribution", "steam achievements" are the 3 most common) will dominate unless they're filtered. ✅ | MVP |
| R-REC-5 | Not interested / already played → rank now / wasn't for me; dismissals feed the model | R-REC-2, R-RANK-2 | That a dismissal is a taste signal. "Not interested" ≠ "would rank low" (see A9) | "Rank now": MVP · Dismissals: Later |
| R-REC-6 | Learn from the pairwise log (logistic / BT on feature differences) | R-RANK-5, R-DATA-3 | **Biggest modelling risk.** ~80–120 ranked games against ~1,300 distinct IGDB keywords and 282 Steam tags is a p ≫ n setting, so the model needs strong regularization and feature pruning. Also, since comparisons are **only within buckets**, the log contains no loved-vs-disliked pairs (see A8). | MVP |
| R-REC-7 | Honest cold start below ~15–20 ranked games | R-REC-6 | — | MVP |
| R-REC-8 | Offline eval: held-out pairwise accuracy, Kendall τ vs. genre-average baseline; no regressions | R-REC-6, R-RANK-5 | That my own data is big enough for a stable metric. With ~80 games, τ has wide confidence intervals, so "doesn't regress" needs a tolerance, not a strict inequality. ⚠️ | MVP (as a script/test) |

## 4. Library & UI

| ID | Requirement | Depends on | Riskiest assumption | Scope |
|---|---|---|---|---|
| R-LIB-1 | Status flow wishlist → backlog → playing → played/dropped; played/dropped prompts ranking | R-RANK-2 | Gap: triage needs an **`ignored`** state (software, tools, multiplayer-only things I'll never rank) that isn't in the status enum (see A10) | MVP |
| R-LIB-2 | Views: ranked list, by status, sub-lists, filters | R-RANK-4, R-RANK-9 | — | MVP |
| R-LIB-3 | Export everything (JSON/CSV) | storage | — | MVP (it's also NF-5's backup) |

## 5. Platform & infra (non-functional)

| ID | Requirement | Depends on | Riskiest assumption | Scope |
|---|---|---|---|---|
| NF-1 | Rank a just-finished game in < 1 min on the phone | R-DATA-1, R-RANK-2 | That typeahead search is fast and correct on the first try. Search is the slowest step, not the comparisons. | MVP |
| NF-2 | Zero running cost | hosting | That a free host can (a) proxy IGDB, (b) store the log durably and (c) run a cron. Few free hosts do all three. ⚠️ Phase 2 | MVP |
| NF-3 | Secrets in env vars, never in the repo | — | ✅ Today they're in `.env` (now git-ignored). IGDB and Steam calls **must** be server-side, because the Steam key is in the query string and IGDB has no CORS. | MVP |
| NF-4 | Not publicly writable | hosting | — | MVP |
| NF-5 | Comparison log survives redeploys; backups | storage | That a free tier won't wipe or expire the data. ⚠️ Phase 2 | MVP |
| NF-6 | Buildable and verifiable from the dev environment; tests for ranking and recommender | — | ✅ **Correction: the dev environment is Bruno's Windows 11 machine, not a cloud sandbox.** Python 3.13, Node 26, git and gh are present. An Android emulator *could* be installed here, and the real phone could be attached over USB. | MVP |
| NF-7 | Boring tech, small testable modules | — | — | MVP |

---

## 6. Contradictions, gaps and ambiguous requirements

> **Resolved 2026-10-06:** the items below were decided in the design session. Each final decision is in `docs/specs/2026-10-06-versus-design.md` (§2 PRD amendments, §13 decision log). Where a reading here differs from the spec, the spec wins.

Each item has the reading I propose. Items marked **❓** need a decision from you in Phase 2.

**A1. Predicted 0–10 score vs. bucket bands (R-REC-1 × R-RANK-4).** A score only exists for a position inside a bucket.
*Reading:* the model predicts a latent "enjoyment" value. We place the game into the current global order by that value, which implies a bucket and a position, then read the score off the same interpolation. So the predicted score answers "if I ranked this today, where would it land?"

**A2. "Reproducible from the log" (R-RANK-5) when insertion replay and a statistical fit disagree.** They disagree whenever the log contains a cycle (A>B, B>C, C>A) or a re-insertion contradicts old answers.
*Reading:* the **canonical order is deterministic replay of insertion events**: each game's latest completed insertion wins. A Bradley-Terry fit is computed alongside as a *diagnostic*. It drives sanity checks and confidence, and never silently reorders the list. Alternatives come in Phase 2.

**A3. "Too close" (R-RANK-3).** The PRD allows two mechanisms: compare against a neighbouring pivot, or record a tie.
*Reading:* first try the adjacent pivot. If that's also "too close", place the game directly next to that pivot, and record the answer as `tie` in the log. Ties are kept as evidence for the model, but the list stays a strict total order. Phase 2 will confirm this with the simulation.

**A4. Sanity check that contradicts the order (R-RANK-8).** Undefined in the PRD.
*Reading:* a contradicting answer **flags** the lower game for re-insertion. It doesn't move anything by itself. Sanity checks are Later anyway.

**A5. Bucket change.** The PRD doesn't say what happens when a game moves from liked to loved.
*Reading:* changing the bucket means re-inserting the game in its new bucket. Old comparisons stay in the log; they're simply no longer used for that game's position.

**A6. ❓ What counts as "the same game" (R-DATA-6).** My library has editions (Skyrim SE), remasters (BioShock Remastered), ports (HL Deathmatch: Source), remakes (CS: Source, Isaac: Rebirth) and standalone expansions (Opposing Force, Don't Starve Together).
*Proposed reading:* auto-collapse **editions, bundles, ports and remasters** into their root work (IGDB `version_parent` / `parent_game` / `remasters`). Keep **remakes and standalone expansions** as separate games, because they're different experiences. Allow manual merge and split. You might disagree on remakes.

**A7. Seeding numbers (R-RANK-7).** The PRD's math (~370 comparisons for 100 games, ~940 for 200) is about right for 3 balanced buckets. But my real Steam library has 78 played games, and after collapsing duplicates and ignoring software there are probably ~60–70 rankable ones. The Phase 2 simulation will report the cost for 60, 100 and 200.

**A8. No cross-bucket comparisons in the log (R-REC-6 × R-RANK-1).** If the model trains only on recorded comparisons, it never sees "loved > disliked". That's the most informative contrast, and the model would miss it.
*Reading:* the training set = recorded pairs + **implied pairs from bucket membership** (every loved game > every liked game, and so on), down-weighted or sampled. This is a design change to R-REC-6, not just an implementation detail.

**A9. Dismissals as taste signal (R-REC-5).** "Not interested" may mean "not now", "wrong platform" or "too long". It's different from "I'd rank it low".
*Reading:* in v1, dismissals only filter the feed. They aren't used in training. "Played it, wasn't for me" becomes a real entry in the "didn't like" bucket (optionally ranked), which *is* proper training data.

**A10. Missing `ignored` status.** Triage (R-RANK-7) offers "ignore", but the status list in §2 doesn't include it. The §1 decision table also omits `played`.
*Reading:* status ∈ {wishlist, backlog, playing, played, dropped, ignored}. `ignored` hides the game from the library and from recommendations.

**A11. ❓ Steam playtime as a triage prior (PRD open question 4).** It's cheap and useful for **ordering** (rank high-playtime games first, since they're likely to matter more). It's misleading as a **taste** signal. In my library, the three most-played games are a sandbox, a 4X and a live-service game (hundreds of hours each), well ahead of story-driven favourites, because those formats are built for endless play. Playtime tracks a game's format more than how much I enjoyed it.
*Reading:* use it for queue order only. Never use it as a model feature.

**A12. Steam tags vs. non-Steam games (R-DATA-3 × R-REC-6).** Steam tags are the cleanest signal (✅ 20 per game, a 446-tag vocabulary, 282 used across my library). But a console exclusive has none. A model that leans on them will score console games systematically differently.
*Reading:* the shared feature base is IGDB (genres, themes, perspectives, modes, curated keywords). Steam tags are an **extra block** with its own presence indicator. Phase 2 will cover the design.

**A13. YAGNI candidates** (to confirm in Phase 2):
- own-criterion sub-lists (R-RANK-9b);
- the discovery feed + candidate pool + scheduled refresh (R-REC-2, R-DATA-5, R-DATA-4 scheduled part) as **v1.1**. Ranking + backlog pick + predict-my-rank is a complete, testable v1, and it doesn't need a cron;
- sanity-check comparisons (R-RANK-8b);
- dismissal learning (R-REC-5b).

**A14. Naming.** The PRD says "Game Ranker"; the repo is `versus`. I'll use **versus**.
