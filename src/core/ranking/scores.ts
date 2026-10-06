// Position → 0-10 score (spec §6.3). Each bucket owns a fixed band; positions spread linearly.

import { BUCKETS, type Bucket, type GameId } from '../types';
import type { RankState } from './replay';

export interface Band {
  lo: number;
  hi: number;
}
export type Bands = Record<Bucket, Band>;

/** Spec D9: "8 means loved" stays true however many games each bucket holds. */
export const DEFAULT_BANDS: Bands = {
  loved: { lo: 6.7, hi: 10.0 },
  liked: { lo: 3.4, hi: 6.6 },
  disliked: { lo: 0.0, hi: 3.3 },
};

/** Score of position `index` (0 = best) in a bucket of `count` ranked games. */
export function bucketScore(index: number, count: number, band: Band): number {
  if (count === 1) return band.hi;
  return band.hi - ((band.hi - band.lo) * index) / (count - 1);
}

/** Scores of every ranked game. Unranked games have no entry. */
export function scores(state: Pick<RankState, 'lists'>, bands: Bands = DEFAULT_BANDS): Map<GameId, number> {
  const out = new Map<GameId, number>();
  for (const bucket of BUCKETS) {
    const list = state.lists[bucket];
    list.forEach((id, index) => out.set(id, bucketScore(index, list.length, bands[bucket])));
  }
  return out;
}

/**
 * The bucket whose band contains a (predicted) score, judged on the score as shown (one decimal),
 * so the number on screen and its bucket always agree. Scores in the gaps go to the lower bucket.
 */
export function bandOf(score: number, bands: Bands = DEFAULT_BANDS): Bucket {
  const shown = Math.round(score * 10) / 10; // same rounding as formatScore
  if (shown >= bands.loved.lo) return 'loved';
  if (shown >= bands.liked.lo) return 'liked';
  return 'disliked';
}

/** Scores are shown with one decimal (spec §6.3). */
export function formatScore(score: number): string {
  return score.toFixed(1);
}
