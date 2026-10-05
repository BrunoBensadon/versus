"""THROWAWAY SPIKE CODE — not production. Shared helpers for the Phase 1 data-source spikes.

- Loads credentials from ../.env (git-ignored) into a dict; never prints values.
- Every string that leaves this module (errors, logs, saved JSON) goes through redact().
- Raw dumps go to spikes/raw/ (git-ignored); only trimmed fixtures go to spikes/fixtures/.
"""
import json
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
RAW = ROOT / "raw"
CACHE = ROOT / ".cache"
FIXTURES = ROOT / "fixtures"
for d in (RAW, CACHE, FIXTURES):
    d.mkdir(exist_ok=True)


def _load_env():
    env = {}
    path = ROOT.parent / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.replace("export ", "").strip()] = v.strip().strip('"').strip("'")
    for k in ("TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "STEAM_API_KEY", "STEAM_ID64"):
        env.setdefault(k, os.environ.get(k, ""))
    return env


ENV = _load_env()
_SECRETS = [v for k, v in ENV.items() if v and k != "STEAM_ID64"]
_token_holder = {}


def redact(s: str) -> str:
    s = str(s)
    for v in _SECRETS + list(_token_holder.values()):
        if v:
            s = s.replace(v, "***")
    if ENV.get("STEAM_ID64"):
        s = s.replace(ENV["STEAM_ID64"], "<STEAM_ID64>")
    return s


def http(method, url, data=None, headers=None, retries=4):
    body = data.encode() if isinstance(data, str) else data
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        req.add_header("User-Agent", "versus-spike/0.1 (personal project)")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            return e.code, redact(e.read().decode("utf-8", "ignore")[:500])
        except urllib.error.URLError as e:
            host = urllib.parse.urlparse(url).hostname
            raise SystemExit(f"NETWORK ERROR reaching host {host}: {redact(e.reason)}")


def save(path: pathlib.Path, obj):
    path.write_text(redact(json.dumps(obj, indent=2, ensure_ascii=False)), encoding="utf-8")


# ---------- IGDB ----------
_last_igdb = [0.0]


def igdb_token():
    cache = CACHE / "igdb_token.json"
    if cache.exists():
        t = json.loads(cache.read_text())
        if t["expires_at"] > time.time() + 3600:
            _token_holder["igdb"] = t["access_token"]
            return t["access_token"]
    q = urllib.parse.urlencode({
        "client_id": ENV["TWITCH_CLIENT_ID"],
        "client_secret": ENV["TWITCH_CLIENT_SECRET"],
        "grant_type": "client_credentials",
    })
    status, body = http("POST", "https://id.twitch.tv/oauth2/token?" + q)
    if status != 200:
        raise SystemExit(f"Twitch token exchange failed: HTTP {status} {redact(body)}")
    t = json.loads(body)
    _token_holder["igdb"] = t["access_token"]
    cache.write_text(json.dumps({"access_token": t["access_token"],
                                 "expires_at": time.time() + t["expires_in"]}))
    return t["access_token"]


def igdb(endpoint, query):
    """POST an APICalypse query. Throttled to <4 req/s."""
    tok = igdb_token()
    wait = 0.27 - (time.time() - _last_igdb[0])
    if wait > 0:
        time.sleep(wait)
    _last_igdb[0] = time.time()
    status, body = http("POST", f"https://api.igdb.com/v4/{endpoint}", data=query, headers={
        "Client-ID": ENV["TWITCH_CLIENT_ID"], "Authorization": f"Bearer {tok}",
        "Accept": "application/json"})
    if status != 200:
        raise SystemExit(f"IGDB {endpoint} HTTP {status}: {redact(body)}")
    return json.loads(body)


# ---------- Steam ----------
def steam(path, params):
    """Call api.steampowered.com. The key is added here and never returned/logged."""
    p = dict(params)
    p["key"] = ENV["STEAM_API_KEY"]
    url = f"https://api.steampowered.com/{path}?" + urllib.parse.urlencode(p)
    status, body = http("GET", url)
    if status != 200:
        raise SystemExit(f"Steam {path} HTTP {status}: {redact(body)}")
    return json.loads(body)
