// Ridge regression on the score (spec §7.2), solved in its dual form because there are far more
// features (hundreds) than ranked games (tens): α = (Xc·Xcᵀ + λI)⁻¹ (y − ȳ), w = Xcᵀ·α.

import { seededRandom, shuffled } from '../random';
import { choleskySolve, dot } from './linalg';
import { heldOutPairwise } from './metrics';

export interface RidgeModel {
  w: Float64Array; // one weight per feature column, in score points per unit of feature
  intercept: number;
  xMean: Float64Array; // training mean of each feature (contributions are measured from here)
  yMean: number; // training mean score: the "baseline" of every explanation
  lambda: number;
}

export function fitRidge(X: Float64Array[], y: number[], lambda: number): RidgeModel {
  const n = X.length;
  const d = n > 0 ? X[0].length : 0;
  const xMean = new Float64Array(d);
  for (const row of X) for (let j = 0; j < d; j++) xMean[j] += row[j] / n;
  const yMean = y.reduce((s, v) => s + v, 0) / n;

  const Xc = X.map((row) => row.map((v, j) => v - xMean[j]));
  const K = Xc.map((a, i) => {
    const r = new Float64Array(n);
    for (let k = 0; k < n; k++) r[k] = dot(a, Xc[k]) + (i === k ? lambda : 0);
    return r;
  });
  const alpha = choleskySolve(K, y.map((v) => v - yMean));

  const w = new Float64Array(d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) w[j] += Xc[i][j] * alpha[i];
  const intercept = yMean - dot(xMean, w);
  return { w, intercept, xMean, yMean, lambda };
}

/** Unclamped prediction: intercept + w·x. */
export function rawPredict(m: RidgeModel, x: Float64Array): number {
  return m.intercept + dot(m.w, x);
}

export const LAMBDA_GRID: readonly number[] = [0.1, 0.3, 1, 3, 10];

/**
 * Pick λ by k-fold cross-validation on held-out pairwise accuracy (spec §7.2).
 * Below 10 games CV is meaningless, so it returns 1. Ties go to the larger λ (simpler model).
 */
export function chooseLambda(
  X: Float64Array[],
  y: number[],
  grid: readonly number[] = LAMBDA_GRID,
  folds = 5,
  seed = 1,
): number {
  const n = X.length;
  if (n < 10) return 1;
  const order = shuffled(Array.from({ length: n }, (_, i) => i), seededRandom(seed));
  const foldOf = new Array<number>(n);
  order.forEach((row, position) => (foldOf[row] = position % folds));

  let best = grid[0];
  let bestAcc = -1;
  for (const lambda of grid) {
    let agree = 0;
    let total = 0;
    for (let f = 0; f < folds; f++) {
      const trainRows = [...Array(n).keys()].filter((i) => foldOf[i] !== f);
      const testRows = [...Array(n).keys()].filter((i) => foldOf[i] === f);
      const m = fitRidge(trainRows.map((i) => X[i]), trainRows.map((i) => y[i]), lambda);
      const r = heldOutPairwise(
        testRows.map((i) => ({ pred: rawPredict(m, X[i]), trueRank: -y[i] })),
        trainRows.map((i) => ({ score: y[i], trueRank: -y[i] })),
      );
      agree += r.agree;
      total += r.total;
    }
    const acc = total === 0 ? 0 : agree / total;
    if (acc >= bestAcc) {
      best = lambda;
      bestAcc = acc;
    }
  }
  return best;
}
