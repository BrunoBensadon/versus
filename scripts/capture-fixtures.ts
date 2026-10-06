// Re-capture the real IGDB/Steam responses used by the catalog tests (spec §11: "real fixtures").
//   npm run capture-fixtures            (reads credentials from ./.env)
// Writes tests/fixtures/igdb/*.json and tests/fixtures/steam/*.json. These hold PUBLIC game data
// only: no API keys, no Steam id, no playtimes. Never add GetOwnedGames output here (the repo is public).

import { mkdirSync, writeFileSync } from 'node:fs';
import { gamesByIdQuery, searchQuery, steamExternalQuery, steamItemsInput, timeToBeatQuery } from '../src/core/catalog/igdb-query';

const envFile = process.argv[2] ?? '.env';
process.loadEnvFile(envFile);
const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing from ${envFile}`);
  return v;
};

/** Hide every secret value in a message before printing it. */
function redact(text: string): string {
  let out = text;
  for (const k of ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'STEAM_API_KEY', 'STEAM_ID64']) {
    const v = process.env[k];
    if (v) out = out.split(v).join('***');
  }
  return out;
}

async function igdbToken(): Promise<string> {
  const q = new URLSearchParams({ client_id: env('TWITCH_CLIENT_ID'), client_secret: env('TWITCH_CLIENT_SECRET'), grant_type: 'client_credentials' });
  const r = await fetch(`https://id.twitch.tv/oauth2/token?${q}`, { method: 'POST' });
  if (!r.ok) throw new Error(`token: HTTP ${r.status}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

async function igdb(token: string, endpoint: string, body: string): Promise<unknown[]> {
  await new Promise((res) => setTimeout(res, 300)); // stay under 4 requests/second
  const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: { 'Client-ID': env('TWITCH_CLIENT_ID'), Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body,
  });
  if (!r.ok) throw new Error(redact(`IGDB ${endpoint}: HTTP ${r.status} ${await r.text()}`));
  return (await r.json()) as unknown[];
}

async function steam(path: string, params: Record<string, string>): Promise<unknown> {
  const q = new URLSearchParams({ ...params, key: env('STEAM_API_KEY') });
  const r = await fetch(`https://api.steampowered.com/${path}?${q}`);
  if (!r.ok) throw new Error(`Steam ${path}: HTTP ${r.status}`); // never print the URL: it has the key
  return r.json();
}

function save(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

// Games the catalog tests need (spec §11), by IGDB id:
//   20 BioShock · 34293 BioShock Remastered · 472 Skyrim · 19457 Skyrim Special Edition
//   241 Counter-Strike · 307 Counter-Strike: Source · 1020 GTA V · 334647 GTA V Enhanced (Bundle)
//   11737 Outer Wilds · 113112 Hades · 165192 Skyrim Anniversary Edition (Expanded Game → Special Edition)
const GAME_IDS = [20, 34293, 472, 19457, 165192, 241, 307, 1020, 334647, 11737, 113112];
const STEAM_APPIDS = [753640, 1145360, 7670, 409710, 489830, 271590, 3240220]; // Outer Wilds, Hades, BioShock, BioShock Remastered, Skyrim SE, GTA V Legacy, GTA V Enhanced

async function main(): Promise<void> {
  mkdirSync('tests/fixtures/igdb', { recursive: true });
  mkdirSync('tests/fixtures/steam', { recursive: true });
  const token = await igdbToken();

  save('tests/fixtures/igdb/games.json', await igdb(token, 'games', gamesByIdQuery(GAME_IDS)));
  save('tests/fixtures/igdb/search-hades.json', await igdb(token, 'games', searchQuery('hades')));
  save('tests/fixtures/igdb/search-outer-wild.json', await igdb(token, 'games', searchQuery('outer wild')));
  save('tests/fixtures/igdb/time-to-beat.json', await igdb(token, 'game_time_to_beats', timeToBeatQuery([11737, 113112])));
  save('tests/fixtures/igdb/external-steam.json', await igdb(token, 'external_games', steamExternalQuery(STEAM_APPIDS)));

  const items = await steam('IStoreBrowseService/GetItems/v1/', {
    input_json: steamItemsInput(STEAM_APPIDS),
  });
  save('tests/fixtures/steam/get-items.json', items);
  save('tests/fixtures/steam/tag-list.json', await steam('IStoreService/GetTagList/v1/', { language: 'english' }));
}

main().catch((e: unknown) => {
  console.error(redact(String(e)));
  process.exit(1);
});
