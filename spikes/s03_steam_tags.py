"""THROWAWAY SPIKE — Steam user tags via (a) SteamSpy appdetails and (b) official IStoreBrowseService/GetItems."""
import json
import time
import urllib.parse

from _common import FIXTURES, RAW, http, save, steam

APPIDS = [753640, 1145360, 413150, 1086940]  # Outer Wilds, Hades, Stardew, BG3

# (a) SteamSpy — documented limit 1 req/s
spy = {}
for a in APPIDS:
    status, body = http("GET", f"https://steamspy.com/api.php?request=appdetails&appid={a}")
    d = json.loads(body) if status == 200 else {}
    tags = d.get("tags") or {}
    spy[a] = d
    top = sorted(tags.items(), key=lambda kv: -kv[1])[:8] if isinstance(tags, dict) else tags
    print(f"SteamSpy {a} {d.get('name')!r}: HTTP {status}, {len(tags)} tags, top: {top}")
    time.sleep(1.1)
save(RAW / "steamspy_sample.json", spy)

# (b) Official: tag names, then GetItems with tag weights
tl = steam("IStoreService/GetTagList/v1/", {"language": "english"})
tagnames = {t["tagid"]: t["name"] for t in tl["response"]["tags"]}
print(f"\nIStoreService/GetTagList: {len(tagnames)} tags defined")

req = {"ids": [{"appid": a} for a in APPIDS],
       "context": {"language": "english", "country_code": "US"},
       "data_request": {"include_tag_count": 20, "include_basic_info": True,
                        "include_release": True, "include_reviews": True}}
r = steam("IStoreBrowseService/GetItems/v1/", {"input_json": json.dumps(req)})
items = r["response"]["store_items"]
save(RAW / "steam_getitems_sample.json", items)
for it in items:
    tags = it.get("tags", [])
    print(f"GetItems {it.get('appid')} {it.get('name')!r}: {len(tags)} tags; "
          f"keys={sorted(it.keys())[:14]}")
    print("   ", [(tagnames.get(t['tagid'], t['tagid']), t.get('weight')) for t in tags[:10]])

save(FIXTURES / "steam_tags_sample.json", {
    "steamspy_appdetails": {a: {"name": d.get("name"), "tags": d.get("tags")} for a, d in spy.items()},
    "getitems": [{"appid": it.get("appid"), "name": it.get("name"), "tags": it.get("tags"),
                  "reviews": it.get("reviews")} for it in items],
    "taglist_sample": dict(list(tagnames.items())[:50])})
