// Typeahead rerank (spec §8). IGDB's own relevance order is good at matching text but puts obscure
// namesakes first ("hades" → an unrated namesake before Supergiant's Hades). Blend the IGDB position with
// popularity (rating count, log scale).

import type { GameMeta } from '../types';

/**
 * Weight of popularity against IGDB position: one place in IGDB's list is worth a 10^(1/1.5) ≈ 4.6×
 * difference in rating count. Tuned on tests/fixtures/igdb/search-*.json (only 2 queries so far:
 * add a fixture whenever real use finds a bad result, then re-tune).
 */
export const POPULARITY_WEIGHT = 1.5;

export function rerankSearch(hits: GameMeta[], _query: string): GameMeta[] {
  return hits
    .map((g, index) => ({ g, index, score: -index + POPULARITY_WEIGHT * Math.log10(1 + g.ratingCount) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.g);
}
