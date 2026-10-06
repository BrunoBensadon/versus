// Duplicate hints (spec §8, D16): library games that look like the same work but that IGDB doesn't
// link, e.g. Steam's "GTA V Enhanced" maps to an IGDB Bundle with no parent. The UI shows a banner
// with a Merge button; nothing is merged automatically.

import type { GameId, GameMeta } from '../types';

const EDITION_WORDS: ReadonlySet<string> = new Set([
  'legacy', 'enhanced', 'remastered', 'definitive', 'special', 'complete', 'goty', 'edition',
]);

/** "The Elder Scrolls V: Skyrim - Special Edition" → "the elder scrolls v skyrim". */
export function normalizeName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);
  while (words.length > 1 && EDITION_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/**
 * Pairs [smaller id, larger id] that share an IGDB collection or franchise AND whose names match
 * after normalization. (The spec says "collection"; franchise is added because GTA V Enhanced has no
 * collection in IGDB, only the franchise. See the roadmap, deviation 1.)
 */
export function duplicateHints(library: GameMeta[]): [GameId, GameId][] {
  // 1 + 2. Normalize each name and build each group set ONCE, and put the games into buckets by
  // normalized name: two games can only be duplicates if they land in the same bucket.
  // A game whose name normalizes to '' never matches anything, so it is left out.
  const byName = new Map<string, { id: GameId; groups: Set<string> }[]>();
  for (const g of library) {
    const name = normalizeName(g.name);
    if (name === '') continue;
    const groups = new Set([...g.collections, ...g.franchises].map((x) => x.toLowerCase()));
    const bucket = byName.get(name);
    if (bucket) bucket.push({ id: g.id, groups });
    else byName.set(name, [{ id: g.id, groups }]);
  }

  // 3. Compare pairs only inside a bucket. Most buckets hold a single game, so this is close to one
  // pass over the library instead of every pair of games.
  const out: [GameId, GameId][] = [];
  for (const bucket of byName.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        if (a.id === b.id) continue; // the same game listed twice is not its own duplicate
        const shared = [...a.groups].some((x) => b.groups.has(x));
        if (shared) out.push(a.id < b.id ? [a.id, b.id] : [b.id, a.id]);
      }
    }
  }

  // 4. Same order as always: by smaller id, then by larger id.
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
