// Never let a secret leave the Worker in an error message or a log line (spec §10, NF-3).

import type { Env } from './env';

const SECRET_KEYS = [
  'APP_PASSPHRASE', 'SESSION_KEY', 'BACKUP_TOKEN', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'STEAM_API_KEY', 'STEAM_ID64',
] as const;

export function redact(text: string, env: Env): string {
  let out = text;
  for (const key of SECRET_KEYS) {
    const value = env[key];
    if (value && value.length >= 4) out = out.split(value).join('***');
  }
  return out;
}
