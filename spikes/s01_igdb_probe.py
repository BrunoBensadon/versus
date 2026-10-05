"""THROWAWAY SPIKE — probe IGDB: auth, search, the metadata fields we need, time-to-beat, sources."""
import json
import sys

from _common import FIXTURES, RAW, igdb, save

FIELDS = ("name,slug,first_release_date,game_type.type,genres.name,themes.name,keywords.name,"
          "game_modes.name,player_perspectives.name,franchises.name,collections.name,"
          "involved_companies.company.name,involved_companies.developer,platforms.abbreviation,"
          "rating,rating_count,aggregated_rating,aggregated_rating_count,total_rating,"
          "similar_games.name,parent_game,version_parent,remakes,remasters,"
          "external_games.uid,external_games.external_game_source.name,cover.image_id")

title = sys.argv[1] if len(sys.argv) > 1 else "Outer Wilds"

print("== external_game_sources (what IDs IGDB links to)")
srcs = igdb("external_game_sources", "fields id,name; limit 100;")
print(", ".join(f"{s['id']}={s['name']}" for s in srcs))

print(f"\n== search '{title}'")
hits = igdb("games", f'search "{title}"; fields id,name,game_type.type,first_release_date; limit 10;')
for h in hits:
    print(f"  {h['id']:>7}  {h['name']!r:45} type={h.get('game_type', {}).get('type')}")

gid = hits[0]["id"]
g = igdb("games", f"fields {FIELDS}; where id = {gid};")[0]
save(RAW / f"igdb_game_{gid}.json", g)

ttb = igdb("game_time_to_beats", f"fields *; where game_id = {gid};")
pop = igdb("popularity_primitives", f"fields game_id,popularity_type,value; where game_id = {gid}; limit 20;")

def names(k):
    return [x.get("name") for x in g.get(k, [])]

print(f"\n== {g['name']} (id {gid})")
for k in ("genres", "themes", "keywords", "game_modes", "player_perspectives", "franchises",
          "collections", "similar_games"):
    v = names(k)
    print(f"  {k:20} n={len(v):3}  {v[:12]}{' …' if len(v) > 12 else ''}")
print("  ratings:", {k: g.get(k) for k in ("rating", "rating_count", "aggregated_rating",
                                         "aggregated_rating_count")})
print("  external ids:", [(e.get("external_game_source", {}).get("name"), e.get("uid"))
                         for e in g.get("external_games", [])][:12])
print("  time_to_beat:", ttb)
print("  popularity primitives:", len(pop), pop[:3])

save(FIXTURES / "igdb_game_sample.json", {"game": g, "time_to_beat": ttb,
                                          "external_game_sources": srcs})
