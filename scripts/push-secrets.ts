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
