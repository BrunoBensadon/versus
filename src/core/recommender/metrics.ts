// Evaluation metrics (spec §7.4).

/**
 * Held-out pairwise accuracy. For every pair (held-out game h, training game t): does "pred(h) is
 * above score(t)" agree with "h is truly above t"? Pairs where the prediction equals the training
 * score, or where the true ranks are equal, are skipped.
 * trueRank: 0 = best.
 */
export function heldOutPairwise(
  held: { pred: number; trueRank: number }[],
  train: { score: number; trueRank: number }[],
): { agree: number; total: number } {
  let agree = 0;
  let total = 0;
  for (const h of held) {
    for (const t of train) {
      if (h.pred === t.score || h.trueRank === t.trueRank) continue;
      total += 1;
      if (h.pred > t.score === h.trueRank < t.trueRank) agree += 1;
    }
  }
  return { agree, total };
}

/** Kendall τ-a between two equal-length lists. Tied pairs count as neither. NaN below 2 items. */
export function kendallTau(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  let score = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      score += Math.sign(a[i] - a[j]) * Math.sign(b[i] - b[j]);
    }
  }
  return score / ((n * (n - 1)) / 2);
}

export interface Interval {
  mean: number;
  lo: number; // 2.5th percentile of the bootstrap means
  hi: number; // 97.5th percentile
}

/** Mean and 95% bootstrap interval. NaN values are dropped first. */
export function bootstrapMean(values: number[], rand: () => number, resamples = 1000): Interval {
  const v = values.filter((x) => !Number.isNaN(x));
  if (v.length === 0) return { mean: NaN, lo: NaN, hi: NaN };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[Math.floor(rand() * v.length)];
    means.push(s / v.length);
  }
  means.sort((x, y) => x - y);
  return { mean, lo: means[Math.floor(0.025 * resamples)], hi: means[Math.floor(0.975 * resamples) - 1] };
}
