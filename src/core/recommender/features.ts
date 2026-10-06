// Feature space (spec §7.1). Turns GameMeta into a numeric vector the model can read.
// Each sparse block (genres, keywords, Steam tags, ...) is scaled to unit length per game, so a game
// with 84 keywords doesn't outweigh one with 4. The vocabulary is built from the RANKED games only.

import type { GameMeta } from '../types';

export type BlockName = 'genre' | 'theme' | 'mode' | 'perspective' | 'keyword' | 'steam_tag' | 'collection' | 'developer';
export const BLOCKS: readonly BlockName[] = ['genre', 'theme', 'mode', 'perspective', 'keyword', 'steam_tag', 'collection', 'developer'];

/** Keywords that describe distribution or platform, not the game (spec §7.1, D13). Compared lower-case. */
export const STOP_KEYWORDS: ReadonlySet<string> = new Set([
  'steam', 'digital distribution', 'steam achievements', 'achievements', 'steam cloud',
  'steam trading cards', 'steam workshop', 'overlay', 'pc', 'windows', 'dlc',
  'downloadable content', 'xbox one x enhanced', 'playstation trophies', 'online',
]);

export interface FeatureConfig {
  /** A feature becomes a column only if at least this many ranked games have it. */
  minDf: Record<BlockName, number>;
}

export const DEFAULT_FEATURE_CONFIG: FeatureConfig = {
  minDf: { genre: 1, theme: 1, mode: 1, perspective: 1, keyword: 3, steam_tag: 3, collection: 2, developer: 2 },
};

export interface Column {
  block: BlockName | 'consensus' | 'has_steam_tags';
  key: string; // stable id inside the block: lower-case name, or the Steam tag id
  label: string; // readable name for explanations
}

export interface FeatureSpace {
  columns: Column[];
  index: Map<string, number>; // `${block}:${key}` → column number
  ratingMean: number; // for standardizing IGDB total_rating
  ratingSd: number;
}

const BLOCK_LABELS: Record<Column['block'], string> = {
  genre: 'Genre',
  theme: 'Theme',
  mode: 'Mode',
  perspective: 'Perspective',
  keyword: 'Keyword',
  steam_tag: 'Steam tag',
  collection: 'Series',
  developer: 'Developer',
  consensus: 'Critic & player rating',
  has_steam_tags: 'Has Steam tags',
};

/** "Steam tag: Roguelite". Used by the explanation UI. */
export function columnLabel(column: Column): string {
  if (column.block === 'consensus' || column.block === 'has_steam_tags') return BLOCK_LABELS[column.block];
  return `${BLOCK_LABELS[column.block]}: ${column.label}`;
}

interface RawEntry {
  value: number;
  label: string;
}

function binary(names: string[]): Map<string, RawEntry> {
  const out = new Map<string, RawEntry>();
  for (const name of names) out.set(name.toLowerCase(), { value: 1, label: name });
  return out;
}

/** A game's features before vocabulary filtering, block by block. */
export function rawFeatures(g: GameMeta, opts: { maskSteam?: boolean } = {}): Map<BlockName, Map<string, RawEntry>> {
  const steam = new Map<string, RawEntry>();
  if (!opts.maskSteam && g.steamTags && g.steamTags.length > 0) {
    const top = Math.max(...g.steamTags.map((t) => t.weight)) || 1;
    for (const t of g.steamTags) steam.set(String(t.tagId), { value: t.weight / top, label: t.name });
  }
  return new Map<BlockName, Map<string, RawEntry>>([
    ['genre', binary(g.genres)],
    ['theme', binary(g.themes)],
    ['mode', binary(g.modes)],
    ['perspective', binary(g.perspectives)],
    ['keyword', binary(g.keywords.filter((k) => !STOP_KEYWORDS.has(k.toLowerCase())))],
    ['steam_tag', steam],
    ['collection', binary(g.collections)],
    ['developer', binary(g.developers)],
  ]);
}

export function buildFeatures(train: GameMeta[], cfg: FeatureConfig = DEFAULT_FEATURE_CONFIG): FeatureSpace {
  // Document frequency: how many training games have each feature.
  const df = new Map<string, { block: BlockName; key: string; label: string; count: number }>();
  for (const g of train) {
    for (const [block, entries] of rawFeatures(g)) {
      for (const [key, entry] of entries) {
        const id = `${block}:${key}`;
        const seen = df.get(id);
        if (seen) seen.count += 1;
        else df.set(id, { block, key, label: entry.label, count: 1 });
      }
    }
  }
  const sparse = [...df.values()]
    .filter((f) => f.count >= cfg.minDf[f.block])
    .sort((a, b) => BLOCKS.indexOf(a.block) - BLOCKS.indexOf(b.block) || a.key.localeCompare(b.key));

  const columns: Column[] = sparse.map((f) => ({ block: f.block, key: f.key, label: f.label }));
  columns.push({ block: 'consensus', key: 'total_rating', label: 'IGDB total rating' });
  columns.push({ block: 'has_steam_tags', key: 'has_steam_tags', label: 'Has Steam tags' });

  const index = new Map<string, number>();
  columns.forEach((c, i) => index.set(`${c.block}:${c.key}`, i));

  const ratings = train.map((g) => g.totalRating).filter((r): r is number => r !== null);
  const ratingMean = ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0;
  const variance = ratings.length > 1 ? ratings.reduce((s, r) => s + (r - ratingMean) ** 2, 0) / (ratings.length - 1) : 0;
  const ratingSd = Math.sqrt(variance) || 1;

  return { columns, index, ratingMean, ratingSd };
}

export function vectorize(space: FeatureSpace, g: GameMeta, opts: { maskSteam?: boolean } = {}): Float64Array {
  const x = new Float64Array(space.columns.length);
  for (const [block, entries] of rawFeatures(g, opts)) {
    const cols: [number, number][] = [];
    for (const [key, entry] of entries) {
      const col = space.index.get(`${block}:${key}`);
      if (col !== undefined) cols.push([col, entry.value]);
    }
    const norm = Math.sqrt(cols.reduce((s, [, v]) => s + v * v, 0));
    if (norm > 0) for (const [col, v] of cols) x[col] = v / norm;
  }
  const consensus = space.index.get('consensus:total_rating')!;
  x[consensus] = g.totalRating === null ? 0 : (g.totalRating - space.ratingMean) / space.ratingSd;
  const hasTags = space.index.get('has_steam_tags:has_steam_tags')!;
  x[hasTags] = !opts.maskSteam && g.steamTags !== null && g.steamTags.length > 0 ? 1 : 0;
  return x;
}

/** Share of a game's raw features that the vocabulary knows (0 when the game has none). */
export function vocabCoverage(space: FeatureSpace, g: GameMeta): number {
  let total = 0;
  let known = 0;
  for (const [block, entries] of rawFeatures(g)) {
    for (const key of entries.keys()) {
      total += 1;
      if (space.index.has(`${block}:${key}`)) known += 1;
    }
  }
  return total === 0 ? 0 : known / total;
}
