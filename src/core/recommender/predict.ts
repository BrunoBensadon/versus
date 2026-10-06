// Prediction, similarity and confidence (spec §7.3).

import type { GameId } from '../types';
import { dot } from './linalg';
import { rawPredict, type RidgeModel } from './ridge';

export interface Contribution {
  column: number;
  value: number; // score points this feature adds (+) or removes (−) relative to the baseline
}

export interface RidgePrediction {
  score: number; // clamped to 0..10
  raw: number; // before clamping
  baseline: number; // the training mean score
  contributions: Contribution[]; // largest |value| first; they sum to raw − baseline
}

export function clampScore(s: number): number {
  return Math.min(10, Math.max(0, s));
}

export function predict(m: RidgeModel, x: Float64Array): RidgePrediction {
  const raw = rawPredict(m, x);
  const contributions: Contribution[] = [];
  for (let j = 0; j < x.length; j++) {
    const value = m.w[j] * (x[j] - m.xMean[j]);
    if (value !== 0) contributions.push({ column: j, value });
  }
  contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { score: clampScore(raw), raw, baseline: m.yMean, contributions };
}

export function cosine(a: Float64Array, b: Float64Array): number {
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na === 0 || nb === 0 ? 0 : dot(a, b) / (na * nb);
}

export interface Neighbour {
  id: GameId;
  similarity: number;
}

/** The k ranked games most similar to x (cosine), most similar first; ties broken by id. */
export function neighbours(x: Float64Array, ranked: { id: GameId; x: Float64Array }[], k: number): Neighbour[] {
  return ranked
    .map((r) => ({ id: r.id, similarity: cosine(x, r.x) }))
    .sort((a, b) => b.similarity - a.similarity || a.id - b.id)
    .slice(0, k);
}

/** kNN scorer: similarity-weighted mean score of the neighbours (negative similarities count 0). */
export function knnScore(neigh: Neighbour[], scoreOf: (id: GameId) => number, fallback: number): number {
  let weight = 0;
  let sum = 0;
  for (const n of neigh) {
    const w = Math.max(n.similarity, 0);
    weight += w;
    sum += w * scoreOf(n.id);
  }
  return weight === 0 ? fallback : sum / weight;
}

export type Confidence = 'low' | 'medium' | 'high';

export interface ConfidenceInput {
  rankedCount: number;
  maxSimilarity: number;
  vocabCoverage: number; // share of the candidate's raw features in the vocabulary, 0..1
  hasSteamTags: boolean;
}

/** Spec §7.3 rule. Initial thresholds; tune once real data exists. */
export function confidence(i: ConfidenceInput): Confidence {
  if (i.rankedCount < 20 || i.maxSimilarity < 0.3 || i.vocabCoverage < 0.5) return 'low';
  if (i.rankedCount >= 40 && i.hasSteamTags && i.maxSimilarity >= 0.5) return 'high';
  return 'medium';
}
