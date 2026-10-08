# versus runbook

Operations for the deployed app. Design background: `docs/specs/2026-10-06-versus-design.md` §10.
Commands run from the repo root in Git Bash unless noted.

## Deploy a change

```bash
npm run typecheck && npm test        # never deploy red
npm run deploy                       # build the PWA, apply new D1 migrations (remote), deploy the Worker
```

The PWA updates on the next launch (the service worker fetches the network first).

## Secrets

| Where | Names | Set with |
|---|---|---|
| Cloudflare Worker | `APP_PASSPHRASE`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `STEAM_API_KEY`, `STEAM_ID64`, `SESSION_KEY`, `BACKUP_TOKEN` | `npm run secrets:push -- --url <worker URL>` |
| GitHub `BrunoBensadon/versus-backup` → Actions secrets | `BACKUP_TOKEN`, `VERSUS_URL` | the same command |
| This machine | everything, in `.env` (git-ignored); `.dev.vars` for local dev | `npm run dev-vars` |

`secrets:push` takes `.env` values for the first five and **generates new** `SESSION_KEY` and
`BACKUP_TOKEN` on every run, so running it again is how you rotate them. Rotating `SESSION_KEY` logs
every device out. To change only the passphrase: edit `.env`, then

```bash
PASS=$(node -e "process.loadEnvFile('.env'); const v = process.env.APP_PASSPHRASE; if (!v) { console.error('APP_PASSPHRASE is missing in .env'); process.exit(1); } process.stdout.write(v)") && printf '%s' "$PASS" | npx wrangler secret put APP_PASSPHRASE; unset PASS
```

It reads `.env` the same way `secrets:push` does (quotes and Windows line endings are stripped), and
wrangler only runs if the value was found. `tests/scripts/secrets.test.ts` runs this exact `node -e` part.

## Backups: three layers

1. **D1 Time Travel**: any minute in the last 7 days on the free plan, nothing to set up. (`wrangler`'s
   help text says 30 days; ⚠️ assumed to be the paid-plan window. Plan on 7.)
2. **Nightly GitHub Action** in the private repo `BrunoBensadon/versus-backup` (03:17 UTC). It saves
   `events.jsonl`, `library.json`, `sublists.json`, `games.json`, `external_ids.json`, `meta.json`;
   the git history is the versioned copy. Settings in the app shows the last backup's age, **in red
   after 3 days**. If it's red: open the backup repo → Actions → read the failed run (a GitHub email
   is sent on failure by default ⚠️ check your notification settings once).
3. **Manual export**: Settings → Export → Everything (JSON). Keep exports out of this public repo
   (`exports/` is git-ignored).

## Restore

The `events` table refuses UPDATE and DELETE, so you never restore *into* a damaged database. You
restore into a **new** one and point the Worker at it.

### A. Undo a recent mistake (last 7 days): Time Travel

```bash
npx wrangler d1 time-travel info versus                                  # current bookmark
npx wrangler d1 time-travel restore versus --timestamp=2026-10-06T21:00:00Z   # a time BEFORE the mistake
```

This rewinds the live database in place (and prints a bookmark to undo the rewind).

### B. Anything older, or the database is gone: from the backup repo

```bash
git clone https://github.com/BrunoBensadon/versus-backup ../versus-backup       # private: gh auth needed
git -C ../versus-backup checkout <commit-of-the-night-you-want>                  # or stay on the latest
npm run restore -- ../versus-backup restore.sql                                   # the folder, or an export .json
npx wrangler d1 create versus-restored                                            # prints a database_id
```

Put the new `database_id` (and `"database_name": "versus-restored"`) in `wrangler.jsonc`, then:

```bash
npx wrangler d1 migrations apply versus-restored --remote
npx wrangler d1 execute versus-restored --remote --file restore.sql
rm restore.sql                                                                    # it holds the whole log
npm run deploy
```

Check: log in → My ranking shows the same order; Settings → Export → compare the event count with
`wc -l ../versus-backup/events.jsonl`. Commit the `wrangler.jsonc` change.

## Acceptance log

| Date | Check | Result |
|---|---|---|
| | Install from Chrome on the S26; rank one just-finished game in < 1 min (NF-1) | |
| | First nightly backup committed; restore drill B into a scratch database matched the event count | |
| 2026-10-08 | Steam import CPU: `wrangler tail` showed no `exceededCpu` | ✅ Passed, with a warning. Two imports (121 owned · 118 found on IGDB; the second: 0 new · 113 updated): outcome `ok`, **cpuTime 41 ms and 43 ms**, wall 4.6–5.7 s. That is ~4× the documented 10 ms Workers Free limit, yet Cloudflare didn't stop it (⚠️ assumed grace, not guaranteed). `GET /api/library` with ~110 games: 11 ms. Every other request 0–3 ms. **If `exceededCpu` ever appears:** split the import into two requests (owned + mapping, then tags + time-to-beat), as planned. |
| 2026-10-08 | D1 per-invocation limit: the Steam import (~400 statements in one batch) and a large event POST showed no "Too many API requests by single Worker invocation" error in `wrangler tail` (⚠️ unverified whether batch statements count toward Workers Free's 50; fallback: set-based `INSERT … SELECT FROM json_each(?)`, see the roadmap) | ✅ No such error in 160 requests: two full imports, ~110 library PUTs, 23 event POSTs. The import's batch is far above 50 statements, so batch statements don't count one by one. The single *large* event POST wasn't sent; it's covered by the same evidence (inferred). |
| | ≥ 20 ranked games: `npm run eval` run; `SCORER` set by the ship rule | |
