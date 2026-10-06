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
 *
 * Speed: fitting ridge for every (λ, fold) pair would rebuild the same fold's kernel matrix once per
 * λ. Only the "+ λ on the diagonal" step depends on λ, so each fold builds its kernels once and then
 * tries every λ on them. The result is the same as calling fitRidge + rawPredict for each pair.
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
  const d = X[0].length;
  const order = shuffled(Array.from({ length: n }, (_, i) => i), seededRandom(seed));
  const foldOf = new Array<number>(n);
  order.forEach((row, position) => (foldOf[row] = position % folds));

  // Pair counts for each λ of the grid (same position), added up over all folds.
  const agree = new Array<number>(grid.length).fill(0);
  const total = new Array<number>(grid.length).fill(0);

  for (let f = 0; f < folds; f++) {
    const trainRows = [...Array(n).keys()].filter((i) => foldOf[i] !== f);
    const testRows = [...Array(n).keys()].filter((i) => foldOf[i] === f);
    const nTrain = trainRows.length;

    // 1. Centre on the TRAINING rows' means (the held-out rows must not leak into them).
    const xMean = new Float64Array(d);
    for (const i of trainRows) for (let j = 0; j < d; j++) xMean[j] += X[i][j] / nTrain;
    const yMean = trainRows.reduce((s, i) => s + y[i], 0) / nTrain;
    const trainC = trainRows.map((i) => X[i].map((v, j) => v - xMean[j]));
    const testC = testRows.map((i) => X[i].map((v, j) => v - xMean[j]));

    // 2. Training kernel: K[i][k] = (x_i − x̄)·(x_k − x̄), how alike two training games are.
    const K = trainC.map(() => new Float64Array(nTrain));
    // K is symmetric: compute each pair once and mirror it
    for (let i = 0; i < nTrain; i++) {
      for (let k = 0; k <= i; k++) {
        K[i][k] = K[k][i] = dot(trainC[i], trainC[k]);
      }
    }
    // 3. Cross kernel: C[t][i] = (x_t − x̄)·(x_i − x̄), each held-out game against each training game.
    const C = testC.map((a) => {
      const row = new Float64Array(nTrain);
      for (let i = 0; i < nTrain; i++) row[i] = dot(a, trainC[i]);
      return row;
    });
    const yCentred = trainRows.map((i) => y[i] - yMean);
    const trainPairs = trainRows.map((i) => ({ score: y[i], trueRank: -y[i] }));

    // 4. For each λ: solve (K + λI)·α = y − ȳ, then predict a held-out game as ȳ + Σ_i C[t][i]·α_i.
    //    That is exactly rawPredict(fitRidge(...), x_t): w = Σ_i α_i·(x_i − x̄) and
    //    intercept + w·x_t = ȳ + w·(x_t − x̄), so the d-length w never has to be built.
    grid.forEach((lambda, g) => {
      const Klambda = K.map((row, i) => {
        const copy = Float64Array.from(row); // copy, so K stays clean for the next λ
        copy[i] += lambda;
        return copy;
      });
      const alpha = choleskySolve(Klambda, yCentred);
      // 5. Score the held-out predictions exactly as before.
      const r = heldOutPairwise(
        testRows.map((i, t) => ({ pred: yMean + dot(C[t], alpha), trueRank: -y[i] })),
        trainPairs,
      );
      agree[g] += r.agree;
      total[g] += r.total;
    });
  }

  // Grid order, and `>=` so that on a tie the later (larger) λ wins.
  let best = grid[0];
  let bestAcc = -1;
  grid.forEach((lambda, g) => {
    const acc = total[g] === 0 ? 0 : agree[g] / total[g];
    if (acc >= bestAcc) {
      best = lambda;
      bestAcc = acc;
    }
  });
  return best;
}
