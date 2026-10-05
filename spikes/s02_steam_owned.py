"""THROWAWAY SPIKE — Steam GetOwnedGames for STEAM_ID64 (include_appinfo, include_played_free_games)."""
import statistics

from _common import ENV, FIXTURES, RAW, save, steam

r = steam("IPlayerService/GetOwnedGames/v1/", {
    "steamid": ENV["STEAM_ID64"], "include_appinfo": 1, "include_played_free_games": 1,
    "format": "json"})
resp = r.get("response", {})
games = resp.get("games", [])
if not games:
    raise SystemExit("GetOwnedGames returned 0 games. Check Steam profile > Privacy > "
                     "'Game details' is Public (response keys: %s)" % list(resp.keys()))

save(RAW / "steam_owned.json", resp)
mins = [g.get("playtime_forever", 0) for g in games]
played = [g for g in games if g.get("playtime_forever", 0) > 0]
print(f"owned games: {resp.get('game_count')} (list len {len(games)})")
print(f"played >0 min: {len(played)} | >2h: {sum(m > 120 for m in mins)} | >10h: {sum(m > 600 for m in mins)}")
print(f"median playtime of played: {statistics.median([g['playtime_forever'] for g in played]) / 60:.1f} h")
print("fields per entry:", sorted(games[0].keys()))
print("top 15 by playtime:")
for g in sorted(games, key=lambda g: -g.get("playtime_forever", 0))[:15]:
    print(f"  {g['appid']:>8}  {g['playtime_forever'] / 60:7.1f} h  {g.get('name')}")

# Trimmed fixture: 25 entries, only fields we'd use
keep = ("appid", "name", "playtime_forever", "rtime_last_played", "img_icon_url")
fixture = [{k: g.get(k) for k in keep} for g in sorted(games, key=lambda g: g["appid"])[:25]]
save(FIXTURES / "steam_owned_sample.json", {"game_count": len(fixture), "games": fixture})
