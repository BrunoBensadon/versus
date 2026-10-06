// Offline evaluation (spec §7.4). Repeated k-fold over ranked games; for every held-out fold the
// order is rebuilt WITHOUT those games, so they never leak into the training scores.

import { globalOrder, replay, scores, type RankState } from '../ranking';
import { seededRandom, shuffled } from '../random';
import type { GameId, GameMeta, RankEvent } from '../types';
import { buildFeatures, vectorize } from './features';
import { bootstrapMean, heldOutPairwise, kendallTau, type Interval } from './metrics';
import { clampScore, knnScore, neighbours, predict } from './predict';
import { chooseLambda, fitRidge, LAMBDA_GRID } from './ridge';

export const MIN_RANKED_TO_EVALUATE = 20;

export interface EvalDataset {
  events: RankEvent[];
  games: GameMeta[];
}

export type ModelName = 'ridge' | 'ridge_steam_masked' | 'genre_avg' | 'knn5' | 'rating_only' | 'mean_only';
export const MODEL_NAMES: readonly ModelName[] = ['ridge', 'ridge_steam_masked', 'genre_avg', 'knn5', 'rating_only', 'mean_only'];

export interface MetricSummary {
  // Held-out pairwise accuracy. NOT 0.5 at chance: predicting the training mean for every game already
  // scores ~0.75, because most training games sit far from the middle. Read it against `mean_only`.
  acc: Interval;
  tau: Interval; // Kendall τ within the held-out fold
}

export type EvalReport =
  | { ok: false; ranked: number; reason: string }
  | { ok: true; ranked: number; folds: number; models: Record<ModelName, MetricSummary>; ridgeBeatsKnn: boolean };

/** Score of each held-out game from the training scores of games sharing ≥ 1 genre; else the mean. */
function genreAverage(h: GameMeta, train: GameMeta[], trainScore: Map<GameId, number>, mean: number): number {
  const genres = new Set(h.genres.map((g) => g.toLowerCase()));
  const shared = train.filter((t) => t.genres.some((g) => genres.has(g.toLowerCase())));
  if (shared.length === 0) return mean;
  return shared.reduce((s, t) => s + trainScore.get(t.id)!, 0) / shared.length;
}

/** Least-squares line score ≈ a + b · total_rating, fitted on the training games that have a rating. */
function ratingOnly(h: GameMeta, train: GameMeta[], trainScore: Map<GameId, number>, mean: number): number {
  const pts = train.filter((t) => t.totalRating !== null).map((t) => [t.totalRating!, trainScore.get(t.id)!]);
  if (pts.length < 2 || h.totalRating === null) return mean;
  const mx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
  const my = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
  const sxx = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  if (sxx === 0) return mean;
  const b = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / sxx;
  return my + b * (h.totalRating - mx);
}

export function evaluate(dataset: EvalDataset, opts: { repeats: number; folds: number; seed: number }): EvalReport {
  const metaById = new Map(dataset.games.map((g) => [g.id, g]));
  const state = replay(dataset.events);
  const order = globalOrder(state).filter((id) => metaById.has(id));
  if (order.length < MIN_RANKED_TO_EVALUATE) {
    return { ok: false, ranked: order.length, reason: `not enough data: ${order.length} ranked games, need ${MIN_RANKED_TO_EVALUATE}` };
  }
  const trueRank = new Map(order.map((id, i) => [id, i]));
  const perFold: Record<ModelName, { acc: number[]; tau: number[] }> = {
    ridge: { acc: [], tau: [] },
    ridge_steam_masked: { acc: [], tau: [] },
    genre_avg: { acc: [], tau: [] },
    knn5: { acc: [], tau: [] },
    rating_only: { acc: [], tau: [] },
    mean_only: { acc: [], tau: [] },
  };

  for (let r = 1; r <= opts.repeats; r++) {
    const ids = shuffled(order, seededRandom(opts.seed * 1000 + r));
    for (let f = 0; f < opts.folds; f++) {
      const held = ids.filter((_, i) => i % opts.folds === f);
      const heldSet = new Set(held);
      const trainState: Pick<RankState, 'lists'> = {
        lists: {
          loved: state.lists.loved.filter((id) => !heldSet.has(id) && metaById.has(id)),
          liked: state.lists.liked.filter((id) => !heldSet.has(id) && metaById.has(id)),
          disliked: state.lists.disliked.filter((id) => !heldSet.has(id) && metaById.has(id)),
        },
      };
      const trainScore = scores(trainState);
      const trainIds = order.filter((id) => !heldSet.has(id));
      const trainMetas = trainIds.map((id) => metaById.get(id)!);
      const space = buildFeatures(trainMetas);
      const X = trainMetas.map((g) => vectorize(space, g));
      const y = trainIds.map((id) => trainScore.get(id)!);
      const mean = y.reduce((s, v) => s + v, 0) / y.length;
      const model = fitRidge(X, y, chooseLambda(X, y, LAMBDA_GRID, 5, opts.seed * 1000 + r * 10 + f));
      const ranked = trainIds.map((id, i) => ({ id, x: X[i] }));

      const preds: Record<ModelName, number[]> = {
        ridge: [], ridge_steam_masked: [], genre_avg: [], knn5: [], rating_only: [], mean_only: [],
      };
      for (const id of held) {
        const h = metaById.get(id)!;
        const x = vectorize(space, h);
        preds.ridge.push(predict(model, x).score);
        preds.ridge_steam_masked.push(predict(model, vectorize(space, h, { maskSteam: true })).score);
        preds.genre_avg.push(genreAverage(h, trainMetas, trainScore, mean));
        preds.knn5.push(clampScore(knnScore(neighbours(x, ranked, 5), (t) => trainScore.get(t)!, mean)));
        preds.rating_only.push(ratingOnly(h, trainMetas, trainScore, mean));
        preds.mean_only.push(mean);
      }

      const trainPoints = trainIds.map((id) => ({ score: trainScore.get(id)!, trueRank: trueRank.get(id)! }));
      for (const name of MODEL_NAMES) {
        const p = preds[name];
        const pair = heldOutPairwise(held.map((id, i) => ({ pred: p[i], trueRank: trueRank.get(id)! })), trainPoints);
        if (pair.total > 0) perFold[name].acc.push(pair.agree / pair.total);
        perFold[name].tau.push(kendallTau(p, held.map((id) => -trueRank.get(id)!)));
      }
    }
  }

  const rand = seededRandom(opts.seed);
  const models = {} as Record<ModelName, MetricSummary>;
  for (const name of MODEL_NAMES) {
    models[name] = { acc: bootstrapMean(perFold[name].acc, rand), tau: bootstrapMean(perFold[name].tau, rand) };
  }
  return {
    ok: true,
    ranked: order.length,
    folds: opts.repeats * opts.folds,
    models,
    ridgeBeatsKnn: models.ridge.acc.mean > models.knn5.acc.mean,
  };
}
