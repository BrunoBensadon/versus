// Create .dev.vars (the local Worker secrets file) from .env, spec §10: "Local dev: .env → .dev.vars".
//   npm run dev-vars
// SESSION_KEY and BACKUP_TOKEN are generated if .env doesn't have them. Both files are git-ignored.
// Prints only the NAMES of the variables, never their values.

import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const NEEDED = ['APP_PASSPHRASE', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'STEAM_API_KEY', 'STEAM_ID64'] as const;
const GENERATED = ['SESSION_KEY', 'BACKUP_TOKEN'] as const;

const envFile = process.argv[2] ?? '.env';
const outFile = process.argv[3] ?? '.dev.vars';
if (existsSync(outFile)) {
  console.error(`${outFile} already exists; delete it first if you want to regenerate it.`);
  process.exit(1);
}
process.loadEnvFile(envFile);

const missing = NEEDED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing in ${envFile}: ${missing.join(', ')}`);
  process.exit(1);
}
const lines = NEEDED.map((k) => `${k}=${process.env[k]}`);
for (const k of GENERATED) lines.push(`${k}=${process.env[k] ?? randomBytes(32).toString('base64url')}`);
writeFileSync(outFile, `${lines.join('\n')}\n`);
console.log(`Wrote ${outFile} with: ${[...NEEDED, ...GENERATED].join(', ')}`);
