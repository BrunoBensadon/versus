"""THROWAWAY SPIKE — coverage of Bruno's actual Steam library in IGDB + Steam tags.

Maps every owned appid -> IGDB game via external_games (source 1 = Steam), then measures
metadata density and the duplicate/edition/noise problems. Reads spikes/raw/steam_owned.json
(run s02 first).
"""
import collections
import json
import statistics

from _common import FIXTURES, RAW, igdb, save, steam

owned = json.loads((RAW / "steam_owned.json").read_text(encoding="utf-8"))["games"]
appids = [g["appid"] for g in owned]
name_of = {g["appid"]: g["name"] for g in owned}
played = {g["appid"] for g in owned if g.get("playtime_forever", 0) > 0}

# 1. appid -> IGDB external_games rows
ext = []
for i in range(0, len(appids), 200):
    chunk = ",".join(f'"{a}"' for a in appids[i:i + 200])
    ext += igdb("external_games", f"fields uid,game,name; where external_game_source = 1 & uid = ({chunk}); limit 500;")
by_app = collections.defaultdict(set)
for e in ext:
    by_app[int(e["uid"])].add(e["game"])

mapped = {a: g for a, g in by_app.items() if len(g) == 1}
multi = {a: g for a, g in by_app.items() if len(g) > 1}
unmapped = [a for a in appids if a not in by_app]

# 2. Fetch IGDB records for every mapped game id
gids = sorted({gid for s in by_app.values() for gid in s})
F = ("name,game_type.type,genres.name,themes.name,keywords.name,game_modes.name,"
     "player_perspectives.name,franchises.name,collections.name,similar_games,"
     "involved_companies.company.name,rating_count,aggregated_rating_count,first_release_date,"
     "parent_game,version_parent,remasters,remakes")
games = {}
for i in range(0, len(gids), 200):
    ids = ",".join(map(str, gids[i:i + 200]))
    for g in igdb("games", f"fields {F}; where id = ({ids}); limit 500;"):
        games[g["id"]] = g
ttb = {}
for i in range(0, len(gids), 200):
    ids = ",".join(map(str, gids[i:i + 200]))
    for t in igdb("game_time_to_beats", f"fields game_id,normally,count; where game_id = ({ids}); limit 500;"):
        ttb[t["game_id"]] = t

# 3. Steam tags for every owned app (official GetItems, batches of 50)
stags = {}
for i in range(0, len(appids), 50):
    req = {"ids": [{"appid": a} for a in appids[i:i + 50]],
           "context": {"language": "english", "country_code": "US"},
           "data_request": {"include_tag_count": 20}}
    r = steam("IStoreBrowseService/GetItems/v1/", {"input_json": json.dumps(req)})
    for it in r["response"].get("store_items", []):
        stags[it.get("appid") or it.get("id", {}).get("appid")] = it.get("tags", [])

# 4. Report
def n(g, k): return len(g.get(k, []) or [])
def dist(vals):
    vals = sorted(vals)
    return (f"median {statistics.median(vals):.0f}, p10 {vals[len(vals)//10]}, "
            f"p90 {vals[9*len(vals)//10]}, zero {sum(v == 0 for v in vals)}/{len(vals)}")

print(f"Owned: {len(appids)} | played: {len(played)}")
print(f"Mapped to exactly 1 IGDB game: {len(mapped)} ({len(mapped)/len(appids):.0%}); "
      f"played-only: {sum(a in mapped for a in played)}/{len(played)}")
print(f"Mapped to >1 IGDB game: {len(multi)}")
for a, s in multi.items():
    print(f"   {a} {name_of[a]!r} -> {[(gid, games.get(gid, {}).get('name'), games.get(gid, {}).get('game_type', {}).get('type')) for gid in s]}")
print(f"Unmapped: {len(unmapped)}")
for a in unmapped:
    print(f"   {a} {name_of[a]!r}{'  (played)' if a in played else ''}")

types = collections.Counter(games[next(iter(s))].get("game_type", {}).get("type")
                            for a, s in mapped.items() if next(iter(s)) in games)
print("\nIGDB game_type of mapped entries:", dict(types))
odd = [(name_of[a], games[next(iter(s))]["name"], games[next(iter(s))].get("game_type", {}).get("type"))
       for a, s in mapped.items() if games.get(next(iter(s)), {}).get("game_type", {}).get("type") not in ("Main Game", None)]
for o in odd:
    print("   non-main:", o)

M = [games[next(iter(s))] for s in mapped.values() if next(iter(s)) in games]
print(f"\nIGDB metadata density over {len(M)} mapped games:")
for k in ("genres", "themes", "keywords", "game_modes", "player_perspectives", "franchises",
          "collections", "similar_games", "involved_companies"):
    print(f"   {k:20} {dist([n(g, k) for g in M])}")
print(f"   rating_count         {dist([g.get('rating_count', 0) for g in M])}")
print(f"   time_to_beat present {sum(g['id'] in ttb for g in M)}/{len(M)}; "
      f"with count>=5: {sum(ttb.get(g['id'], {}).get('count', 0) >= 5 for g in M)}")

print(f"\nSteam tags (official GetItems) over {len(appids)} apps:")
print(f"   tags per app         {dist([len(stags.get(a, [])) for a in appids])}")

kw = collections.Counter(k["name"] for g in M for k in g.get("keywords", []) or [])
print(f"\nDistinct IGDB keywords across library: {len(kw)}; used by only 1 game: "
      f"{sum(c == 1 for c in kw.values())}")
print("   most common:", kw.most_common(15))
st = collections.Counter(t["tagid"] for a in appids for t in stags.get(a, []))
print(f"Distinct Steam tags across library: {len(st)}; used by only 1 game: "
      f"{sum(c == 1 for c in st.values())}")

# 5. Fixture: compact, secret-free mapping table + per-game density
save(FIXTURES / "library_coverage.json", {
    "summary": {"owned": len(appids), "played": len(played), "mapped_1to1": len(mapped),
                "mapped_multi": len(multi), "unmapped": len(unmapped)},
    "unmapped": [{"appid": a, "name": name_of[a]} for a in unmapped],
    "multi": [{"appid": a, "name": name_of[a], "igdb_ids": sorted(s)} for a, s in multi.items()],
    "games": [{"appid": a, "steam_name": name_of[a], "igdb_id": next(iter(s)),
               "igdb_name": games.get(next(iter(s)), {}).get("name"),
               "game_type": games.get(next(iter(s)), {}).get("game_type", {}).get("type"),
               "n_keywords": n(games.get(next(iter(s)), {}), "keywords"),
               "n_themes": n(games.get(next(iter(s)), {}), "themes"),
               "n_steam_tags": len(stags.get(a, []))} for a, s in sorted(mapped.items())],
})
save(RAW / "library_igdb_games.json", list(games.values()))
save(RAW / "library_steam_tags.json", {str(k): v for k, v in stags.items()})
