// The one call the UI makes (spec §4): fit on the ranked games, then predict each candidate with a
// score, implied bucket, neighbourhood, confidence and explanation.

import { bandOf, globalOrder, positionOf, type RankState } from '../ranking';
import type { Bucket, GameId, GameMeta } from '../types';
import { SCORER, type Scorer } from './config';
import { buildFeatures, columnLabel, vectorize, vocabCoverage } from './features';
import { clampScore, confidence, knnScore, neighbours, predict, type Confidence } from './predict';
import { chooseLambda, fitRidge } from './ridge';

/** Below this many ranked games there is nothing to fit: predictions come back with score null. */
export const MIN_RANKED_TO_PREDICT = 5;

export interface Reason {
  label: string; // "Steam tag: Roguelite"
  value: number; // +0.6 = this feature adds 0.6 points
}

export interface SimilarGame {
  id: GameId;
  similarity: number;
  score: number;
  bucket: Bucket;
  position: number; // 1-based place in the global ranked list
}

export interface Prediction {
  gameId: GameId;
  score: number | null; // null = not enough ranked games yet
  bucket: Bucket | null;
  above: { id: GameId; score: number } | null; // ranked game just above the prediction
  below: { id: GameId; score: number } | null; // ranked game just below it
  confidence: Confidence;
  reasons: Reason[]; // top 3 positive + top 1 negative; empty in kNN mode
  similar: SimilarGame[]; // 3 most similar ranked games, disliked ones included
}

export function recommend(
  state: RankState,
  scoreMap: Map<GameId, number>,
  games: GameMeta[],
  candidates: GameId[],
  opts: { scorer?: Scorer } = {},
): Prediction[] {
  const metaById = new Map(games.map((g) => [g.id, g]));
  const order = globalOrder(state).filter((id) => metaById.has(id) && scoreMap.has(id));

  if (order.length < MIN_RANKED_TO_PREDICT) {
    return candidates.map((gameId) => ({
      gameId, score: null, bucket: null, above: null, below: null, confidence: 'low', reasons: [], similar: [],
    }));
  }

  const trainMetas = order.map((id) => metaById.get(id)!);
  const space = buildFeatures(trainMetas);
  const X = trainMetas.map((g) => vectorize(space, g));
  const y = order.map((id) => scoreMap.get(id)!);
  const ranked = order.map((id, i) => ({ id, x: X[i] }));
  const meanScore = y.reduce((s, v) => s + v, 0) / y.length;

  const scorer = opts.scorer ?? SCORER;
  const model = scorer === 'ridge' ? fitRidge(X, y, chooseLambda(X, y)) : null;

  const out: Prediction[] = [];
  for (const gameId of candidates) {
    const meta = metaById.get(gameId);
    if (!meta) continue; // no metadata yet: the caller fetches it first
    const x = vectorize(space, meta);
    const neigh = neighbours(x, ranked, 5);

    let score: number;
    let reasons: Reason[] = [];
    if (model) {
      const p = predict(model, x);
      score = p.score;
      const positive = p.contributions.filter((c) => c.value > 0).slice(0, 3);
      const negative = p.contributions.filter((c) => c.value < 0).slice(0, 1);
      reasons = [...positive, ...negative].map((c) => ({ label: columnLabel(space.columns[c.column]), value: c.value }));
    } else {
      score = clampScore(knnScore(neigh, (id) => scoreMap.get(id)!, meanScore));
    }

    // The ranked games whose actual scores bracket the prediction. `order` is best first.
    let above: Prediction['above'] = null;
    let below: Prediction['below'] = null;
    for (const id of order) {
      const s = scoreMap.get(id)!;
      if (s >= score) above = { id, score: s };
      else if (!below) below = { id, score: s };
    }

    const similar = neigh.slice(0, 3).map((n) => ({
      id: n.id,
      similarity: n.similarity,
      score: scoreMap.get(n.id)!,
      bucket: positionOf(state, n.id)!.bucket,
      position: order.indexOf(n.id) + 1,
    }));

    out.push({
      gameId,
      score,
      bucket: bandOf(score),
      above,
      below,
      confidence: confidence({
        rankedCount: order.length,
        maxSimilarity: neigh[0]?.similarity ?? 0,
        vocabCoverage: vocabCoverage(space, meta),
        hasSteamTags: meta.steamTags !== null && meta.steamTags.length > 0,
      }),
      reasons,
      similar,
    });
  }
  return out;
}
