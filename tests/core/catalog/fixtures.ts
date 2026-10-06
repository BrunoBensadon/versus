// Loads the captured real IGDB/Steam responses (scripts/capture-fixtures.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '../../fixtures');

export function fixture(path: string): unknown {
  return JSON.parse(readFileSync(resolve(DIR, path), 'utf8'));
}

/** Raw IGDB game records by id. */
export function igdbGames(): Map<number, unknown> {
  const list = fixture('igdb/games.json') as { id: number }[];
  return new Map(list.map((g) => [g.id, g]));
}
