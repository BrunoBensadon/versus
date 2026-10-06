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
  const groupsOf = (g: GameMeta) => new Set([...g.collections, ...g.franchises].map((x) => x.toLowerCase()));
  const out: [GameId, GameId][] = [];
  for (let i = 0; i < library.length; i++) {
    for (let j = i + 1; j < library.length; j++) {
      const a = library[i];
      const b = library[j];
      if (a.id === b.id) continue;
      const shared = [...groupsOf(a)].some((x) => groupsOf(b).has(x));
      const nameA = normalizeName(a.name);
      if (shared && nameA !== '' && nameA === normalizeName(b.name)) {
        out.push(a.id < b.id ? [a.id, b.id] : [b.id, a.id]);
      }
    }
  }
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
