# spikes/ — THROWAWAY

Exploration scripts from the 2026-10-05 design session. **Not production code.** Do not import from
here; delete or rewrite freely.

- `_common.py` — loads `../.env`, redacts secrets from all output, throttled IGDB + Steam helpers
- `s01_igdb_probe.py [title]` — IGDB auth, search, metadata fields, time-to-beat
- `s02_steam_owned.py` — Steam `GetOwnedGames` for `STEAM_ID64`
- `s03_steam_tags.py` — Steam tags via SteamSpy and official `IStoreBrowseService/GetItems`
- `s04_coverage.py` — maps the whole owned library to IGDB, measures metadata density (needs s02 first)
- `s05_dupes_and_gaps.py` — duplicate/edition clusters, Steam-tag gap for console games, search quality

Run with `python sNN_*.py` from this folder (stdlib only, Python 3.11+).

`fixtures/` — trimmed, secret-free real responses, kept for later tests.
`raw/`, `.cache/` — full dumps and the IGDB token; git-ignored.
