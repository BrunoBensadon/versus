"""THROWAWAY SPIKE — (a) duplicate/edition clusters inside the owned library, (b) Steam-tag coverage for
non-Steam games (console exclusives / manual adds), (c) IGDB search quality for typeahead."""
import collections, json
from _common import RAW, FIXTURES, igdb, save

games = {g["id"]: g for g in json.loads((RAW / "library_igdb_games.json").read_text(encoding="utf-8"))}
cov = json.loads((FIXTURES / "library_coverage.json").read_text(encoding="utf-8"))["games"]
mine = {c["igdb_id"] for c in cov}

# (a) cluster by version_parent / parent_game / remasters / remakes links, and by shared collection
edges = collections.defaultdict(set)
for gid, g in games.items():
    for k in ("version_parent", "parent_game"):
        if g.get(k): edges[gid].add(g[k]); edges[g[k]].add(gid)
    for k in ("remasters", "remakes"):
        for o in g.get(k) or []: edges[gid].add(o); edges[o].add(gid)
print("(a) owned games linked to ANOTHER owned game via version_parent/parent_game/remaster/remake:")
seen = set()
for gid in mine:
    linked = edges[gid] & mine
    if linked and gid not in seen:
        grp = {gid} | linked; seen |= grp
        print("   ", [(x, games[x]["name"], games[x].get("game_type", {}).get("type")) for x in grp])
print("   parent/version links pointing OUTSIDE the library (edition of a game I don't 'own' under that id):")
for gid in mine:
    g = games[gid]
    for k in ("version_parent", "parent_game"):
        if g.get(k) and g[k] not in mine:
            print(f"     {g['name']!r} --{k}--> {g[k]}")

# (b) Steam presence for well-known console-only or multi-platform games
titles = ["The Legend of Zelda: Breath of the Wild", "Bloodborne", "Super Mario Odyssey",
          "The Last of Us Part II", "Hollow Knight", "Celeste", "Metroid Dread", "Astro Bot"]
print("\n(b) Does a Steam appid exist for typical manual adds?")
rows = []
for t in titles:
    h = igdb("games", f'search "{t}"; fields name,game_type.type,external_games.external_game_source,keywords,themes; where game_type = (0,8,9,10); limit 1;')
    if not h: print(f"   {t}: NOT FOUND"); continue
    g = h[0]; srcs = {e.get("external_game_source") for e in g.get("external_games", []) or []}
    rows.append({"query": t, "igdb_name": g["name"], "has_steam": 1 in srcs,
                 "n_keywords": len(g.get("keywords") or []), "n_themes": len(g.get("themes") or [])})
    print(f"   {g['name']!r:45} steam={1 in srcs!s:5} keywords={len(g.get('keywords') or []):3} themes={len(g.get('themes') or [])}")

# (c) typeahead: partial queries
print("\n(c) IGDB search for partial / sloppy input (top 3, main games + remakes/remasters):")
for q in ["witcher 3", "bg3", "zelda tears", "hades", "outer wild"]:
    h = igdb("games", f'search "{q}"; fields name,game_type.type; where game_type = (0,8,9,10); limit 3;')
    print(f"   {q!r:14} -> {[x['name'] for x in h]}")
save(FIXTURES / "manual_add_steam_presence.json", rows)
