// Synthetic library for testing the recommender and the evaluation harness (spec §11).
// Games get random genres/themes/keywords/Steam tags; a hidden linear "taste" plus noise decides
// the true order; a perfect-oracle ranking session turns that order into a real event log.
// No personal data: everything here is generated.

import { seededRandom, shuffled } from '../../src/core/random';
import type { Bucket, GameMeta, RankEvent } from '../../src/core/types';
import { Log, rankWithOracle } from '../core/helpers/log';

export interface SyntheticOptions {
  games: number;
  seed: number;
  noise: number; // standard deviation of the part of taste that features can't explain
  steamShare?: number; // share of games with Steam tags (default 0.8)
}

function pick<T>(pool: readonly T[], count: number, rand: () => number): T[] {
  return shuffled(pool, rand).slice(0, count);
}

function normal(rand: () => number): number {
  // Box-Muller transform
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const GENRES = ['Adventure', 'Indie', 'Platform', 'Puzzle', 'RPG', 'Shooter', 'Strategy', 'Simulator'];
const THEMES = ['Action', 'Fantasy', 'Science fiction', 'Horror', 'Comedy', 'Drama', 'Survival', 'Open world'];
const MODES = ['Single player', 'Multiplayer', 'Co-operative'];
const PERSPECTIVES = ['First person', 'Third person', 'Side view', 'Bird view / Isometric'];
const KEYWORDS = Array.from({ length: 40 }, (_, i) => `keyword ${i + 1}`);
const TAGS = Array.from({ length: 30 }, (_, i) => ({ tagId: 1000 + i, name: `Tag ${i + 1}` }));
const DEVELOPERS = Array.from({ length: 15 }, (_, i) => `Studio ${i + 1}`);
const COLLECTIONS = Array.from({ length: 10 }, (_, i) => `Series ${i + 1}`);

export function syntheticGames(opts: SyntheticOptions): GameMeta[] {
  const rand = seededRandom(opts.seed);
  const steamShare = opts.steamShare ?? 0.8;
  return Array.from({ length: opts.games }, (_, i) => {
    const hasSteam = rand() < steamShare;
    return {
      id: i + 1,
      name: `Game ${i + 1}`,
      year: 2000 + Math.floor(rand() * 25),
      gameType: 0,
      coverImageId: null,
      genres: pick(GENRES, 1 + Math.floor(rand() * 3), rand),
      themes: pick(THEMES, 1 + Math.floor(rand() * 3), rand),
      keywords: pick(KEYWORDS, 3 + Math.floor(rand() * 8), rand),
      modes: pick(MODES, 1, rand),
      perspectives: pick(PERSPECTIVES, 1, rand),
      collections: rand() < 0.3 ? pick(COLLECTIONS, 1, rand) : [],
      franchises: [],
      developers: pick(DEVELOPERS, 1, rand),
      platforms: ['PC'],
      totalRating: 50 + rand() * 45,
      ratingCount: Math.floor(rand() * 1000),
      steamTags: hasSteam
        ? pick(TAGS, 8 + Math.floor(rand() * 8), rand).map((t) => ({ ...t, weight: 100 + Math.floor(rand() * 900) }))
        : null,
      ttb: null,
      versionParent: null,
      parentGame: null,
    };
  });
}

/** Hidden taste: each genre/theme/keyword/tag has a random weight; utility = mean weight per block + noise. */
export function syntheticUtility(games: GameMeta[], opts: SyntheticOptions): Map<number, number> {
  const rand = seededRandom(opts.seed + 1);
  const weight = new Map<string, number>();
  const w = (key: string) => {
    if (!weight.has(key)) weight.set(key, normal(rand));
    return weight.get(key)!;
  };
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length);
  const utility = new Map<number, number>();
  for (const g of games) {
    const u =
      mean(g.genres.map((x) => w(`g:${x}`))) +
      mean(g.themes.map((x) => w(`t:${x}`))) +
      mean(g.keywords.map((x) => w(`k:${x}`))) +
      mean((g.steamTags ?? []).map((t) => w(`s:${t.tagId}`))) +
      opts.noise * normal(rand);
    utility.set(g.id, u);
  }
  return utility;
}

/** Rank every game with a perfect oracle; buckets: top 30% loved, bottom 25% disliked. */
export function syntheticEvents(utility: Map<number, number>, seed: number): RankEvent[] {
  const byUtility = [...utility.keys()].sort((a, b) => utility.get(b)! - utility.get(a)!);
  const bucketOf = new Map<number, Bucket>();
  byUtility.forEach((id, i) => {
    const share = i / byUtility.length;
    bucketOf.set(id, share < 0.3 ? 'loved' : share >= 0.75 ? 'disliked' : 'liked');
  });

  // The session loop is the same one the ranking tests use (tests/core/helpers/log.ts), so the
  // synthetic log is built exactly the way a real ranking session builds it.
  const log = new Log();
  for (const game of shuffled([...utility.keys()], seededRandom(seed + 2))) {
    rankWithOracle(log, game, bucketOf.get(game)!, (a, b) => utility.get(a)! > utility.get(b)!, `s${game}`);
  }
  return log.events;
}

export function syntheticDataset(opts: SyntheticOptions): { events: RankEvent[]; games: GameMeta[] } {
  const games = syntheticGames(opts);
  const utility = syntheticUtility(games, opts);
  return { events: syntheticEvents(utility, opts.seed), games };
}
