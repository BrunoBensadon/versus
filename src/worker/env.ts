// What the Worker receives from Cloudflare: the D1 binding and the secrets (spec §10).
// Secrets are set with `wrangler secret put NAME` in production and come from .dev.vars locally.

export interface Env {
  DB: D1Database;
  APP_PASSPHRASE: string;
  SESSION_KEY: string; // HMAC key for the session cookie
  BACKUP_TOKEN: string; // bearer token the nightly backup job uses for GET /api/export
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  STEAM_API_KEY: string;
  STEAM_ID64: string;
  // Optional overrides so end-to-end tests can point the Worker at fake upstreams.
  IGDB_BASE_URL?: string; // default https://api.igdb.com/v4
  TWITCH_TOKEN_URL?: string; // default https://id.twitch.tv/oauth2/token
  STEAM_BASE_URL?: string; // default https://api.steampowered.com
}

/** Things the Worker gets from the outside world, injectable so tests can fake them. */
export interface Deps {
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export const realDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Everything a route handler needs. */
export interface Ctx {
  env: Env;
  deps: Deps;
}
