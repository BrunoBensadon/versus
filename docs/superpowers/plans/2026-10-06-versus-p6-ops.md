# versus Plan 6 — Deploy, backups, restore drill, phone acceptance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put versus live on Cloudflare's free tier with all secrets set, a nightly backup in the private repo, a rehearsed restore, and Bruno's real-phone acceptance check (NF-1). After this, v1 is done.

**Architecture:** Task 1 adds the operations code: a secrets script, the backup split/read pair with a round-trip test, restore from a backup folder, and a runbook. It's ordinary TDD in this repo. Tasks 2–4 run commands against **Bruno's Cloudflare and GitHub accounts**; they have no test cycle, only checks.

**Tech Stack:** Wrangler 4.147.0 (`d1 create`, `secret put`, `deploy`, `tail`, `d1 time-travel`), GitHub CLI (`gh secret set`, `gh workflow run`), GitHub Actions in `BrunoBensadon/versus-backup`.

**Spec:** `docs/specs/2026-10-06-versus-design.md` §10 (hosting, auth, secrets, durability), §11 (manual row), §14 (Bruno's setup tasks: all done), decision D20.
**Roadmap:** `docs/superpowers/plans/2026-10-06-versus-v1-roadmap.md`. This is Plan 6 of 6 and needs Plans 1–5 merged.

## Global Constraints

- **Tasks 2–4 change Bruno's real accounts.** An agent executing this plan must show each command and get Bruno's go-ahead before running it (creating the D1 database, setting secrets, deploying, pushing to the backup repo, creating or deleting the drill database). Bruno can also run them himself with the `!` prefix in Claude Code.
- Secrets never appear on a command line, in a log, or in a commit. `npm run secrets:push` sends values through stdin. `.env`, `.dev.vars`, exports, restore `.sql` files and backup clones stay outside this public repo (all git-ignored or outside the folder).
- The D1 `database_id` in `wrangler.jsonc` is **not** a secret (using it needs Bruno's Cloudflare login), so it is committed.
- Free tiers only (NF-2): Workers Free (✅ 10 ms CPU per request, 100k requests/day), D1 free (✅ 5 GB, 100k writes/day), GitHub Actions on a private repo (✅ 2,000 minutes/month).
- ⚠️ Unverified until Task 2: whether the Steam import (~120 games) fits in **10 ms of CPU**. It makes ~10 upstream requests, and waiting on those doesn't count as CPU, but parsing ~1 MB of JSON might. Task 2 measures it. The fallback, if needed, is splitting the import into two requests; that's a follow-up, not built speculatively.
- ⚠️ `wrangler secret put` reading the value from stdin and `d1 time-travel restore` are used as documented by Cloudflare; neither was run while writing this plan (that would have touched the real account).
- Commits end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `scripts/push-secrets.ts` | `npm run secrets:push -- --url <worker URL> [--dry-run]` |
| `scripts/backup-files.ts` | `readBackupDir(dir): ExportFile` (backup repo clone → export) |
| `scripts/restore.ts` | now accepts an export file **or** a backup folder |
| `ops/versus-backup/split-export.mjs` | runs in the backup repo: export → six diff-friendly files |
| `ops/versus-backup/backup.yml` | the backup repo's nightly workflow |
| `tests/scripts/backup-roundtrip.test.ts` | split → read back = identical export |
| `docs/runbook.md` | deploy, secrets, backups, restore A/B, acceptance log |
| `wrangler.jsonc` | real `database_id` (Task 2) |

---

### Task 1: Operations tooling and runbook

**Files:**
- Create: `scripts/push-secrets.ts`, `scripts/backup-files.ts`, `ops/versus-backup/split-export.mjs`, `ops/versus-backup/backup.yml`, `docs/runbook.md`
- Modify: `scripts/restore.ts`, `vitest.config.ts`, `tsconfig.json`, `package.json` (scripts)
- Test: `tests/scripts/backup-roundtrip.test.ts`

**Interfaces:**
- Consumes: `ExportFile` (Plan 1), `restoreStatements` (Plan 4), `syntheticDataset` (Plan 2 fixture).
- Produces: `readBackupDir(dir: string): ExportFile`; the backup folder layout `meta.json` (`{version, exportedAt}`), `events.jsonl` (one event per line), `library.json`, `sublists.json`, `games.json`, `external_ids.json`; scripts `npm run deploy`, `npm run secrets:push`.

- [ ] **Step 1: Branch, and let the unit suite see `tests/scripts`**

```bash
git checkout main && git pull && git checkout -b p6-ops
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// Unit tests for the pure core (ranking, recommender, catalog), the web app's pure helpers and the
// command-line scripts. They run in plain Node.
export default defineConfig({
  test: {
    include: ['tests/core/**/*.test.ts', 'tests/web/**/*.test.ts', 'tests/scripts/**/*.test.ts', 'tests/boundary.test.ts'],
    environment: 'node',
  },
});
```

`tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["src/core", "src/web", "tests/core", "tests/web", "tests/scripts", "tests/e2e", "tests/fixtures", "tests/boundary.test.ts", "scripts", "vite.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 2: Write the failing test**

`tests/scripts/backup-roundtrip.test.ts`:

```ts
// The backup format round-trips: export → split-export.mjs (what the nightly job runs) → readBackupDir
// gives back exactly the same export, so `npm run restore` from the backup repo loses nothing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExportFile } from '../../src/core/types';
import { readBackupDir } from '../../scripts/backup-files';
import { syntheticDataset } from '../fixtures/synthetic';

const SPLIT = resolve(__dirname, '../../ops/versus-backup/split-export.mjs');
const dir = mkdtempSync(join(tmpdir(), 'versus-backup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function sampleExport(): ExportFile {
  const d = syntheticDataset({ games: 12, seed: 4, noise: 0.3 });
  return {
    version: 1,
    exportedAt: '2026-10-06T03:17:00.000Z',
    events: d.events,
    library: [{ gameId: 1, status: 'played', bucket: 'loved', platforms: ['PC'], source: 'steam', steamPlaytimeMin: 5, addedAt: 'a', updatedAt: 'b' }],
    games: d.games,
    externalIds: [{ source: 'steam', uid: '10', gameId: 1 }],
    sublists: [{ id: 's', name: "Bruno's", kind: 'set', filter: null, items: [1, 2], createdAt: 'c' }],
  };
}

describe('backup files', () => {
  it('split-export.mjs writes the six files and readBackupDir reads back the identical export', () => {
    const original = sampleExport();
    writeFileSync(join(dir, 'export.json'), JSON.stringify(original));
    execFileSync(process.execPath, [SPLIT, 'export.json'], { cwd: dir });
    expect(readdirSync(dir).sort()).toEqual(['events.jsonl', 'export.json', 'external_ids.json', 'games.json', 'library.json', 'meta.json', 'sublists.json']);
    expect(readBackupDir(dir)).toEqual(original);
  });

  it('split-export.mjs refuses something that is not an export', () => {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ hello: 1 }));
    expect(() => execFileSync(process.execPath, [SPLIT, 'bad.json'], { cwd: dir, stdio: 'pipe' })).toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/scripts`
Expected: FAIL with `Failed to resolve import "../../scripts/backup-files"`.

- [ ] **Step 4: Implement the backup pair and restore-from-folder**

`ops/versus-backup/split-export.mjs`:

```js
// Runs in the PRIVATE repo BrunoBensadon/versus-backup (copied there from versus/ops/versus-backup/).
// Splits one GET /api/export response into small, diff-friendly files, so the git history of that
// repo is the versioned off-site backup (spec §10). Plain Node, no dependencies.
//   node split-export.mjs export.json
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node split-export.mjs <export.json>');
  process.exit(1);
}
const file = JSON.parse(readFileSync(path, 'utf8'));
if (file.version !== 1 || !Array.isArray(file.events)) {
  console.error('Not a versus export (expected version 1 with an events array).');
  process.exit(1);
}
const pretty = (x) => `${JSON.stringify(x, null, 2)}\n`;
writeFileSync('meta.json', pretty({ version: file.version, exportedAt: file.exportedAt }));
writeFileSync('events.jsonl', file.events.map((e) => JSON.stringify(e)).join('\n') + (file.events.length > 0 ? '\n' : ''));
writeFileSync('library.json', pretty(file.library));
writeFileSync('sublists.json', pretty(file.sublists));
writeFileSync('games.json', pretty(file.games));
writeFileSync('external_ids.json', pretty(file.externalIds));
console.log(`Split ${file.events.length} events, ${file.library.length} library rows, ${file.games.length} games.`);
```

`scripts/backup-files.ts`:

```ts
// Read a backup folder (the files ops/versus-backup/split-export.mjs writes) back into one export,
// so `npm run restore` works from a clone of the backup repo as well as from an export file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExportFile } from '../src/core/types';

export function readBackupDir(dir: string): ExportFile {
  const json = <T>(name: string): T => JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
  const meta = json<{ version: 1; exportedAt: string }>('meta.json');
  const lines = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim().length > 0);
  return {
    version: meta.version,
    exportedAt: meta.exportedAt,
    events: lines.map((l) => JSON.parse(l) as ExportFile['events'][number]),
    library: json('library.json'),
    games: json('games.json'),
    externalIds: json('external_ids.json'),
    sublists: json('sublists.json'),
  };
}
```

`scripts/restore.ts` (replaces the Plan 4 version):

```ts
// Restore an export into a fresh D1 database (spec §10; runbook in docs/runbook.md).
//   npm run restore -- <export.json | backup-folder> <restore.sql>
//   npx wrangler d1 migrations apply versus --remote     (on the NEW, empty database)
//   npx wrangler d1 execute versus --remote --file <restore.sql>
// The .sql file contains the full log: treat it like the export (never commit it).

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import type { ExportFile } from '../src/core/types';
import { readBackupDir } from './backup-files';
import { restoreStatements } from './restore-sql';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: npm run restore -- <export.json | backup-folder> <restore.sql>');
  process.exit(1);
}
// A folder is a clone of the backup repo; a file is an export downloaded from the app.
const file = statSync(input).isDirectory() ? readBackupDir(input) : (JSON.parse(readFileSync(input, 'utf8')) as ExportFile);
const statements = restoreStatements(file, new Date().toISOString());
writeFileSync(output, `${statements.join('\n')}\n`);
console.log(`Wrote ${statements.length} statements (${file.events.length} events) to ${output}`);
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/scripts`
Expected: PASS (2 tests).

- [ ] **Step 6: The nightly workflow (kept here, copied to the backup repo in Task 3)**

`ops/versus-backup/backup.yml`:

```yaml
# Nightly backup of versus (spec §10, durability layer 2). Lives in the PRIVATE repo
# BrunoBensadon/versus-backup at .github/workflows/backup.yml, next to split-export.mjs.
# Source of truth: versus/ops/versus-backup/ (copy both files over when they change).
# GitHub only auto-disables scheduled workflows in PUBLIC repos after 60 days without activity;
# this repo is private and commits every night anyway.
name: Nightly backup

on:
  schedule:
    - cron: '17 3 * * *' # 03:17 UTC every day
  workflow_dispatch: # "Run workflow" button for a manual backup

permissions:
  contents: write

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v5

      - name: Download the export
        env:
          VERSUS_URL: ${{ secrets.VERSUS_URL }}
          BACKUP_TOKEN: ${{ secrets.BACKUP_TOKEN }}
        run: |
          curl --fail --silent --show-error \
            -H "Authorization: Bearer $BACKUP_TOKEN" \
            "$VERSUS_URL/api/export" -o export.json

      - name: Split into diff-friendly files
        run: |
          node split-export.mjs export.json
          rm export.json

      - name: Commit if anything changed
        run: |
          git config user.name "versus-backup"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add meta.json events.jsonl library.json sublists.json games.json external_ids.json
          git diff --cached --quiet -- events.jsonl library.json sublists.json games.json external_ids.json \
            && echo "No data changes since the last backup." \
            || { git commit -m "backup $(date -u +%F)" && git push; }
```

- [ ] **Step 7: The secrets script**

`scripts/push-secrets.ts`:

```ts
// Push the production secrets (spec §10) without ever printing them:
//   - Worker secrets → Cloudflare (`wrangler secret put`), from .env plus two freshly generated values
//     (SESSION_KEY, BACKUP_TOKEN);
//   - BACKUP_TOKEN and the app URL → the private backup repo's Actions secrets (`gh secret set`).
// Values go through stdin, never the command line. Running it again ROTATES SESSION_KEY and
// BACKUP_TOKEN: you'll need to log in again, and the backup job gets the new token at the same time.
//
//   npm run secrets:push -- --url https://versus.<your-subdomain>.workers.dev [--dry-run]

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const BACKUP_REPO = 'BrunoBensadon/versus-backup';
const FROM_ENV = ['APP_PASSPHRASE', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'STEAM_API_KEY', 'STEAM_ID64'] as const;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const url = args[args.indexOf('--url') + 1];
if (!args.includes('--url') || !url || !/^https:\/\/[^/]+$/.test(url)) {
  console.error('Usage: npm run secrets:push -- --url https://versus.<subdomain>.workers.dev [--dry-run]  (no trailing slash)');
  process.exit(1);
}

process.loadEnvFile('.env');
const missing = FROM_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const backupToken = randomBytes(32).toString('base64url');
const worker: [string, string][] = [
  ...FROM_ENV.map((k): [string, string] => [k, process.env[k]!]),
  ['SESSION_KEY', randomBytes(32).toString('base64url')],
  ['BACKUP_TOKEN', backupToken],
];
const github: [string, string][] = [
  ['BACKUP_TOKEN', backupToken],
  ['VERSUS_URL', url],
];

function run(command: string, value: string): void {
  if (dryRun) {
    console.log(`[dry run] ${command}`);
    return;
  }
  // shell: true so Windows finds npx.cmd / gh.exe; the command holds only names, never values.
  const result = spawnSync(command, { input: value, shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.status !== 0) {
    console.error(`Failed: ${command}`);
    process.exit(result.status ?? 1);
  }
}

for (const [name, value] of worker) run(`npx wrangler secret put ${name}`, value);
for (const [name, value] of github) run(`gh secret set ${name} --repo ${BACKUP_REPO}`, value);
console.log(dryRun ? 'Dry run: nothing was sent.' : `Pushed ${worker.length} Worker secrets and ${github.length} backup-repo secrets.`);
```

Add to the `scripts` block of `package.json`:

```json
    "deploy": "vite build && wrangler d1 migrations apply DB --remote && wrangler deploy",
    "secrets:push": "tsx scripts/push-secrets.ts"
```

`deploy` names the database by its **binding** (`DB`), so it keeps working after a restore into a database with another name (✅ `wrangler d1 migrations apply DB` resolves the binding, verified locally 2026-10-06).

Dry run (sends nothing; needs the real `.env`):

Run: `npm run secrets:push -- --url https://versus.example.workers.dev --dry-run`
Expected: nine `[dry run]` lines (7 × `npx wrangler secret put <NAME>`, 2 × `gh secret set <NAME> --repo BrunoBensadon/versus-backup`) and `Dry run: nothing was sent.`, with no values printed.

- [ ] **Step 8: The runbook**

`docs/runbook.md`:

```markdown
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
`grep '^APP_PASSPHRASE=' .env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put APP_PASSPHRASE`.

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
| | Steam import CPU: `wrangler tail` showed no `exceededCpu` | |
| | ≥ 20 ranked games: `npm run eval` run; `SCORER` set by the ship rule | |
```

- [ ] **Step 9: Full check and commit**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; core + web + scripts `Tests 148 passed`; Worker `Tests 55 passed`.

```bash
git add scripts ops tests/scripts vitest.config.ts tsconfig.json package.json docs/runbook.md
git commit -m "chore(ops): secrets script, backup split/restore round trip, runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin p6-ops
gh run watch --exit-status
```

Merge per `superpowers:finishing-a-development-branch` before Task 2, so the deploy runs from `main`.

---

### Task 2: First deploy (Bruno's Cloudflare account; ask before each command)

**Files:**
- Modify: `wrangler.jsonc` (`database_id`)

**Interfaces:**
- Consumes: Task 1 scripts; Plans 4–5.
- Produces: the live URL `https://versus.<subdomain>.workers.dev`, used by Tasks 3–4 and stored as `VERSUS_URL` in the backup repo.

- [ ] **Step 1: Check the login**

Run: `npx wrangler whoami`
Expected: Bruno's account email and account id (✅ spec §14: wrangler credentials are present on this machine).

- [ ] **Step 2: Create the production database**

Run: `npx wrangler d1 create versus`
Expected: a block containing `"database_id": "<uuid>"`. Replace the placeholder `00000000-0000-0000-0000-000000000000` in `wrangler.jsonc` with that uuid.

- [ ] **Step 3: Deploy**

```bash
git checkout -b p6-deploy
npm run deploy
```

Expected: the migration table shows `0001_init.sql ✅`, then `Deployed versus` with a URL like `https://versus.<subdomain>.workers.dev`. Note the URL.

- [ ] **Step 4: Push the secrets**

Run: `npm run secrets:push -- --url https://versus.<subdomain>.workers.dev`
Expected: seven `✨ Success! Uploaded secret ...` lines from wrangler, two `✓ Set Actions secret ...` lines from gh, then `Pushed 7 Worker secrets and 2 backup-repo secrets.`

- [ ] **Step 5: Smoke-test the live app and measure the import's CPU**

In one terminal: `npx wrangler tail versus --format pretty` (leave it running).
In desktop Chrome: open the URL → log in with the passphrase → Settings → **Import / refresh Steam library**.
Expected:
- the summary reads about `121 owned · 118 found on IGDB · ~110 new` (✅ spec §8 numbers; some appids collapse into one work);
- the tail shows `POST /api/import/steam` with outcome **ok**. If it shows `exceededCpu`, record it in `docs/runbook.md` (Acceptance log) and open a follow-up to split the import into two requests (owned+mapping, then tags+time-to-beat). Do not work around it in this task.
- `GET https://<url>/api/status` without a cookie → `{"error":"log in first"}`.

Stop the tail with Ctrl+C.

- [ ] **Step 6: Commit the database id**

```bash
git add wrangler.jsonc
git commit -m "chore(deploy): production D1 database id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin p6-deploy
```

Merge to `main`.

---

### Task 3: Nightly backup and a restore drill (private repo; ask before each command)

**Files:**
- Create in `BrunoBensadon/versus-backup` (a separate clone **outside** this repo): `.github/workflows/backup.yml`, `split-export.mjs`
- Modify in this repo: `docs/runbook.md` (Acceptance log row)

**Interfaces:**
- Consumes: `ops/versus-backup/*` (Task 1), the live URL and secrets (Task 2), `npm run restore` (Task 1).
- Produces: nightly commits in the backup repo; `kv.last_backup_at` on the server (Settings shows the age).

- [ ] **Step 1: Install the workflow in the backup repo**

```bash
git clone https://github.com/BrunoBensadon/versus-backup ../versus-backup
mkdir -p ../versus-backup/.github/workflows
cp ops/versus-backup/backup.yml ../versus-backup/.github/workflows/backup.yml
cp ops/versus-backup/split-export.mjs ../versus-backup/split-export.mjs
git -C ../versus-backup add .github/workflows/backup.yml split-export.mjs
git -C ../versus-backup commit -m "Nightly versus backup workflow"
git -C ../versus-backup push
```

(✅ spec §14: the private repo exists and is empty.)

- [ ] **Step 2: Run it once by hand**

```bash
gh workflow run backup.yml --repo BrunoBensadon/versus-backup
gh run watch --repo BrunoBensadon/versus-backup --exit-status
git -C ../versus-backup pull
ls ../versus-backup
```

Expected: the run succeeds; the clone now has `meta.json`, `events.jsonl`, `library.json`, `sublists.json`, `games.json`, `external_ids.json` and a commit `backup YYYY-MM-DD`. In the app, Settings → Export shows "Last nightly backup: 0 days ago" in normal (not red) text.

- [ ] **Step 3: Restore drill into a scratch database**

```bash
npm run restore -- ../versus-backup drill.restore.sql
npx wrangler d1 create versus-drill
npx wrangler d1 migrations apply versus-drill --remote
npx wrangler d1 execute versus-drill --remote --file drill.restore.sql
npx wrangler d1 execute versus-drill --remote --command "SELECT count(*) AS events FROM events"
wc -l ../versus-backup/events.jsonl
rm drill.restore.sql
npx wrangler d1 delete versus-drill
```

`d1 migrations apply versus-drill` works without a `wrangler.jsonc` entry because migrations are read from `migrations/`. ⚠️ If wrangler insists on a configured binding, add a temporary second `d1_databases` entry for `versus-drill`, run the commands, and remove it again without committing.

Expected: the `events` count equals the line count of `events.jsonl`. Record the date and result in the Acceptance log of `docs/runbook.md`.

- [ ] **Step 4: Commit the log entry**

```bash
git checkout -b p6-acceptance
git add docs/runbook.md
git commit -m "docs(runbook): first backup and restore drill recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Phone acceptance (NF-1) and the model ship rule

**Files:**
- Modify: `docs/runbook.md` (Acceptance log), possibly `src/core/recommender/config.ts`

**Interfaces:**
- Consumes: the live app; `npm run eval` (Plan 2).
- Produces: v1 accepted, or a recorded list of what failed.

- [ ] **Step 1: Install on the phone**

On the Galaxy S26, open the live URL in Chrome → menu → **Add to home screen / Install app**. Launch it from the home screen.
Expected: it opens full-screen (no browser bar) with the versus icon; the login works.

- [ ] **Step 2: NF-1, rank a just-finished game in under a minute**

Start a timer, then: Search → type the game → open it → **Already played → rank now** → bucket → answer → **✓ Looks right**.
Expected: under 60 s, and the game page shows its rank and score. Note the time and any slow step (spec §12: typeahead is the main risk). If the right game wasn't first in search, capture that query as a new fixture (`scripts/capture-fixtures.ts` + a `search.test.ts` case) and re-tune `POPULARITY_WEIGHT`.

- [ ] **Step 3: After triage and ~20 ranked games, apply the ship rule (spec §7.4)**

Settings → Export → Everything (JSON) → save as `exports/<date>.export.json` (git-ignored), then:

Run: `npm run eval -- exports/<date>.export.json`
Expected: the report table, and its last line names the ship-rule outcome. If it says ridge does **not** beat kNN-5, set `export const SCORER: Scorer = 'knn';` in `src/core/recommender/config.ts`, run `npm test`, commit, and `npm run deploy`. Compare `ridge` against `mean_only` too: that's the real floor (roadmap deviation 6).

- [ ] **Step 4: Record and finish**

Fill in the remaining Acceptance log rows in `docs/runbook.md` (date, NF-1 time, CPU outcome from Task 2, eval numbers), then:

```bash
git add docs/runbook.md src/core/recommender/config.ts
git commit -m "docs(runbook): v1 acceptance on the phone; ship-rule outcome

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin p6-acceptance
```

Merge to `main`. v1 is done; v1.1 (discovery feed, candidate pool, scheduled refresh) starts from a new spec section.
