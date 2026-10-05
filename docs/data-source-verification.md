# versus — Data-source verification (PRD §6)

Date: 2026-10-05. Method: I read the official docs and terms, then ran throwaway spikes
(`spikes/s01`–`s05`) against the real APIs with Bruno's credentials and Steam library.
Trimmed, secret-free responses are in `spikes/fixtures/`. A secret scan over the fixtures and
scripts found 0 leaks.

✅ = verified (source given) · ⚠️ = assumed or partly verified · ❌ = PRD claim was wrong.

## Verdict per source

| Source | Verdict | Use in versus |
|---|---|---|
| **IGDB** | ✅ Works, confirmed with corrections below | **Canonical catalog and ID space.** Search, metadata, time-to-beat, similar games, cross-store IDs |
| **Steam Web API** `GetOwnedGames` | ✅ Works | Library import (owned + playtime) |
| **Steam** `IStoreBrowseService/GetItems` | ✅ Works · ⚠️ undocumented | **Steam user tags with weights** (the PRD said Steam has no tags API; that's ❌ wrong) + review summary |
| **SteamSpy** | ✅ Works | Fallback for tags only. Not a primary dependency. |
| **RAWG** | Ruled out | Adds nothing over IGDB + Steam. Mandatory backlinks, 20k req/month. |
| **Backloggd** | Ruled out (PRD R-DATA-7) | — |
| **SteamDB** | Ruled out (PRD R-DATA-7) | — |
| **HowLongToBeat** | Not needed | IGDB now has time-to-beat |

## IGDB

Docs: <https://api-docs.igdb.com/> (the fetcher got a 403, so I read the page via curl).

- ✅ Rate limit: **4 requests/second, max 8 open requests**; going over returns HTTP 429. The PRD said "~4 req/s", which is correct.
- ✅ Max **500 results per query** (default 10). Multiquery takes up to 10 sub-queries.
- ✅ Auth: Twitch client-credentials. The token lasted **~60 days** in the spike, so it's cacheable.
- ✅ **"The API does not allow requests directly from browsers"** (no CORS). Any client-only app needs a server-side hop for IGDB.
- ✅ Terms: free for non-commercial use under the Twitch Developer Service Agreement. The FAQ says local storing/caching is **preferred** ("we prefer if you store and serve the data"). Attribution is only required for commercial partnerships; we'll show "Data: IGDB.com" anyway.
- ✅ Schema change since PRD: enums moved to tables. Use `game_type` (not `category`) on games and `external_game_source` (not `category`) on external_games. Steam is source **1**.
- ✅ **Time-to-beat exists**: `game_time_to_beats` (`hastily` / `normally` / `completely`, in seconds, plus a submission `count`).
- ⚠️ "Backloggd uses IGDB": not verified, and it no longer matters for the design.

### Spike results on Bruno's library (121 Steam apps, 78 with playtime)

| Measure | Result |
|---|---|
| Steam appid → exactly one IGDB game | **118/121 (98%)**; played: 75/78 |
| appid → >1 IGDB game | 0 |
| Unmapped | 3, all software, not games: Wallpaper Engine, GameMaker Studio 2, Soundpad |
| Mapped to a non-"Main Game" type | 16. Remaster 4, Remake 3, Standalone Expansion 5, Port 2, Bundle 2 (Steam's "GTA V Enhanced" and "Injustice Ultimate" come back as **Bundle**) |
| **Duplicate clusters inside the library** | **9.** BioShock ↔ Remastered, BioShock 2 ↔ Remastered, Half-Life ↔ HL: Source ↔ Opposing Force ↔ Blue Shift, CS ↔ CS: Source, CS: CZ ↔ Deleted Scenes, DoD ↔ DoD: Source, Deathmatch Classic ↔ HLDM: Source |
| Edition records whose root is outside the library | 6, e.g. Skyrim **Special Edition** → parent Skyrim; FFXV **Windows Edition** → FFXV |

Metadata per game (n = 118 mapped):

| Field | median | p10 | p90 | games with 0 |
|---|---|---|---|---|
| genres | 3 | 1 | 5 | 0 |
| themes | 3 | 1 | 5 | 4 |
| keywords | 16 | 0 | 84 | 12 |
| game_modes | 2 | 1 | 4 | 0 |
| player_perspectives | 1 | 1 | 2 | 4 |
| franchises | 0 | 0 | 1 | 71 |
| collections (series) | 1 | 0 | 1 | 40 |
| similar_games | 10 | 10 | 10 | 0 (it's always capped at 10) |
| involved_companies | 2 | 1 | 6 | 1 |
| user rating_count | 253 | 18 | 1972 | 2 |
| time-to-beat present | 95/118 · **only 45/118 with ≥5 submissions** | | | |

- IGDB **keywords are sparse and long-tailed**: 1,296 distinct keywords across 118 games, 560 (43%) used by only one game. The top three are distribution noise: `steam` (42 games), `digital distribution` (39), `steam achievements` (24). Obvious platform/distribution noise is ~5% of all keyword assignments. A curated stop-list is needed. Outer Wilds, a very well-known game, has only 4 keywords.
- `similar_games` is **noisy**. Outer Wilds → Madison, Tinykin, *Escape the Backrooms*, Road 96. It's usable as a candidate-pool seed, not as a taste signal.
- Search is **noisy for typeahead**: "hades" → two different "Hades"; "witcher 3" → main game plus two editions; "Super Mario Odyssey" with a main-games filter hit a fan project. The fix is to filter `version_parent = null`, show year and cover, and order by `rating_count` or popularity. ⚠️ I haven't measured how much this improves hit rate.

## Steam Web API

Terms: <https://steamcommunity.com/dev/apiterms>

- ✅ **100,000 calls/day.** The terms require a privacy policy and that you store Steam data only "as requested by the end user". That fits a single-user personal app. ⚠️ Not legal advice.
- ✅ `IPlayerService/GetOwnedGames/v1` with `include_appinfo=1&include_played_free_games=1` returned **121 games** (profile is public). Fields: appid, name, `playtime_forever` (minutes), per-OS playtime, `playtime_deck_forever`, `rtime_last_played`, icon hash.
- ✅ The key is in the query string. The spike helper adds it at call time and redacts it from every error and saved file.

### Steam user tags — PRD correction

The PRD says "Store `appdetails` gives genres/categories but **not** user tags". That's true of `appdetails`, but it isn't the whole story:

- ✅ **`IStoreBrowseService/GetItems/v1`** (on `api.steampowered.com`, the same host as the Web API) with `data_request.include_tag_count=20` returns the **top-20 user tags with weights** for 50 apps per call (the batch size I tested), plus review summary, release info and categories. **121/121 of my apps returned 20 tags** (one returned 0).
- ✅ `IStoreService/GetTagList/v1` maps tag IDs to names. The vocabulary has **446 tags**; my library uses 282 of them (77 used by only one game).
- ⚠️ `GetItems` is **not in the public Steamworks Web API reference** I could find (searched partner.steamgames.com). It's what the Steam store itself uses and is widely used by third parties, but Valve could change it without notice. Mitigation: keep SteamSpy as the fallback adapter.
- ⚠️ The weights are on a different scale from SteamSpy's vote counts (Outer Wilds "Exploration": 927 vs. 1,255). The ordering is the same in my sample. Treat weights as **relative within a game** (normalize per game).
- ✅ Tags look **cleaner than IGDB keywords** for taste. Examples: Hades → Action Roguelike, Roguelite, Hack and Slash, Mythology; BG3 → RPG, Choices Matter, Turn-Based Combat, CRPG.

### The Steam-tag gap for non-Steam games

| Game (typical manual add) | On Steam? | IGDB keywords | IGDB themes |
|---|---|---|---|
| Zelda: Breath of the Wild | ❌ | 78 | 5 |
| Bloodborne | ❌ | 36 | 4 |
| The Last of Us Part II | ❌ | 16 | 4 |
| Metroid Dread | ❌ | **2** | 1 |
| Astro Bot | ❌ | 12 | 2 |
| Hollow Knight | ✅ | 40 | 2 |
| Celeste | ✅ | 33 | 2 |

(The "Super Mario Odyssey" query returned a fan project, as noted above.)

**Steam tags won't exist for console exclusives.** The taste model can't rely on Steam tags alone.

## SteamSpy

Docs: <https://steamspy.com/api.php>

- ✅ Works. `appdetails` returns the **top-20 tags with vote counts**, owner estimates and playtime averages.
- ✅ Limit: **1 req/s** (1 per 60 s for `all`). Data refreshes daily. No attribution clause found.
- Unofficial (third-party) but tolerated with documented limits. **Role: fallback** if `GetItems` breaks.

## RAWG

Docs: <https://rawg.io/apidocs>

- ✅ 20,000 requests/month free; non-commercial; **backlinks required on pages using the data**; no redistribution.
- Not spiked. Per the brief it was "only if IGDB falls short", and IGDB + Steam cover every field we need. **Ruled out for v1.**

## What's still assumed

- Whether IGDB `popularity_primitives` is useful for search ranking or for "recent well-rated releases" (the endpoint exists and returned 10 primitives for Outer Wilds; types not decoded).
- Typeahead hit rate after filtering (not measured).
- Long-term stability of `GetItems` (undocumented).
