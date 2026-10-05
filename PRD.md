# Game Ranker — Product Requirements (v0.1)

Owner: Bruno · Date: 2026-10-05 · Status: draft for brainstorming

A personal tool to (1) rank the games I've played through Beli-style head-to-head comparisons and (2) get recommendations, backlog picks and rank predictions that come from those rankings and that explain themselves.

---

## 1. Decisions already made

| Topic | Decision | Why |
|---|---|---|
| Audience | **Single user (me).** No sign-ups, no social features. | Keeps auth, hosting and licensing simple. Recs can't use other users' rankings (no collaborative filtering), so they have to come from game metadata plus my own comparisons. |
| Platform | **Open.** Claude Code evaluates web/PWA vs. native Android. | Primary use is on my Android phone (Galaxy S26), right after finishing a game. Desktop access is a nice-to-have. Development happens in a cloud environment on a new GitHub repo. |
| History sources | **Steam library (import)** + **other platforms (manual add)**. | Steam has a usable API. PlayStation/Switch/Xbox mostly don't, so I add those by search. |
| List structure | **One global ranked list + optional sub-lists.** | One "best games ever" order. Sub-lists are curated subsets (see R-RANK-9). |
| Tracking scope | **Status (backlog/wishlist/playing/dropped)** + **dropped games can be ranked.** | Status is needed for backlog picks. Notes, hours and deal alerts are out of scope for now. |
| Rec goals | **Discover new games**, **pick from my backlog**, **predict my rank**, **explain the why**. | All four. |
| Budget | **Free tier, no LLM.** Deterministic recommendations. An LLM layer can be added later behind an interface. | Personal project. Zero running cost. |

---

## 2. Core concepts

- **Game**: a canonical catalog entry with a stable external ID (IGDB is the likely candidate), metadata, and links to other IDs (Steam appid, etc.).
- **Library entry**: my relationship to a game. Status is one of `wishlist | backlog (owned, unplayed) | playing | played | dropped`. Each entry also stores platform(s) and its source (steam-import / manual).
- **Comparison**: one recorded judgment "A > B", "B > A" or "skip/too close", with a timestamp. **The comparison log is the source of truth.** The ranked order is derived from it.
- **Bucket**: my first sentiment on a game: `loved | liked | didn't like`. It's a coarse prior that narrows where a game can land.
- **Ranked list**: the derived total order of all ranked games. A 0.0–10.0 score is computed from position.
- **Sub-list**: a named subset of games with an optional criterion of its own (see R-RANK-9).

---

## 3. Functional requirements

### 3.1 Ranking (Beli mechanic)

- **R-RANK-1 Bucket first.** When adding a played or dropped game, I choose a bucket (loved / liked / didn't like). After that, comparisons only happen against games in the same bucket.
- **R-RANK-2 Binary insertion.** The app finds the game's position by binary search over its bucket. Each step asks "Which did you enjoy more: X or Y?" and shows covers plus minimal context. That's about ⌈log₂(n+1)⌉ questions per game (~7 for 100 games in a bucket).
- **R-RANK-3 Escape hatches.** Each comparison offers a **"too close / can't decide"** option. It must not corrupt the order: either compare against a neighbouring pivot instead, or place the game adjacent and record a tie. Each comparison also offers **undo last answer** and **abort and resume later**.
- **R-RANK-4 Score derivation.** Position maps to a 0.0–10.0 score. Each bucket gets a band (e.g. loved 6.7–10, liked 3.4–6.6, didn't like 0–3.3) and scores are interpolated linearly inside the band, as Beli does. Scores shift when games are added. That's expected, and the UI shouldn't hide it.
- **R-RANK-5 Comparison log is canonical.** Every answer is stored. The order must be reproducible from the log, which also allows later re-derivation with a statistical model (e.g. Bradley-Terry) if needed.
- **R-RANK-6 Dropped games.** Dropped games can be ranked like any other and carry a visible "dropped" marker. Bucket choice stays mine. A dropped game isn't automatically "didn't like".
- **R-RANK-7 Bulk seeding without misery.** A cold start is expensive: binary insertion costs ≈ log₂(n!) comparisons. With three buckets, that's ~370 for 100 games and ~940 for 200 games. So:
  - Imported games first go through a **fast triage** (played? → bucket / backlog / wishlist / ignore). One tap per game.
  - Triaged-but-unranked games are a valid state. They show inside their bucket as "unranked" and the list is usable immediately.
  - **Ranking sessions**: short batches (e.g. 10 comparisons) that I can do whenever, working through the unranked queue.
- **R-RANK-8 Re-ranking.** I can re-insert a game whose position I disagree with. My taste drifts over time, so the system should occasionally ask a **sanity-check comparison** between games whose relative order is weakly supported (few or old comparisons).
- **R-RANK-9 Sub-lists.** A sub-list made only of globally ranked games already has an order: it inherits the global one. A separate ranking is only meaningful when the **criterion differs** (e.g. "best co-op experience" ≠ "best game"). So:
  - Default sub-list = a filtered view of the global list.
  - Optional "ranked by its own criterion" sub-list = an independent comparison log scoped to that list.

### 3.2 Catalog & data

- **R-DATA-1 Search & add.** Typeahead search over the catalog for adding any game (any platform), including older and non-Steam titles.
- **R-DATA-2 Steam import.** Import owned games and playtime from my Steam account (public profile + Web API key), then map each Steam appid to the canonical game.
- **R-DATA-3 Qualitative metadata per game**, enough to model taste: genres, themes, keywords, game modes, player perspective, franchise/series, developer/publisher, release year, platforms, critic and user ratings, "similar games", and community tags where available (Steam user tags with vote weights are the richest single signal).
- **R-DATA-4 Freshness.** Metadata is cached locally and refreshed on a schedule (e.g. weekly) and on demand for a single game. New releases have to show up in discovery without manual work.
- **R-DATA-5 Bounded candidate pool.** Discovery doesn't mirror the whole catalog (300k+ games). It keeps a candidate pool built from: similar-games expansion from my top-ranked games, tag/genre queries weighted by my taste, and recent well-rated releases. The pool is refreshed periodically.
- **R-DATA-6 ID reconciliation.** One game = one record across sources (IGDB ↔ Steam ↔ others). Editions, remasters and bundles must not split or duplicate entries. Manual merge/override is allowed.
- **R-DATA-7 Legitimate sources only.** Use official or tolerated APIs. Don't scrape sites whose terms forbid it (this likely rules out SteamDB and Backloggd as live sources). Respect rate limits and attribution requirements.

### 3.3 Recommendations

- **R-REC-1 Predict my rank.** For any unranked game: a predicted score (0–10), the predicted neighbourhood ("between Hades and Celeste"), and a confidence indicator.
- **R-REC-2 Discover.** A ranked feed of games I haven't marked, scored by predicted rank. Filters: platform, release window, length (if data exists), genre include/exclude.
- **R-REC-3 Backlog pick.** The same scorer restricted to `backlog` (+ optionally `wishlist`), answering "what should I play next?".
- **R-REC-4 Explain the why.** Every recommendation shows its drivers: the top contributing features (tags/genres) and the 2–3 ranked games most similar to it ("because you ranked Outer Wilds #2 and Return of the Obra Dinn #5").
- **R-REC-5 Feedback loop.** "Not interested", "already played → rank it now" (jumps straight into the ranking flow), and "played it, wasn't for me". Dismissals feed the model.
- **R-REC-6 Learns from comparisons, not just scores.** The taste model trains on the pairwise log (e.g. logistic/Bradley-Terry on feature differences), which is more information than the final order alone.
- **R-REC-7 Honest cold start.** Below a threshold of ranked games (~15–20), predictions are labelled low-confidence and recs lean on item-to-item similarity rather than a learned model.
- **R-REC-8 Measurable quality.** Offline evaluation on my own data: leave-one-out / held-out pairwise accuracy and Kendall's τ of predicted vs. actual rank. A recommendation change ships only if it doesn't regress these metrics.

### 3.4 Library management

- **R-LIB-1** Status changes: wishlist → backlog → playing → played/dropped. Moving to played or dropped prompts the ranking flow.
- **R-LIB-2** Views: ranked list (with score and bucket), by-status lists, sub-lists, filters (platform, genre, year).
- **R-LIB-3** Export all my data (games, statuses, comparison log, sub-lists) as JSON/CSV. No lock-in.

---

## 4. Non-functional requirements

- **NF-1 Ranking a just-finished game takes under a minute** on my phone: search → bucket → ~5–8 taps.
- **NF-2 Zero running cost.** Free hosting, free API tiers, no paid LLM.
- **NF-3 Secrets** (IGDB/Twitch client credentials, Steam API key) live in environment variables, never in the repo.
- **NF-4 Single-user auth.** It must still not be publicly writable if hosted (a simple passphrase or provider login is enough).
- **NF-5 Durability.** Losing the comparison log is the worst failure. It needs backups/export and must survive redeploys.
- **NF-6 Buildable and verifiable from a cloud dev environment** (new GitHub repo, no physical device, likely no Android emulator). Automated tests must cover the ranking engine and the recommender.
- **NF-7 Boring tech, small modules.** Each of these is a separately testable unit with a clear interface: ranking engine, catalog/sync, recommender, UI.

---

## 5. Out of scope (v1)

Social/friends features · collaborative filtering · LLM features · price/deal alerts · reviews/notes/hours tracking · PlayStation/Xbox/Switch library import (manual add only) · scraping Backloggd/SteamDB.

---

## 6. Data source landscape (to be verified by Claude Code)

Treat everything below as **unverified working knowledge**. Terms and endpoints change.

| Source | What it offers | Caveats |
|---|---|---|
| **IGDB** (Twitch) | Broad multi-platform catalog. Genres, themes, keywords, game modes, perspectives, franchises, companies, `similar_games`, ratings, covers, external IDs (incl. Steam). Free with Twitch client-credentials auth. | Rate-limited (reportedly ~4 req/s). Commercial-use clauses aren't a concern for personal use, but read the terms anyway. Backloggd reportedly uses IGDB data, so IGDB likely covers what Backloggd shows. |
| **Steam Web API** | Owned games + playtime (`GetOwnedGames`). Needs an API key and a public profile. | Library only. Store `appdetails` gives genres/categories but **not** user tags. |
| **SteamSpy** | Steam user tags with vote counts, owner estimates. | Unofficial, rate-limited, estimates. Check it still works. |
| **RAWG** | Alternative catalog with tags. Free key (~20k req/month reported). | Attribution required. Smaller/noisier than IGDB. Possible fallback. |
| **Backloggd** | Ratings/reviews/lists. | No official API. Scraping is probably against its terms, so excluded from v1. |
| **SteamDB** | Rich Steam data. | No public API. Scraping prohibited, so excluded. |
| **Time-to-beat** | Needed for "length" filters. | Check whether IGDB exposes time-to-beat data. HowLongToBeat has no official API. |

---

## 7. Open questions (to resolve during brainstorming)

1. Exact bucket score bands and whether "too close" records a true tie or forces a neighbour comparison.
2. How sanity-check comparisons are chosen (weakest-supported adjacent pairs? oldest?) and how often they're asked without becoming annoying.
3. Which taste-model features carry the signal (Steam tags vs. IGDB keywords vs. genres) and how to normalize sparse, noisy tag sets.
4. Should Steam playtime be a weak prior for triage ordering (rank high-playtime games first)?
5. Hosting + storage that satisfies NF-2/NF-5 together. Free tiers that sleep or wipe disks are a risk for the comparison log.

---

## 8. Success criteria

- I can rank a just-finished game on my phone in under a minute.
- My Steam library is imported and triaged in one sitting, and the ranked list is usable before every game is fully ranked.
- Predicted rank on held-out games beats a genre-average baseline on pairwise accuracy.
- I'd act on at least some of the top-10 discovery and backlog recs, and each one shows a reason I find credible.
- All my data can be exported, and the ranked order can be rebuilt from the comparison log.
